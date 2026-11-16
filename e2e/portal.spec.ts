import { test, expect, type Page } from '@playwright/test';
import { bedfordview, signInWithBedfordview, type MockDb } from './support.ts';

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

/** A client with consent, one programme, and an email, then the invitation. */
async function trainerInvites(page: Page) {
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
  await page.getByLabel('Goals').fill('private goal text');
  await page.getByLabel(/^Private notes/).fill('private note text');
  await page.getByRole('button', { name: 'Save profile' }).click();
  const m = bedfordview.machinesWithExercises[0]!;
  await page.locator(`g.mk[data-eq="${m.id}"]`).click();
  await page.getByRole('dialog').locator('.popitem').first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await page.getByLabel('Session name').fill('Starter');
  await page.getByRole('checkbox', { name: 'Dan Dillon' }).check();
  await page.getByRole('button', { name: 'Assign to selected clients' }).click();
  await expect(page.getByText('Assigned to 1 client.')).toBeVisible();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: /Dan Dillon/ }).click();
  const panel = page.getByRole('region', { name: 'Client portal' });
  await expect(panel.getByText('Not invited')).toBeVisible();
  await panel.getByLabel('Their email address').fill('dan@example.com');
  await panel.getByRole('button', { name: 'Invite to the portal' }).click();
  await expect(panel.getByText(/Invited: waiting/)).toBeVisible();
}

async function clientPage(page: Page, browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext({ viewport: page.viewportSize() });
  const client = await ctx.newPage();
  await signInWithBedfordview(client, mock);
  await client.goto('/portal');
  return { ctx, client };
}

test('the trainer invites a client; the client opens the portal and sees only their programme', async ({
  page,
  browser,
}) => {
  await trainerInvites(page);
  expect(mock.invites).toHaveLength(1);
  expect(mock.invites[0]!.email).toBe('dan@example.com');
  expect(mock.invites[0]!.emailed_at).not.toBeNull();

  const { ctx, client } = await clientPage(page, browser);
  await expect(client.getByRole('heading', { name: 'My training' })).toBeVisible();
  await expect(client.getByText('Alice Fitness').first()).toBeVisible();
  await expect(client.getByRole('tab', { name: 'Zones' })).toHaveCount(0);

  await client.getByRole('button', { name: 'Open Starter' }).click();
  await expect(client.getByRole('heading', { level: 1, name: 'Starter' })).toBeVisible();
  await expect(client.locator('g.zone').first()).toBeVisible();
  const html = await client.content();
  for (const secret of ['private goal text', 'private note text']) expect(html, secret).not.toContain(secret);
  await client.getByRole('button', { name: /Back to my programmes/ }).click();

  // the trainer now sees them as active
  await page.reload();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: /Dan Dillon/ }).click();
  await expect(
    page.getByRole('region', { name: 'Client portal' }).getByText(/Active: they can sign in/),
  ).toBeVisible();
  await ctx.close();
});

test('the client withdraws a consent and asks for their data; the trainer gets both', async ({
  page,
  browser,
}) => {
  await trainerInvites(page);
  const { ctx, client } = await clientPage(page, browser);
  await client.getByRole('tab', { name: 'My privacy' }).click();
  await expect(client.getByText('My trainer keeping my details and training records')).toBeVisible();
  await client.getByRole('button', { name: 'Send me a copy of my information' }).click();
  await expect(client.getByText('Sent. Your trainer will follow up.')).toBeVisible();
  expect(mock.dataRequests.map((r) => r.kind)).toContain('access');
  await client.getByRole('button', { name: /^Withdraw: My trainer keeping/ }).click();
  await client.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(client.getByText('Withdrawn. Your trainer has been told.')).toBeVisible();
  expect(mock.dataRequests.map((r) => r.kind)).toContain('consent-withdrawal');
  await ctx.close();
});

test('switching access off removes the client’s view at once', async ({ page, browser }) => {
  await trainerInvites(page);
  const { ctx, client } = await clientPage(page, browser);
  await expect(client.getByRole('button', { name: 'Open Starter' })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: /Dan Dillon/ }).click();
  await page.getByRole('button', { name: 'Switch off portal access' }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(page.getByText('Portal access switched off.')).toBeVisible();
  await client.reload();
  await expect(client.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible();
  await ctx.close();
});

test('the portal never scrolls the page sideways and its buttons are big enough', async ({
  page,
  browser,
}) => {
  await trainerInvites(page);
  const { ctx, client } = await clientPage(page, browser);
  await expect(client.getByRole('button', { name: 'Open Starter' })).toBeVisible();
  const overflow = await client.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = (await client.getByRole('button', { name: 'Open Starter' }).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await ctx.close();
});
