import { test, expect } from '@playwright/test';

test('app shell renders with gym bar and tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Bedfordview Zone Planner' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Gym location' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(7);
});

test('no horizontal page scroll', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('tap targets are at least 44px', async ({ page }) => {
  await page.goto('/');
  for (const tab of await page.getByRole('tab').all()) {
    const box = await tab.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
