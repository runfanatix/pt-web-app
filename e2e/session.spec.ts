import { test, expect, type Page } from '@playwright/test';
import { bedfordview, signInWithBedfordview } from './support.ts';

const machineA = bedfordview.machinesWithExercises[0]!;
const machineB = bedfordview.machinesWithExercises[bedfordview.machinesWithExercises.length - 1]!;

let mock: Awaited<ReturnType<typeof signInWithBedfordview>>;
test.beforeEach(async ({ page }) => {
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
});

/** Tap a machine on the plan and add its first exercise from the pop-up. Returns the exercise name. */
async function addFirstExercise(page: Page, machine: { id: string }): Promise<string> {
  await page.locator(`g.mk[data-eq="${machine.id}"]`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const first = dialog.locator('.popitem .nm').first();
  const text = (await first.textContent())!;
  await first.click();
  return text;
}

test('tapping a machine opens the pop-up (a bottom sheet on phones) and adding builds the session', async ({
  page,
}, info) => {
  const x1 = await addFirstExercise(page, machineA);
  const dialog = page.getByRole('dialog');
  if (info.project.name === 'phone-390') {
    await expect(dialog).toHaveClass(/sheet/);
    const box = await dialog.boundingBox();
    expect(Math.round(box!.x)).toBe(0);
    expect(Math.round(box!.width)).toBe(390);
  } else {
    await expect(dialog).not.toHaveClass(/sheet/);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  }
  await expect(page.getByRole('tab', { name: 'Session (1)' })).toBeVisible();
  await expect(page.locator('.toast')).toContainText(`Added ${x1}`);
  await expect(page.locator('g.mk .bdt').first()).toHaveText('1');
});

test('numbers and route lines follow the order, and reordering updates them', async ({ page }) => {
  await addFirstExercise(page, machineA);
  await page.keyboard.press('Escape');
  await addFirstExercise(page, machineB);
  await page.keyboard.press('Escape');
  await expect(page.locator('polyline.route')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Session (2)' }).click();
  await expect(page.locator('.sitem')).toHaveCount(2);
  await page
    .getByRole('button', { name: /^Move .* up$/ })
    .last()
    .click();
  // the second exercise is now first, so its machine carries the number 1
  const badges = await page.locator('g.mk .bdt').allTextContents();
  expect(badges.sort()).toEqual(['1', '2']);
  await expect(page.getByLabel('Session summary')).toContainText('Floor route:');
});

test('edits stick, and the unsent routine survives a reload', async ({ page }) => {
  await addFirstExercise(page, machineA);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await page.getByLabel('Sets').fill('5');
  await page.getByLabel('Coach note (optional)').fill('Slow tempo');
  await page.getByLabel('Session name').fill('Leg day');
  await page.reload();
  await expect(page.locator('g.zone').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await expect(page.getByLabel('Sets')).toHaveValue('5');
  await expect(page.getByLabel('Coach note (optional)')).toHaveValue('Slow tempo');
  await expect(page.getByLabel('Session name')).toHaveValue('Leg day');
});

test('clearing the session takes two taps', async ({ page }) => {
  await addFirstExercise(page, machineA);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await page.getByRole('button', { name: 'Clear session' }).click();
  await expect(page.getByRole('tab', { name: 'Session (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(page.getByRole('tab', { name: 'Session (0)' })).toBeVisible();
});

test('save as a template, then load it back', async ({ page }) => {
  await addFirstExercise(page, machineA);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  await page.getByLabel('Template name').fill('Starter');
  await page.getByRole('button', { name: 'Save as template' }).click();
  await expect(page.getByText('Saved template "Starter".')).toBeVisible();
  expect(mock.templates).toHaveLength(1);
  expect(mock.templates[0]!.template_items).toHaveLength(1);
  await page.getByRole('button', { name: 'Clear session' }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(page.getByRole('tab', { name: 'Session (0)' })).toBeVisible();
  await page.getByRole('button', { name: 'Load Starter' }).click();
  await expect(page.getByRole('tab', { name: 'Session (1)' })).toBeVisible();
  await expect(page.getByLabel('Session name')).toHaveValue('Starter');
});

test('the session tab never scrolls the page sideways and its controls are 44px tall', async ({ page }) => {
  await addFirstExercise(page, machineA);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Session (1)' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const loc of [page.locator('.sitem input'), page.locator('.sitem .mv .btn'), page.locator('.grip')]) {
    for (const el of await loc.all()) {
      const box = await el.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    }
  }
});
