import { test, expect } from '@playwright/test';
import { bedfordview, signInWithBedfordview } from './support.ts';

let mock: Awaited<ReturnType<typeof signInWithBedfordview>>;
test.beforeEach(async ({ page }) => {
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
});

async function addMakerAndModel(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Catalogue' }).click();
  await page.getByRole('button', { name: '+ Technogym' }).click();
  await expect(page.getByRole('heading', { name: 'Technogym' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a model' }).click();
  await page.getByLabel('Model name').fill('Selection Chest Press');
  await page.getByLabel('Item code').fill('MPY01');
  await page.getByRole('group', { name: 'Muscles it trains' }).getByRole('button', { name: 'chest' }).click();
  await page.getByRole('button', { name: 'Add a specification' }).click();
  await page.getByLabel('Specification 1 name').fill('Weight stack');
  await page.getByLabel('Specification 1 value').fill('100 kg');
  await page.getByRole('button', { name: 'Save model' }).click();
  await expect(page.getByText('MPY01')).toBeVisible();
}

test('build a catalogue by hand: a manufacturer, then a model with code, muscles and specs', async ({
  page,
}) => {
  await addMakerAndModel(page);
  expect(mock.catalogue).toHaveLength(1);
  expect(mock.catalogue[0]!.name).toBe('Technogym');
  expect(mock.catalogue[0]!.catalogue_items[0]).toMatchObject({
    model_name: 'Selection Chest Press',
    code: 'MPY01',
    muscles: ['chest'],
    specs: [{ label: 'Weight stack', value: '100 kg' }],
  });
});

test('tag a machine on the plan with its real model: it is saved and shown when planning', async ({
  page,
}) => {
  await addMakerAndModel(page);
  const m = bedfordview.machinesWithExercises[0]!;
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.locator(`g.mk[data-eq="${m.id}"]`).click();
  const card = page.getByRole('region', { name: 'Selected machine' });
  await card
    .getByRole('combobox', { name: 'Manufacturer', exact: true })
    .selectOption({ label: 'Technogym' });
  await card
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption({ label: 'Selection Chest Press (MPY01)' });
  await expect(card.getByText('100 kg')).toBeVisible();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Layout saved').first()).toBeVisible();
  const sent = mock.layoutSaves[0]!.p_layout.equipment as {
    id: string;
    catalogue_item_id: string | null;
    name: string;
  }[];
  const e = sent.find((x) => x.id === m.id)!;
  expect(e.catalogue_item_id).toBe('it-1');
  expect(e.name).toBe('Selection Chest Press');
  expect(sent.filter((x) => x.catalogue_item_id)).toHaveLength(1);
});

test('the Catalogue tab never scrolls the page sideways', async ({ page }) => {
  await addMakerAndModel(page);
  await page.getByRole('button', { name: 'Add a model' }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
