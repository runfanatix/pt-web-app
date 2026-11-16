import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

/**
 * The offline demo (`pnpm demo:build` -> demo/PT-Planner-Demo.html): one html file, opened from disk with the
 * network switched off. Skipped when the file has not been built.
 */
const FILE = join(import.meta.dirname, '..', 'demo', 'PT-Planner-Demo.html');
const URL_ = pathToFileURL(FILE).href;

test.skip(!existsSync(FILE), 'run `pnpm demo:build` first');
test.use({ offline: true });

test.beforeEach(async ({ page }) => {
  await page.goto(URL_);
  await expect(page.locator('g.zone').first()).toBeVisible();
});

async function tick(page: Page, tickIt = true) {
  if (tickIt) await page.getByRole('checkbox').check();
  const next = page.getByRole('button', { name: 'Next' });
  if (await next.count()) await next.click();
  else await page.getByRole('button', { name: 'Finish' }).click();
}

async function addFirstExercise(page: Page) {
  await page.locator('g.mk').first().click();
  await page.getByRole('dialog').locator('.popitem').first().click();
  await page.keyboard.press('Escape');
}

test('opens from disk with no network, signed in, with the Bedfordview plan and exercise library', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 1, name: /Zone Planner/ })).toBeVisible();
  await expect(page.getByText(/Demo · works offline/)).toBeVisible();
  expect(await page.locator('g.mk').count()).toBeGreaterThan(30);
  await addFirstExercise(page);
  await expect(page.getByRole('tab', { name: 'Session (1)' })).toBeVisible();
});

test('a layout change is saved, survives a reload, and Reset demo puts everything back', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit layout' }).click();
  const before = await page.locator('g.zone').count();
  await page.getByRole('button', { name: 'Add zone' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Demo zone');
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Layout saved').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('g.zone').first()).toBeVisible();
  await expect(page.locator('g.zone')).toHaveCount(before + 1);
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.locator('g.zone').first()).toBeVisible();
  await expect(page.locator('g.zone')).toHaveCount(before);
});

test('catalogue: add a manufacturer and model, tag a machine, and the model shows when planning', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Catalogue' }).click();
  await page.getByRole('button', { name: '+ Technogym' }).click();
  await page.getByRole('button', { name: 'Add a model' }).click();
  await page.getByLabel('Model name').fill('Demo Chest Press');
  await page.getByLabel('Item code').fill('DEMO-1');
  await page.getByRole('button', { name: 'Save model' }).click();
  await expect(page.getByText('DEMO-1')).toBeVisible();
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.locator('g.mk').first().click();
  const card = page.getByRole('region', { name: 'Selected machine' });
  await card
    .getByRole('combobox', { name: 'Manufacturer', exact: true })
    .selectOption({ label: 'Technogym' });
  await card
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption({ label: 'Demo Chest Press (DEMO-1)' });
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Layout saved').first()).toBeVisible();
  await page.getByRole('button', { name: 'Plan session' }).click();
  await page.locator('g.mk').first().click();
  await expect(page.getByRole('dialog').getByText('Technogym Demo Chest Press (DEMO-1)')).toBeVisible();
});

test('a second gym can be added and switched to, and a client link opens in another tab with no sign-in', async ({
  page,
  context,
}) => {
  await page.getByRole('tab', { name: 'Gyms' }).click();
  await page.locator('section[aria-label="Add a gym"] input').first().fill('Second Gym');
  await page.getByRole('button', { name: 'Create and open' }).click();
  await expect(page.getByText(/Opened Second Gym/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open Virgin Active Bedfordview' }).click();
  await expect(page.locator('g.mk').first()).toBeVisible();

  // a client with consent, a programme, and a link
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Your business details' }).click();
  await page.getByLabel('Business or trainer name').fill('Demo Fitness');
  await page.getByLabel('Physical address').fill('1 Main Rd');
  await page.getByLabel('Contact email').fill('demo@example.com');
  await page.getByLabel('Information Officer name').fill('Demo Officer');
  await page.getByLabel('Information Officer email').fill('io@example.com');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Sample Client');
  await page.getByRole('button', { name: 'Continue to consent' }).click();
  for (let i = 0; i < 3; i++) await tick(page);
  await tick(page, false);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await addFirstExercise(page);
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await page.getByLabel('Session name').fill('Starter');
  await page.getByRole('checkbox', { name: 'Sample Client' }).check();
  await page.getByRole('button', { name: 'Assign to selected clients' }).click();
  await expect(page.getByText('Assigned to 1 client.')).toBeVisible();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: /Sample Client/ }).click();
  await page.getByRole('button', { name: 'Share Starter' }).click();
  await page.getByRole('button', { name: 'Create a link' }).click();
  const link = await page.getByRole('textbox', { name: 'Client link' }).inputValue();
  expect(link).toMatch(/PT-Planner-Demo\.html#\/p\/[0-9a-f]{64}$/);

  const visitor = await context.newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole('heading', { level: 1, name: 'Starter' })).toBeVisible();
  await expect(visitor.getByRole('tab')).toHaveCount(0);
  await expect(visitor.getByText('Sample Client')).toHaveCount(0);
});

test('a workout can be run to the end and is saved to history', async ({ page }) => {
  await addFirstExercise(page);
  await page.getByRole('tab', { name: /^Run/ }).click();
  const bar = page.getByRole('region', { name: 'Live workout' });
  await bar.getByRole('button', { name: 'Start workout' }).click();
  for (let i = 0; i < 30 && !(await bar.getByText('Workout finished').count()); i++) {
    const skip = bar.getByRole('button', { name: /Skip rest/ });
    if (await skip.count()) await skip.click();
    else
      await bar
        .getByRole('button', { name: /^(Set done|Done, finish|Done, next|Finish)/ })
        .first()
        .click();
  }
  await expect(bar).toContainText('Workout finished');
  await expect(page.getByRole('list', { name: 'Past runs' })).toContainText('done');
});

test('client portal: invite a client, then open the client view and see only their programme', async ({
  page,
  context,
}) => {
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Your business details' }).click();
  await page.getByLabel('Business or trainer name').fill('Demo Fitness');
  await page.getByLabel('Physical address').fill('1 Main Rd');
  await page.getByLabel('Contact email').fill('demo@example.com');
  await page.getByLabel('Information Officer name').fill('Demo Officer');
  await page.getByLabel('Information Officer email').fill('io@example.com');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Sample Client');
  await page.getByRole('button', { name: 'Continue to consent' }).click();
  for (let i = 0; i < 3; i++) await tick(page);
  await tick(page, false);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await addFirstExercise(page);
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await page.getByLabel('Session name').fill('Starter');
  await page.getByRole('checkbox', { name: 'Sample Client' }).check();
  await page.getByRole('button', { name: 'Assign to selected clients' }).click();
  await expect(page.getByText('Assigned to 1 client.')).toBeVisible();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: /Sample Client/ }).click();
  const panel = page.getByRole('region', { name: 'Client portal' });
  await panel.getByLabel('Their email address').fill('client@example.com');
  await panel.getByRole('button', { name: 'Invite to the portal' }).click();
  await expect(panel.getByText(/Invited: waiting/)).toBeVisible();

  const client = await context.newPage();
  await client.goto(URL_ + '#/portal');
  await expect(client.getByRole('heading', { name: 'My training' })).toBeVisible();
  await client.getByRole('button', { name: 'Open Starter' }).click();
  await expect(client.getByRole('heading', { level: 1, name: 'Starter' })).toBeVisible();
  await expect(client.getByRole('tab')).toHaveCount(0);
  await client.getByRole('button', { name: 'Start workout' }).click();
  await expect(client.getByRole('region', { name: 'Live workout' })).toBeVisible();
});

test('calendar: book a weekly session, then the client sees it under My sessions', async ({
  page,
  context,
}) => {
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Your business details' }).click();
  await page.getByLabel('Business or trainer name').fill('Demo Fitness');
  await page.getByLabel('Physical address').fill('1 Main Rd');
  await page.getByLabel('Contact email').fill('demo@example.com');
  await page.getByLabel('Information Officer name').fill('Demo Officer');
  await page.getByLabel('Information Officer email').fill('io@example.com');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Sample Client');
  await page.getByRole('button', { name: 'Continue to consent' }).click();
  for (let i = 0; i < 3; i++) await tick(page);
  await tick(page, false);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('button', { name: /Sample Client/ }).click();
  const panel = page.getByRole('region', { name: 'Client portal' });
  await panel.getByLabel('Their email address').fill('client@example.com');
  await panel.getByRole('button', { name: 'Invite to the portal' }).click();
  await expect(panel.getByText(/Invited: waiting/)).toBeVisible();
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Book a session' }).first().click();
  const form = page.getByRole('region', { name: 'Book a session' });
  await form.getByLabel('Client').selectOption({ label: 'Sample Client' });
  const ahead = new Date(Date.now() + 2 * 86400000 + 2 * 3600000).toISOString().slice(0, 10);
  await form.getByLabel('Date').fill(ahead);
  await form.getByLabel('Repeat every week for').selectOption({ value: '4' });
  await form.getByRole('button', { name: 'Book it' }).click();
  await expect(page.getByText('4 weekly sessions booked.')).toBeVisible();

  const client = await context.newPage();
  await client.goto(URL_ + '#/portal');
  await client.getByRole('tab', { name: 'My sessions' }).click();
  await expect(client.getByRole('list', { name: 'Upcoming sessions' }).getByRole('listitem')).toHaveCount(4);
});
