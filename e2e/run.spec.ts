import { test, expect, type Page } from '@playwright/test';
import { bedfordview, restMachine, signInWithBedfordview } from './support.ts';

const machineA = bedfordview.machinesWithExercises[0]!;
const machineB = bedfordview.machinesWithExercises[bedfordview.machinesWithExercises.length - 1]!;

let mock: Awaited<ReturnType<typeof signInWithBedfordview>>;
test.beforeEach(async ({ page }) => {
  // A controllable clock: time only moves when the test says so.
  await page.clock.install({ time: new Date('2026-11-15T09:00:00') });
  mock = await signInWithBedfordview(page);
  await page.goto('/');
  await expect(page.locator('g.zone').first()).toBeVisible();
  // Freeze time: from here it only moves when a test calls page.clock.runFor.
  await page.clock.pauseAt(new Date('2026-11-15T09:05:00'));
});

async function addFirstExercise(page: Page, machine: { id: string }) {
  await page.locator(`g.mk[data-eq="${machine.id}"]`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.popitem').first().click();
  await page.keyboard.press('Escape');
}

async function readyToRun(page: Page) {
  await addFirstExercise(page, machineA);
  await addFirstExercise(page, machineB);
  await page.getByRole('tab', { name: /^Run/ }).click();
  await expect(page.getByRole('region', { name: 'Live workout' })).toContainText('Ready');
}

test('start, time, move on and finish: the run is saved to history and shown in Past runs', async ({
  page,
}) => {
  await readyToRun(page);
  const bar = page.getByRole('region', { name: 'Live workout' });
  await bar.getByRole('button', { name: 'Start workout' }).click();
  await expect(bar).toContainText('step 1 of 2');
  await expect(page.locator(`g.mk[data-eq="${machineA.id}"]`)).toHaveClass(/st-now/);
  await expect(page.locator(`g.mk[data-eq="${machineB.id}"]`)).toHaveClass(/st-next/);

  await page.clock.runFor(65_000);
  await expect(bar.getByRole('timer')).toHaveText('01:05');
  await bar.getByRole('button', { name: 'Done, next' }).click();
  await expect(page.locator(`g.mk[data-eq="${machineA.id}"]`)).toHaveClass(/st-done/);
  await page.clock.runFor(30_000);
  await bar.getByRole('button', { name: 'Finish' }).click();

  await expect(bar).toContainText('Workout finished');
  await expect(page.locator('.toast')).toContainText('Saved to history');
  expect(mock.runs).toHaveLength(1);
  expect(mock.runs[0]).toMatchObject({ total_ms: 95_000, planned_min: expect.any(Number) });
  expect(mock.runs[0]!.run_steps).toHaveLength(2);
  const past = page.getByRole('list', { name: 'Past runs' });
  await expect(past).toContainText('01:35 · 2/2 done');
});

test('history survives a reload', async ({ page }) => {
  await readyToRun(page);
  const bar = page.getByRole('region', { name: 'Live workout' });
  await bar.getByRole('button', { name: 'Start workout' }).click();
  await page.clock.runFor(4000);
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(bar).toContainText('Workout finished');
  await page.reload();
  await expect(page.locator('g.zone').first()).toBeVisible();
  await page.getByRole('tab', { name: /^Run/ }).click();
  await expect(page.getByRole('list', { name: 'Past runs' })).toContainText('00:04');
});

test('tapping a machine during a run jumps to it, and the gym picker locks', async ({ page }) => {
  await readyToRun(page);
  const bar = page.getByRole('region', { name: 'Live workout' });
  await bar.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByRole('combobox', { name: 'Select gym' })).toBeDisabled();
  await page.locator(`g.mk[data-eq="${machineB.id}"]`).click();
  await expect(page.locator(`g.mk[data-eq="${machineB.id}"]`)).toHaveClass(/st-now/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the run bar and Run tab never scroll the page sideways and controls are 44px tall', async ({
  page,
}) => {
  await readyToRun(page);
  const bar = page.getByRole('region', { name: 'Live workout' });
  await bar.getByRole('button', { name: 'Start workout' }).click();
  await page.clock.runFor(3000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const el of await bar.getByRole('button').all()) {
    const box = await el.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }
  for (const el of await page.locator('.runlist .btn').all()) {
    const box = await el.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }
});

const clockText = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

test('the rest between sets counts down and ends by itself; it can be skipped', async ({ page }) => {
  await addFirstExercise(page, { id: restMachine.id });
  await page.getByRole('tab', { name: /^Run/ }).click();
  const bar = page.getByRole('region', { name: 'Live workout' });
  await bar.getByRole('button', { name: 'Start workout' }).click();
  await expect(bar).toContainText(`set 1 of ${restMachine.exercise.sets}`);
  await bar.getByRole('button', { name: 'Set done' }).click();
  await expect(bar).toContainText(`set 2 of ${restMachine.exercise.sets}`);
  const rest = bar.getByRole('timer', { name: 'Rest left' });
  await expect(rest).toHaveText(clockText(restMachine.exercise.rest));
  await page.clock.runFor(10_000);
  await expect(rest).toHaveText(clockText(restMachine.exercise.rest - 10));
  await page.clock.runFor(restMachine.exercise.rest * 1000);
  await expect(rest).toHaveCount(0);
  await bar.getByRole('button', { name: 'Set done' }).click();
  await bar.getByRole('button', { name: 'Skip rest' }).click();
  await expect(rest).toHaveCount(0);
});

test('a run in progress survives a reload: it returns paused on the Run tab, with its time', async ({
  page,
}) => {
  await readyToRun(page);
  const bar = page.getByRole('region', { name: 'Live workout' });
  await bar.getByRole('button', { name: 'Start workout' }).click();
  await page.clock.runFor(30_000);
  await bar.getByRole('button', { name: 'Done, next' }).click();
  await page.clock.runFor(5000);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Run ●' })).toHaveAttribute('aria-selected', 'true');
  const back = page.getByRole('region', { name: 'Live workout' });
  await expect(back).toContainText('Paused');
  await expect(back).toContainText('step 2 of 2');
  await expect(back.getByRole('timer', { name: 'Total time' })).toHaveText('00:35');
  await expect(page.getByText(/Your workout was restored/)).toBeVisible();
  await back.getByRole('button', { name: 'Resume' }).click();
  await expect(back).not.toContainText('Paused');
});
