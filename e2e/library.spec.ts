import { test, expect } from '@playwright/test';
import { bedfordview, signInWithBedfordview } from './support.ts';

let mock: Awaited<ReturnType<typeof signInWithBedfordview>>;
test.beforeEach(async ({ page }) => {
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Library' }).click();
});

test('lists the whole preloaded library, searchable and filterable', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Exercise library' })).toBeVisible();
  const total = mock.exercises.length;
  expect(total).toBeGreaterThan(100);
  await expect(page.getByText(`${total} exercises.`, { exact: false })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Exercises' }).getByRole('listitem')).toHaveCount(total);
  await page.getByLabel('Search').fill('squat');
  const n = await page.getByRole('list', { name: 'Exercises' }).getByRole('listitem').count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(total);
  await page.getByLabel('Search').fill('');
  await page.getByRole('combobox', { name: 'Muscle', exact: true }).selectOption('glutes');
  const g = await page.getByRole('list', { name: 'Exercises' }).getByRole('listitem').count();
  expect(g).toBeGreaterThan(0);
  expect(g).toBeLessThan(total);
  await page.getByRole('combobox', { name: 'Equipment', exact: true }).selectOption('none');
  await expect(page.getByText(/^Showing|No exercises match/)).toBeVisible();
});

test('a new exercise linked to a machine shows up in that machine’s pop-up with its demo link', async ({
  page,
}) => {
  const m = bedfordview.machinesWithExercises[0]!;
  await page.getByRole('button', { name: 'New exercise' }).click();
  await page.getByLabel('Name').fill('Zercher squat');
  await page.getByLabel('Demo link (optional)').fill('youtube.com/watch?v=zercher');
  await page.getByLabel('Sets').fill('4');
  await page.getByLabel('legs', { exact: true }).check();
  // tick the machine by its name inside the "Can be done on" group
  const machine = page.locator(`g.mk[data-eq="${m.id}"]`);
  await expect(machine).toBeVisible();
  const eqName = mock.floors[Object.keys(mock.floors)[0]!]!.flatMap((f) =>
    f.zones.flatMap((z) => z.equipment),
  ).find((e) => e.id === m.id)!.name as string;
  await page
    .getByRole('group', { name: 'Can be done on' })
    .getByLabel(eqName, { exact: true })
    .first()
    .check();
  await page.getByRole('button', { name: 'Save exercise' }).click();
  await expect(page.getByText('Added "Zercher squat".')).toBeVisible();
  expect(
    mock.exercises.some(
      (x) => x.name === 'Zercher squat' && x.link === 'https://youtube.com/watch?v=zercher',
    ),
  ).toBe(true);

  await page.getByRole('tab', { name: 'Zones' }).click();
  await machine.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Zercher squat')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Watch a demo of Zercher squat' })).toHaveAttribute(
    'href',
    'https://youtube.com/watch?v=zercher',
  );
});

test('an exercise that came with the app cannot be rewritten, but can be copied and changed', async ({
  page,
}) => {
  await page.getByLabel('Search').fill('squat');
  await page.getByRole('list', { name: 'Exercises' }).getByRole('button').first().click();
  await expect(page.getByRole('note')).toContainText('came with the app');
  await expect(page.getByLabel('Name')).toBeDisabled();
  await page.getByRole('button', { name: 'Make my own copy' }).click();
  await expect(page.getByText(/Made your own copy/)).toBeVisible();
  expect(mock.exercises.filter((x) => String(x.name).includes('(mine)'))).toHaveLength(1);
  await page.getByLabel('Search').fill('(mine)');
  await page.getByRole('list', { name: 'Exercises' }).getByRole('button').first().click();
  await expect(page.getByLabel('Name')).toBeEnabled();
  await page.getByLabel('Sets').fill('6');
  await page.getByRole('button', { name: 'Save exercise' }).click();
  await expect.poll(() => mock.exercises.find((x) => String(x.name).includes('(mine)'))?.sets).toBe(6);
  // and deleted again, in two taps
  await page.getByRole('list', { name: 'Exercises' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Delete exercise' }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect.poll(() => mock.exercises.some((x) => String(x.name).includes('(mine)'))).toBe(false);
});

test('many exercises can be pasted at once', async ({ page }) => {
  const before = mock.exercises.length;
  await page.getByText('Add many exercises at once').click();
  await page
    .getByLabel('Paste lines here')
    .fill('Farmer walk 2 | core, arms | | I | 4 | 20 m | 90 | Tall\nLandmine twist | core | | B');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Added 2, updated 0.')).toBeVisible();
  expect(mock.exercises.length).toBe(before + 2);
});

test('the library fits a phone and its buttons are big enough', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = (await page.getByRole('button', { name: 'New exercise' }).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
});
