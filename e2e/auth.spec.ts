import { test, expect } from '@playwright/test';

test('signed-out visitors see the sign-in screen, not the planner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Gym location' })).toHaveCount(0);
});

test('sign-up needs the privacy notice accepted', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a trainer account' }).click();
  const submit = page.getByRole('button', { name: 'Create account' });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(submit).toBeEnabled();
});

test('no horizontal page scroll on the auth screens', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a trainer account' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('tap targets on the auth screen are at least 44px', async ({ page }) => {
  await page.goto('/');
  for (const control of [
    page.getByLabel('Email'),
    page.getByLabel('Password'),
    page.getByRole('button', { name: 'Sign in' }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
