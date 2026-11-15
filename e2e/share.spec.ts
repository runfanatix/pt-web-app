import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { SUPABASE_URL, bedfordview, serveApi, signInWithBedfordview, type MockDb } from './support.ts';

let mock: MockDb;
test.beforeEach(async ({ page }) => {
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
});

const SECRETS = {
  goals: 'rebuild after knee surgery',
  notes: 'torn ACL and anxiety',
  whatsapp: '082 555 0199',
};

async function tick(page: Page, tickIt = true) {
  const box = page.getByRole('checkbox');
  if (tickIt) await box.check();
  const next = page.getByRole('button', { name: 'Next' });
  if (await next.count()) await next.click();
  else await page.getByRole('button', { name: 'Finish' }).click();
}

/** The trainer's side: details, a client with consent and private notes, and a programme assigned to them. */
async function trainerAssignsProgramme(page: Page) {
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Your business details' }).click();
  await page.getByLabel('Business or trainer name').fill('Alice Fitness');
  await page.getByLabel('Physical address').fill('1 Main Rd, Bedfordview');
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
  await page.getByLabel('WhatsApp', { exact: true }).fill(SECRETS.whatsapp);
  await page.getByLabel('Goals').fill(SECRETS.goals);
  await page.getByLabel(/^Private notes/).fill(SECRETS.notes);
  await page.getByRole('button', { name: 'Save profile' }).click();

  const machine = bedfordview.machinesWithExercises[0]!;
  await page.locator(`g.mk[data-eq="${machine.id}"]`).click();
  await page.getByRole('dialog').locator('.popitem').first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await page.getByLabel('Session name').fill('Starter');
  await page.getByRole('checkbox', { name: 'Dan Dillon' }).check();
  await page.getByRole('button', { name: 'Assign to selected clients' }).click();
  await expect(page.getByText('Assigned to 1 client.')).toBeVisible();
}

async function createLink(page: Page): Promise<string> {
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: /Dan Dillon/ }).click();
  await page.getByRole('button', { name: 'Share Starter' }).click();
  await page.getByRole('button', { name: 'Create a link' }).click();
  const box = page.getByRole('textbox', { name: 'Client link' });
  await expect(box).toBeVisible();
  return await box.inputValue();
}

test('a client opens their link logged out and sees only the programme; the trainer can switch it off', async ({
  page,
  browser,
}) => {
  await trainerAssignsProgramme(page);
  const url = await createLink(page);
  expect(url).toMatch(/\/p\/[0-9a-f]{64}$/);

  // a different browser, no sign-in at all
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const visitor = await context.newPage();
  await serveApi(visitor, mock);
  const calls: string[] = [];
  visitor.on('request', (r) => {
    if (r.url().startsWith(SUPABASE_URL) && r.method() !== 'OPTIONS') calls.push(new URL(r.url()).pathname);
  });
  await visitor.goto(url);

  await expect(visitor.getByRole('heading', { level: 1, name: 'Starter' })).toBeVisible();
  await expect(visitor.getByText(/Alice Fitness/).first()).toBeVisible();
  await expect(visitor.getByRole('list', { name: 'Exercises' }).getByRole('listitem')).toHaveCount(1);
  await expect(visitor.locator('g.zone').first()).toBeVisible();
  await expect(visitor.locator('g.mk .bdt').first()).toHaveText('1');
  await expect(visitor.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  await expect(visitor.getByRole('tab')).toHaveCount(0);

  // nothing private is on the page, and the only server call is the one public function
  const html = await visitor.content();
  for (const secret of [...Object.values(SECRETS), 'Dan Dillon', 'Dan', 'alice@example.com']) {
    if (secret === 'alice@example.com' || secret === 'Dan') continue; // the business email is the trainer\'s, and "Dan" is too short to test on
    expect(html, secret).not.toContain(secret);
  }
  expect(new Set(calls)).toEqual(new Set(['/rest/v1/rpc/get_shared_programme']));

  // the trainer switches it off: the very next visit gets nothing
  await page.getByRole('button', { name: /^Switch off link ending/ }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(page.getByText(/^Switched off/)).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible();
  await expect(visitor.getByText('Starter')).toHaveCount(0);
  await context.close();
});

test('a wrong or unknown link says it is not available and shows nothing', async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const visitor = await context.newPage();
  await serveApi(visitor, mock);
  await visitor.goto(`/p/${'f'.repeat(64)}`);
  await expect(visitor.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible();
  await context.close();
});

test('the client saves their programme as a PDF', async ({ page, browser }) => {
  await trainerAssignsProgramme(page);
  const url = await createLink(page);
  const context = await browser.newContext({ viewport: page.viewportSize(), acceptDownloads: true });
  const visitor = await context.newPage();
  await serveApi(visitor, mock);
  await visitor.goto(url);
  const [download] = await Promise.all([
    visitor.waitForEvent('download'),
    visitor.getByRole('button', { name: 'Save as PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^training-programme-\d{4}-\d{2}-\d{2}\.pdf$/);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const text = bytes.toString('latin1');
  expect(text).toContain('Starter');
  expect(text).not.toContain('Dan Dillon');
  for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
  await context.close();
});

test('the trainer saves the programme PDF from the Session tab, and WhatsApp opens with the client’s number', async ({
  page,
}) => {
  await trainerAssignsProgramme(page);
  await page.getByRole('tab', { name: /^Session/ }).click();
  await page.getByRole('combobox', { name: /^Client/ }).selectOption({ label: 'Dan Dillon' });
  const send = page.getByRole('region', { name: 'Send to your client' });
  await expect(send.getByLabel('WhatsApp number')).toHaveValue(SECRETS.whatsapp);
  const href = await send.getByRole('link', { name: '2. Open WhatsApp' }).getAttribute('href');
  expect(href).toContain('wa.me/27825550199');
  expect(decodeURIComponent(href!)).toContain('Hi Dan,');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    send.getByRole('button', { name: '1. Save PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^training-programme-Dan-Dillon-/);
  const text = readFileSync((await download.path())!).toString('latin1');
  expect(text).toContain('Dan Dillon'); // the client’s own copy carries their name
  for (const secret of [SECRETS.goals, SECRETS.notes]) expect(text).not.toContain(secret);
});

test('the public page fits a phone and its buttons are big enough', async ({ page, browser }) => {
  await trainerAssignsProgramme(page);
  const url = await createLink(page);
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const visitor = await context.newPage();
  await serveApi(visitor, mock);
  await visitor.goto(url);
  await expect(visitor.locator('g.zone').first()).toBeVisible();
  const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const pdf = await visitor.getByRole('button', { name: 'Save as PDF' }).boundingBox();
  expect(pdf!.height).toBeGreaterThanOrEqual(43.5);
  await context.close();
});
