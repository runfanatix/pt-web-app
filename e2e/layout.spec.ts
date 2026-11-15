import { test, expect } from '@playwright/test';
import { bedfordview, signInWithBedfordview } from './support.ts';

let mock: Awaited<ReturnType<typeof signInWithBedfordview>>;
test.beforeEach(async ({ page }) => {
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit layout' }).click();
});

test('add a zone, rename it, save: one all-or-nothing call with the new zone in it', async ({ page }) => {
  await page.getByRole('button', { name: 'Add zone' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Stretch corner');
  await expect(page.getByText('Unsaved layout changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Layout saved').first()).toBeVisible();
  expect(mock.layoutSaves).toHaveLength(1);
  const sent = mock.layoutSaves[0]!;
  const zones = sent.p_layout.zones as { name: string }[];
  expect(zones.some((z) => z.name === 'Stretch corner')).toBe(true);
  expect(zones).toHaveLength(bedfordview.zonesOnFloor(0) + bedfordview.zonesOnFloor(1) + 1);
});

test('dragging a machine moves it and makes the layout unsaved; discard puts it back', async ({ page }) => {
  const m = bedfordview.machinesWithExercises[0]!;
  const marker = page.locator(`g.mk[data-eq="${m.id}"]`);
  const before = (await marker.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 + 5, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText('Unsaved layout changes')).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByText('Layout saved').first()).toBeVisible();
  const after = (await page.locator(`g.mk[data-eq="${m.id}"]`).boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(mock.layoutSaves).toHaveLength(0);
});

test('a zone shows eight grips when selected, and dragging a corner resizes it', async ({ page }) => {
  await page.getByRole('button', { name: 'Add zone' }).click();
  await expect(page.locator('.hnd')).toHaveCount(8);
  const w = page.getByLabel('Width', { exact: true });
  const before = Number(await w.inputValue());
  const grip = page.locator('.hnd[data-h="se"] .hgrip');
  await grip.scrollIntoViewIfNeeded();
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  expect(Number(await w.inputValue())).toBeGreaterThan(before);
});

test('no horizontal page scroll at phone width while editing', async ({ page }) => {
  await page.getByRole('button', { name: 'Add zone' }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a wall gets round grips at both ends; dragging one lengthens it', async ({ page }) => {
  await page.getByRole('button', { name: 'Add wall' }).click();
  await expect(page.locator('.hnd[data-h="p1"]')).toHaveCount(1);
  await expect(page.locator('.hnd[data-h="p2"]')).toHaveCount(1);
  const endX = page.getByLabel('End x');
  const before = Number(await endX.inputValue());
  const grip = page.locator('.hnd[data-h="p2"] .hgrip');
  await grip.scrollIntoViewIfNeeded();
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(Number(await endX.inputValue())).toBeGreaterThan(before);
});

test('adding a floor adds a floor tab, and saving sends it', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a floor' }).click();
  await expect(page.getByRole('button', { name: /^Floor 3$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Layout saved').first()).toBeVisible();
  expect(mock.layoutSaves[0]!.p_layout.floors).toHaveLength(bedfordview.floorNames.length + 1);
});

test('the layout panels never scroll the page sideways', async ({ page }) => {
  await page
    .getByRole('button', { name: 'Add stairs' })
    .or(page.getByRole('button', { name: 'Add staircase' }))
    .click();
  await page.getByRole('button', { name: 'Add zone' }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
