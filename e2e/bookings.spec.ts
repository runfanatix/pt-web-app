import { test, expect, type Page } from '@playwright/test';
import { signInWithBedfordview, type MockDb } from './support.ts';

let mock: MockDb;
test.beforeEach(async ({ page }) => {
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
});

async function tick(page: Page, tickIt = true) {
  if (tickIt) await page.getByRole('checkbox').check();
  const next = page.getByRole('button', { name: 'Next' });
  if (await next.count()) await next.click();
  else await page.getByRole('button', { name: 'Finish' }).click();
}

/** A client with consent, invited to the portal. */
async function clientAndInvite(page: Page) {
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Your business details' }).click();
  await page.getByLabel('Business or trainer name').fill('Alice Fitness');
  await page.getByLabel('Physical address').fill('1 Main Rd');
  await page.getByLabel('Contact email').fill('alice@example.com');
  await page.getByLabel('Information Officer name').fill('Alice Smith');
  await page.getByLabel('Information Officer email').fill('io@example.com');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Dan Dillon');
  await page.getByRole('button', { name: 'Continue to consent' }).click();
  for (let i = 0; i < 3; i++) await tick(page);
  await tick(page, false);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('button', { name: /Dan Dillon/ }).click();
  const panel = page.getByRole('region', { name: 'Client portal' });
  await panel.getByLabel('Their email address').fill('dan@example.com');
  await panel.getByRole('button', { name: 'Invite to the portal' }).click();
  await expect(panel.getByText(/Invited: waiting/)).toBeVisible();
}

/** The booked day is two days ahead: Day view, then forward twice. */
async function goToBookedDay(page: Page) {
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
}

async function book(page: Page, weeks: string) {
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Book a session' }).first().click();
  const form = page.getByRole('region', { name: 'Book a session' });
  await form.getByLabel('Client').selectOption({ label: 'Dan Dillon' });
  // two days ahead (South African date), so the sessions are always still to come
  const ahead = new Date(Date.now() + 2 * 86400000 + 2 * 3600000).toISOString().slice(0, 10);
  await form.getByLabel('Date').fill(ahead);
  await form.getByLabel('Start time').fill('07:00');
  await form.getByLabel('Repeat every week for').selectOption({ value: weeks });
  await form.getByRole('button', { name: 'Book it' }).click();
}

test('the trainer books a weekly session; it shows on the calendar, and in the client’s portal where they confirm it', async ({
  page,
  browser,
}) => {
  await clientAndInvite(page);
  await book(page, '4');
  await expect(page.getByText('4 weekly sessions booked.')).toBeVisible();
  expect(mock.bookings).toHaveLength(4);
  expect(new Set(mock.bookings.map((b) => b.series_id)).size).toBe(1);
  await goToBookedDay(page);
  await expect(page.getByRole('list', { name: /^Sessions on/ })).toContainText('Dan Dillon');

  const ctx = await browser.newContext({ viewport: page.viewportSize() });
  const client = await ctx.newPage();
  await signInWithBedfordview(client, mock);
  await client.goto('/portal');
  await client.getByRole('tab', { name: 'My sessions' }).click();
  const up = client.getByRole('list', { name: 'Upcoming sessions' });
  await expect(up.getByRole('listitem')).toHaveCount(4);
  await expect(up.getByRole('listitem').first()).toContainText('07:00 to 08:00');
  await up
    .getByRole('button', { name: /^Confirm/ })
    .first()
    .click();
  await expect(client.getByText('Thanks, your trainer knows you will be there.')).toBeVisible();
  expect(mock.bookings.filter((b) => b.client_response === 'confirmed')).toHaveLength(1);

  await page.reload();
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await goToBookedDay(page);
  await expect(page.getByRole('list', { name: /^Sessions on/ })).toContainText('Confirmed');
  await ctx.close();
});

test('cancelling this and the rest of a series: the trainer’s calendar and the client’s portal both show it', async ({
  page,
  browser,
}) => {
  await clientAndInvite(page);
  await book(page, '4');
  await expect(page.getByText('4 weekly sessions booked.')).toBeVisible();
  await goToBookedDay(page);
  await page.getByRole('button', { name: /^Cancel this and all later/ }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(page.getByText('This and all later weekly sessions cancelled.')).toBeVisible();
  expect(mock.bookings.every((b) => b.status === 'cancelled')).toBe(true);

  const ctx = await browser.newContext({ viewport: page.viewportSize() });
  const client = await ctx.newPage();
  await signInWithBedfordview(client, mock);
  await client.goto('/portal');
  await client.getByRole('tab', { name: 'My sessions' }).click();
  await expect(client.getByText('No sessions booked yet.')).toBeVisible();
  await expect(client.getByRole('list', { name: 'Earlier sessions' })).toContainText(
    'Cancelled by your trainer',
  );
  await ctx.close();
});

test('the calendar fits a phone and its buttons are big enough', async ({ page }) => {
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = (await page.getByRole('gridcell').first().boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
});
