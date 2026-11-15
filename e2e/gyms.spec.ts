import { test, expect } from '@playwright/test';
import { signInWithBedfordview } from './support.ts';

let mock: Awaited<ReturnType<typeof signInWithBedfordview>>;
test.beforeEach(async ({ page }) => {
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Gyms' }).click();
});

test('the Gyms tab lists the gym with what it holds and who is open', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Gym locations' })).toBeVisible();
  await expect(page.getByText('Open now')).toBeVisible();
  await expect(page.getByText(/2 floors · 14 zones · 41 equipment/)).toBeVisible();
});

test('adding a blank gym saves one empty floor, opens it, and the picker lists both', async ({ page }) => {
  await page.locator('section[aria-label="Add a gym"] input').first().fill('Anytime Fitness');
  await page.getByRole('button', { name: 'Create and open' }).click();
  await expect(page.getByText(/Opened Anytime Fitness/).first()).toBeVisible();
  expect(mock.layoutSaves).toHaveLength(1);
  expect(mock.layoutSaves[0]!.p_layout.floors).toHaveLength(1);
  expect(mock.layoutSaves[0]!.p_layout.zones).toHaveLength(0);
  const options = await page
    .getByRole('combobox', { name: 'Select gym' })
    .locator('option')
    .allTextContents();
  expect(options).toContain('Anytime Fitness');
  await expect(page.getByText('Nothing on this floor yet.')).toBeVisible();
});

test('editing a gym address saves it; a second gym can be deleted with two taps', async ({ page }) => {
  await page.locator('section[aria-label="Add a gym"] input').first().fill('Temp Gym');
  await page.getByRole('button', { name: 'Create and open' }).click();
  await expect(page.getByText(/Opened Temp Gym/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open Virgin Active Bedfordview' }).click();
  await expect(page.getByText(/Opened Virgin Active/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Details for Temp Gym' }).click();
  const addr = page.locator('section[aria-label="Gym details"] input').nth(2);
  await addr.fill('9 Test Rd');
  await addr.blur();
  await expect.poll(() => mock.gyms.find((g) => g.name === 'Temp Gym')?.address).toBe('9 Test Rd');
  await page.getByRole('button', { name: 'Delete this gym' }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect.poll(() => mock.gyms.length).toBe(1);
});

test('the gym bar and Gyms tab never scroll the page sideways', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
