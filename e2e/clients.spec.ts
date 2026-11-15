import { test, expect, type Page } from '@playwright/test';
import { bedfordview, signInWithBedfordview } from './support.ts';

let mock: Awaited<ReturnType<typeof signInWithBedfordview>>;
test.beforeEach(async ({ page }) => {
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Clients' }).click();
});

async function fillBusinessDetails(page: Page) {
  await page.getByRole('button', { name: 'Your business details' }).click();
  await page.getByLabel('Business or trainer name').fill('Alice Fitness');
  await page.getByLabel('Physical address').fill('1 Main Rd, Bedfordview');
  await page.getByLabel('Contact email').fill('alice@example.com');
  await page.getByLabel('Information Officer name').fill('Alice Smith');
  await page.getByLabel('Information Officer email').fill('io@example.com');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

async function tickAndContinue(page: Page, tick = true) {
  const box = page.getByRole('checkbox');
  await expect(box).not.toBeChecked(); // every consent box starts unticked
  if (tick) await box.check();
  const next = page.getByRole('button', { name: 'Next' });
  if (await next.count()) await next.click();
  else await page.getByRole('button', { name: 'Finish' }).click();
}

test('clients need the business details first; then a client is onboarded with consent screens', async ({
  page,
}) => {
  await expect(page.getByRole('button', { name: 'Add client' })).toBeDisabled();
  await fillBusinessDetails(page);
  await expect(page.getByRole('button', { name: 'Add client' })).toBeEnabled();
  expect(mock.profile.business_name).toBe('Alice Fitness');

  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Dan');
  await page.getByLabel(/^Date of birth/).fill('1990-01-01');
  await page.getByRole('button', { name: 'Continue to consent' }).click();

  await expect(page.getByRole('heading', { name: 'Before we start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await tickAndContinue(page); // privacy notice
  await expect(page.getByRole('heading', { name: 'Your health information' })).toBeVisible();
  await tickAndContinue(page);
  await expect(
    page.getByRole('heading', { name: 'Storing your information outside South Africa' }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /London, United Kingdom/ })).not.toBeChecked();
  await tickAndContinue(page);
  await expect(page.getByRole('heading', { name: /News and offers from Alice Fitness/ })).toBeVisible();
  await tickAndContinue(page, false); // marketing left unticked: a recorded "no"

  await expect(page.getByRole('heading', { name: 'Dan' })).toBeVisible();
  expect(mock.clients).toHaveLength(1);
  const consents = mock.clients[0]!.consents.map((c) => [c.purpose, c.granted]);
  expect(consents).toEqual([
    ['privacy-notice', true],
    ['health-information', true],
    ['hosting-abroad', true],
    ['marketing', false],
  ]);
  expect(String(mock.clients[0]!.consents[0]!.wording)).toContain('Privacy Notice for Alice Fitness');
  // health questions are available now that consent exists
  await expect(page.getByLabel('Goals')).toBeVisible();
});

test('the consent screens and notice fit a phone: no sideways scroll, big tick boxes and buttons', async ({
  page,
}) => {
  await fillBusinessDetails(page);
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Dan');
  await page.getByRole('button', { name: 'Continue to consent' }).click();
  await page.getByRole('button', { name: 'Read the Privacy Notice' }).click();
  await expect(page.getByRole('article', { name: 'Privacy notice' })).toContainText('London, United Kingdom');
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Close' }).click();
  const box = await page.getByRole('checkbox').boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(22);
  for (const b of await page.getByRole('button', { name: /^(Next|Back|Cancel)$/ }).all()) {
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  }
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a client can withdraw health consent: the records lock, the request is logged, and a client can be erased', async ({
  page,
}) => {
  await fillBusinessDetails(page);
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Dan');
  await page.getByRole('button', { name: 'Continue to consent' }).click();
  for (let i = 0; i < 3; i++) await tickAndContinue(page);
  await tickAndContinue(page, false);
  await page.getByLabel('Goals').fill('Run 10k');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const list = page.getByRole('list', { name: 'Consents' });
  await list.getByRole('button', { name: 'Withdraw Health information' }).click();
  await list.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(page.getByText('Locked: health consent was withdrawn.')).toBeVisible();
  await expect(page.getByLabel('Goals')).toHaveCount(0);
  // withdrawal is a new record: the original grant is still there
  const health = mock.clients[0]!.consents.filter((c) => c.purpose === 'health-information').map(
    (c) => c.granted,
  );
  expect(health).toEqual([true, false]);

  await page.getByRole('button', { name: 'Delete Dan and all their information' }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(page.getByText(/No clients yet/)).toBeVisible();
  expect(mock.clients).toHaveLength(0);
  expect(mock.dataRequests.map((r) => r.kind)).toEqual(['consent-withdrawal', 'deletion']);
});

test('assign a routine to a client from the Session tab, then open it again from their profile', async ({
  page,
}) => {
  await fillBusinessDetails(page);
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Dan');
  await page.getByRole('button', { name: 'Continue to consent' }).click();
  for (let i = 0; i < 3; i++) await tickAndContinue(page);
  await tickAndContinue(page, false);

  const machine = bedfordview.machinesWithExercises[0]!;
  await page.locator(`g.mk[data-eq="${machine.id}"]`).click();
  await page.getByRole('dialog').locator('.popitem').first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await page.getByLabel('Session name').fill('Starter');
  await page.getByRole('checkbox', { name: 'Dan' }).check();
  await page.getByRole('button', { name: 'Assign to selected clients' }).click();
  await expect(page.getByText('Assigned to 1 client.')).toBeVisible();
  expect(mock.clients[0]!.programmes).toHaveLength(1);

  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: /Dan/ }).click();
  await expect(page.getByRole('heading', { name: 'Programmes (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Starter in the session' }).click();
  await expect(page.getByLabel('Session name')).toHaveValue('Starter');
  await expect(page.getByRole('combobox', { name: /^Client/ })).toHaveValue(mock.clients[0]!.id);
});
