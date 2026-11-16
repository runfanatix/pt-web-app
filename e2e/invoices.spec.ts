import { test, expect, type Page } from '@playwright/test';
import { signInWithBedfordview, type MockDb } from './support.ts';

/** First day of next month, South African time. */
const nextMonth = (() => {
  const t = new Date(Date.now() + 2 * 3600000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
})();

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
  await page.getByLabel('Email', { exact: true }).first().fill('dan@example.com');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page
    .getByRole('button', { name: /Dan Dillon/ })
    .click()
    .catch(() => {});
  const panel = page.getByRole('region', { name: 'Client portal' });
  await panel.getByLabel('Their email address').fill('dan@example.com');
  await panel.getByRole('button', { name: 'Invite to the portal' }).click();
  await expect(panel.getByText(/Invited: waiting/)).toBeVisible();
}

async function bookNextMonth(page: Page) {
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Book a session' }).first().click();
  const form = page.getByRole('region', { name: 'Book a session' });
  await form.getByLabel('Client').selectOption({ label: 'Dan Dillon' });
  await form.getByLabel('Date').fill(nextMonth);
  await form.getByLabel('Start time').fill('07:00');
  await form.getByLabel('Repeat every week for').selectOption({ value: '4' });
  await form.getByRole('button', { name: 'Book it' }).click();
  await expect(page.getByText('4 weekly sessions booked.')).toBeVisible();
}

test('sessions booked for next month become an invoice, which is sent, paid, and visible to the client', async ({
  page,
  browser,
}) => {
  await clientAndInvite(page);
  await bookNextMonth(page);
  await page.getByRole('tab', { name: 'Invoices' }).click();

  // no rate yet: the client is skipped and named
  await page.getByRole('button', { name: /^Make the .* invoices$/ }).click();
  await expect(page.getByText(/No rate set for Dan Dillon/)).toBeVisible();

  await page.getByText('Rates per client').click();
  await page.getByLabel('Rate for Dan Dillon').fill('450');
  await page.getByLabel('Rate for Dan Dillon').blur();
  await expect(page.getByText('Rate saved for Dan Dillon.')).toBeVisible();
  await page.getByText('Invoice settings').click();
  await page.getByLabel(/^Bank details/).fill('FNB 62000 111 222');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Invoice settings saved.')).toBeVisible();

  await page.getByRole('button', { name: /^Make the .* invoices$/ }).click();
  await expect(page.getByText('Made 1 invoice as drafts.')).toBeVisible();
  const card = page.getByRole('listitem', { name: /^Invoice / });
  await expect(card).toContainText('Dan Dillon');
  await expect(card).toContainText('R1');
  await expect(card).toContainText('1 800,00');
  expect(mock.invoices).toHaveLength(1);

  // the client sees nothing until it is sent
  const ctx = await browser.newContext({ viewport: page.viewportSize() });
  const client = await ctx.newPage();
  await signInWithBedfordview(client, mock);
  await client.goto('/portal');
  await client.getByRole('tab', { name: 'My invoices' }).click();
  await expect(client.getByText('No invoices yet')).toBeVisible();

  await card.getByRole('button', { name: 'Send to client' }).click();
  await expect(page.getByText(/emailed to dan@example.com/)).toBeVisible();
  expect(mock.invoices[0]).toMatchObject({ status: 'sent' });
  await client.reload();
  await client.getByRole('tab', { name: 'My invoices' }).click();
  await expect(client.getByText(/You owe R1.800,00/)).toBeVisible();
  await expect(client.getByText(/FNB 62000 111 222/)).toBeVisible();

  await card.getByRole('button', { name: 'Mark as paid' }).click();
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText(/marked as paid/)).toBeVisible();
  await client.reload();
  await client.getByRole('tab', { name: 'My invoices' }).click();
  await expect(client.getByText(/You owe/)).toHaveCount(0);
  await ctx.close();
});

test('the invoices screen fits a phone and its buttons are big enough', async ({ page }) => {
  await page.getByRole('tab', { name: 'Invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = (await page.getByRole('button', { name: /^Make the .* invoices$/ }).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
});
