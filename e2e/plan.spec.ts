import { test, expect } from '@playwright/test';
import { bedfordview, signInWithBedfordview } from './support.ts';

test.beforeEach(async ({ page }) => {
  await signInWithBedfordview(page);
  await page.goto('/');
});

test('the signed-in trainer sees the Bedfordview plan read from the database', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Bedfordview Zone Planner' })).toBeVisible();
  const map = page.getByRole('group', { name: 'Floor plan with training zones and equipment' });
  await expect(map).toBeVisible();
  await expect(map.locator('g.zone')).toHaveCount(bedfordview.zonesOnFloor(0));
  await expect(map.locator('g.mk')).toHaveCount(bedfordview.machinesOnFloor(0));

  await page.getByRole('button', { name: bedfordview.floorNames[1]! }).click();
  await expect(map.locator('g.zone')).toHaveCount(bedfordview.zonesOnFloor(1));
  await expect(map.locator('g.mk')).toHaveCount(bedfordview.machinesOnFloor(1));
});

test('muscle focus dims machines that do not train the muscle', async ({ page }) => {
  const map = page.getByRole('group', { name: 'Floor plan with training zones and equipment' });
  await expect(map.locator('g.mk.dim')).toHaveCount(0);
  await page.getByRole('button', { name: 'chest', exact: true }).click();
  const dimmed = await map.locator('g.mk.dim').count();
  expect(dimmed).toBeGreaterThan(0);
  expect(dimmed).toBeLessThan(bedfordview.machinesOnFloor(0));
});

test('clicking a zone labels its machines', async ({ page }) => {
  const map = page.getByRole('group', { name: 'Floor plan with training zones and equipment' });
  await expect(map.locator('g.mk.lab')).toHaveCount(0);
  await map.locator('g.zone').first().click();
  expect(await map.locator('g.mk.lab').count()).toBeGreaterThan(0);
});

test('the page never scrolls sideways; the plan scrolls inside its own box', async ({ page }) => {
  await expect(page.locator('g.zone').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('tabs, floor tabs and chips are at least 44px tall', async ({ page }) => {
  await expect(page.locator('g.zone').first()).toBeVisible();
  for (const loc of [page.getByRole('tab'), page.locator('.floorbar .chip'), page.locator('.chips .chip')]) {
    for (const el of await loc.all()) {
      const box = await el.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    }
  }
});

test('screenshots for visual comparison with the prototype (only when SHOTS_DIR is set)', async ({
  page,
}, info) => {
  test.skip(!process.env.SHOTS_DIR, 'set SHOTS_DIR to save screenshots');
  const dir = process.env.SHOTS_DIR!;
  await expect(page.locator('g.zone').first()).toBeVisible();
  await page.screenshot({ path: `${dir}/app-${info.project.name}-ground-page.png`, fullPage: true });
  await page.locator('#map').screenshot({ path: `${dir}/app-${info.project.name}-ground-map.png` });
  await page.getByRole('button', { name: bedfordview.floorNames[1]! }).click();
  await page.locator('#map').screenshot({ path: `${dir}/app-${info.project.name}-first-map.png` });
});
