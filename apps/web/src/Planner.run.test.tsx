import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { exercisesFor, type GymSummary, type HistoryEntry } from '@pt/core';
import { Planner } from './Planner.tsx';
import type { HistoryApi } from './data/history.ts';
import type { Template, TemplateApi } from './data/templates.ts';
import { bedfordviewData } from './test-utils.ts';

const data = bedfordviewData();
const library = data.library;
const loadGym = () => Promise.resolve(data);

const gym: GymSummary = {
  id: 'g1',
  name: 'Virgin Active',
  branch: 'Bedfordview',
  address: '101 Van Buuren Rd',
  phone: '',
  notes: '',
};

/** In-memory stand-in for the runs tables; share one between mounts to simulate a reload. */
function fakeHistory(initial: HistoryEntry[] = []) {
  const store = [...initial];
  const api: HistoryApi = {
    list: vi.fn(async () => store.slice().sort((a, b) => b.startedAt - a.startedAt)),
    save: vi.fn(async (e: HistoryEntry) => {
      const i = store.findIndex((x) => x.id === e.id);
      if (i >= 0) store[i] = e;
      else store.push(e);
    }),
    remove: vi.fn(async (id: string) => {
      store.splice(
        store.findIndex((x) => x.id === id),
        1,
      );
    }),
  };
  return { api, store };
}

const templates: TemplateApi = {
  list: vi.fn(async (): Promise<Template[]> => []),
  save: vi.fn(async () => ({ updated: false })),
  remove: vi.fn(async () => {}),
  equipmentInfo: vi.fn(async () => new Map()),
};

const ground = data.layout.floors[0]!;
const machines = data.layout.equipment.filter(
  (e) => e.floor === ground.id && exercisesFor(library, e.id).length > 0,
);
const machineA = machines[0]!;
const machineB = machines[machines.length - 1]!;

function mount(h = fakeHistory()) {
  const view = render(
    <Planner gyms={[gym]} loadGym={loadGym} templates={templates} history={h.api} onSignOut={() => {}} />,
  );
  return { ...view, h };
}
async function ready() {
  return screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
}
function marker(container: HTMLElement, eid: string) {
  return container.querySelector(`g.mk[data-eq="${eid}"]`)!;
}
/** Click a machine on the plan, then add its first exercise from the pop-up. */
async function addFrom(container: HTMLElement, eid: string) {
  fireEvent.click(marker(container, eid));
  const dialog = await screen.findByRole('dialog');
  const x = exercisesFor(library, eid)[0]!;
  const buttons = within(dialog).getAllByRole('button');
  fireEvent.click(buttons.find((b) => b.textContent?.includes(x.name))!);
  return x;
}

const hud = () => screen.getByRole('region', { name: 'Live workout' });
const timer = () => within(hud()).getByRole('timer');
const hudButton = (name: string) => within(hud()).getByRole('button', { name });

/** Runs `fn` with a fake clock (timers and Date), so elapsed time is exact. */
async function underFakeClock(fn: () => Promise<void>) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  try {
    await fn();
  } finally {
    vi.useRealTimers();
  }
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Two exercises added from the plan, then the Run tab open. */
async function runWithTwoItems(h = fakeHistory()) {
  const view = mount(h);
  await ready();
  const x1 = await addFrom(view.container, machineA.id);
  const x2 = await addFrom(view.container, machineB.id);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('tab', { name: /^Run/ }));
  return { ...view, x1, x2, h };
}

beforeEach(() => localStorage.clear());

describe('live run', () => {
  it('the Run tab lists the steps and the bar offers to start; markers are blue', async () => {
    const { container } = await runWithTwoItems();
    expect(within(hud()).getByText('Ready')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Workout steps' })).getAllByRole('listitem')).toHaveLength(
      2,
    );
    expect(marker(container, machineA.id)).toHaveClass('st-ready');
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Current machine');
  });

  it('with no exercises there is nothing to start', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: /^Run/ }));
    expect(screen.getByText(/Choose a workout above/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Live workout' })).toBeNull();
  });

  it('the clock runs while working, stops while paused, and is shown per machine', async () => {
    const { container } = await runWithTwoItems();
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      expect(within(hud()).getByText(/Now · step 1 of 2/)).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Run ●' })).toBeInTheDocument();
      await advance(5000);
      expect(timer()).toHaveTextContent('00:05');
      expect(marker(container, machineA.id).querySelector('.rt')).toHaveTextContent('00:05');
      fireEvent.click(hudButton('Pause'));
      await advance(10_000);
      expect(timer()).toHaveTextContent('00:05');
      expect(within(hud()).getByText(/Paused/)).toBeInTheDocument();
      fireEvent.click(hudButton('Resume'));
      await advance(3000);
      expect(timer()).toHaveTextContent('00:08');
    });
  });

  it('Done, next moves on; markers change colour; the last step finishes and saves to history', async () => {
    const { container, h, x1, x2 } = await runWithTwoItems();
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      expect(marker(container, machineA.id)).toHaveClass('st-now');
      expect(marker(container, machineB.id)).toHaveClass('st-next');
      await advance(65_000);
      fireEvent.click(hudButton('Done, next'));
      expect(marker(container, machineA.id)).toHaveClass('st-done');
      expect(marker(container, machineB.id)).toHaveClass('st-now');
      await advance(30_000);
      fireEvent.click(hudButton('Finish'));
      await advance(50);
      expect(within(hud()).getByText('Workout finished')).toBeInTheDocument();
      expect(within(hud()).getByText('2 of 2 steps done')).toBeInTheDocument();
      expect(h.api.save).toHaveBeenCalledTimes(1);
      const saved = h.store[0]!;
      expect(saved).toMatchObject({
        title: 'Workout',
        gymName: 'Virgin Active Bedfordview',
        totalMs: 95_000,
        doneN: 2,
      });
      expect(saved.steps.map((s) => [s.exercise, s.ms, s.done])).toEqual([
        [x1.name, 65_000, true],
        [x2.name, 30_000, true],
      ]);
      expect(screen.getByText(/Saved to history/)).toBeInTheDocument();
      const past = screen.getByRole('list', { name: 'Past runs' });
      expect(within(past).getByText('Workout')).toBeInTheDocument();
      expect(within(past).getByText(/01:35 · 2\/2 done/)).toBeInTheDocument();
    });
  });

  it('undoing the last step and finishing again updates the same history record', async () => {
    const { h } = await runWithTwoItems();
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      await advance(1000);
      fireEvent.click(hudButton('Done, next'));
      await advance(1000);
      fireEvent.click(hudButton('Finish'));
      await advance(50);
      const firstId = h.store[0]!.id;
      fireEvent.click(hudButton('Undo last'));
      expect(within(hud()).getByText(/Paused/)).toBeInTheDocument();
      fireEvent.click(hudButton('Resume'));
      await advance(2000);
      fireEvent.click(hudButton('Finish'));
      await advance(50);
      expect(h.api.save).toHaveBeenCalledTimes(2);
      expect(h.store).toHaveLength(1);
      expect(h.store[0]!.id).toBe(firstId);
      expect(h.store[0]!.totalMs).toBe(4000);
    });
  });

  it('ending early needs a second tap, keeps what was done and skips the rest', async () => {
    const { h, container } = await runWithTwoItems();
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      await advance(4000);
      fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
      expect(within(hud()).queryByText('Workout finished')).toBeNull(); // armed, not ended
      fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
      await advance(50);
      expect(within(hud()).getByText('0 of 2 steps done')).toBeInTheDocument();
      expect(marker(container, machineA.id)).toHaveClass('st-skip');
      expect(h.store[0]).toMatchObject({ doneN: 0, totalMs: 4000 });
    });
  });

  it('tapping a machine during a run jumps to it instead of opening the pop-up', async () => {
    const { container } = await runWithTwoItems();
    fireEvent.click(hudButton('Start workout'));
    fireEvent.click(marker(container, machineB.id));
    expect(marker(container, machineB.id)).toHaveClass('st-now');
    expect(await screen.findByText(`Now at ${machineB.name}`)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(marker(container, machineB.id));
    expect(await screen.findByText(`Already at ${machineB.name}`)).toBeInTheDocument();
    const other = data.layout.equipment.find(
      (e) => e.floor === ground.id && e.id !== machineA.id && e.id !== machineB.id,
    )!;
    fireEvent.click(marker(container, other.id));
    expect(
      await screen.findByText(`${other.name} is not in the routine or is already done`),
    ).toBeInTheDocument();
  });

  it('Go now on the Run tab jumps to a step; the gym and workout pickers lock during a run', async () => {
    const { x2 } = await runWithTwoItems();
    fireEvent.click(hudButton('Start workout'));
    expect(screen.getByRole('combobox', { name: 'Select gym' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Load a saved workout' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Go to .* now$/ }));
    expect(within(hud()).getByText(new RegExp(x2.name))).toBeInTheDocument();
  });

  it('Reset during a run needs a second tap and returns to ready', async () => {
    await runWithTwoItems();
    fireEvent.click(hudButton('Start workout'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('tab', { name: 'Run ●' })).toBeInTheDocument(); // still running
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(within(hud()).getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Run' })).toBeInTheDocument();
  });

  it('copies the workout log for WhatsApp', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { x1 } = await runWithTwoItems();
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      await advance(3000);
      fireEvent.click(screen.getByRole('button', { name: 'Copy workout log' }));
      await advance(10);
      expect(writeText).toHaveBeenCalledTimes(1);
      const text = (writeText.mock.calls[0] as unknown as [string])[0];
      expect(text.split('\n')[0]).toBe('*Workout* - workout log');
      expect(text).toContain('Gym: Virgin Active Bedfordview');
      expect(text).toContain(`1. ${machineA.name} - ${x1.name}: 00:03 (not completed)`);
      expect(screen.getByText('Workout log copied.')).toBeInTheDocument();
    });
  });

  it('asks the browser to keep the screen awake while running and lets go when paused', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ released: false, release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    try {
      await runWithTwoItems();
      fireEvent.click(hudButton('Start workout'));
      await waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
      fireEvent.click(hudButton('Pause'));
      await waitFor(() => expect(release).toHaveBeenCalled());
    } finally {
      Reflect.deleteProperty(navigator, 'wakeLock');
    }
  });

  it('history survives a reload, and a past run can be deleted (second tap)', async () => {
    const shared = fakeHistory();
    const first = await runWithTwoItems(shared);
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      await advance(2000);
      fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
      await advance(50);
    });
    first.unmount();
    mount(shared);
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: /^Run/ }));
    const past = await screen.findByRole('list', { name: 'Past runs' });
    expect(within(past).getByText('Workout')).toBeInTheDocument();
    fireEvent.click(within(past).getByRole('button', { name: 'Delete run Workout' }));
    expect(shared.store).toHaveLength(1);
    fireEvent.click(within(past).getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(shared.store).toHaveLength(0));
    expect(await screen.findByText(/No completed runs yet/)).toBeInTheDocument();
  });

  it('a history save failure is reported and the finished screen stays', async () => {
    const h = fakeHistory();
    (h.api.save as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'));
    await runWithTwoItems(h);
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      await advance(1500);
      fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
      await advance(50);
      expect(screen.getByText(/could not be saved: network down/)).toBeInTheDocument();
      expect(within(hud()).getByText('Workout finished')).toBeInTheDocument();
    });
  });
});

/* ---------------------------------------------------------------- rest between sets and keeping a run across a reload */

/** A machine whose exercise has several sets and a rest, so the rest countdown applies. */
const multiSet = machines.find((m) => {
  const x = exercisesFor(library, m.id)[0]!;
  return x.sets >= 3 && x.rest >= 20;
})!;

async function runWithMultiSet(h = fakeHistory()) {
  const view = mount(h);
  await ready();
  const x = await addFrom(view.container, multiSet.id);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('tab', { name: /^Run/ }));
  return { ...view, x, h };
}
const restClock = () => within(hud()).getByRole('timer', { name: 'Rest left' });

describe('rest between sets', () => {
  it('Set done starts the rest countdown, which buzzes when it runs out', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      const { x } = await runWithMultiSet();
      await underFakeClock(async () => {
        fireEvent.click(hudButton('Start workout'));
        expect(within(hud()).getByText(new RegExp(`set 1 of ${x.sets}`))).toBeInTheDocument();
        await advance(20_000);
        fireEvent.click(hudButton('Set done'));
        expect(
          within(hud()).getByText(new RegExp(`Rest · step 1 of 1 · set 2 of ${x.sets}`)),
        ).toBeInTheDocument();
        expect(within(hud()).getByText(new RegExp(`Rest, then set 2 of ${x.sets}`))).toBeInTheDocument();
        expect(restClock()).toHaveTextContent(fmt(x.rest));
        await advance(10_000);
        expect(restClock()).toHaveTextContent(fmt(x.rest - 10));
        expect(vibrate).not.toHaveBeenCalled();
        await advance(x.rest * 1000);
        expect(vibrate).toHaveBeenCalledTimes(1);
        expect(within(hud()).queryByRole('timer', { name: 'Rest left' })).toBeNull();
        expect(screen.getByText('Rest over. Start the next set.')).toBeInTheDocument();
      });
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate');
    }
  });

  it('pausing freezes the rest, and skipping it does not buzz', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      const { x } = await runWithMultiSet();
      await underFakeClock(async () => {
        fireEvent.click(hudButton('Start workout'));
        fireEvent.click(hudButton('Set done'));
        await advance(5000);
        fireEvent.click(hudButton('Pause'));
        await advance(60_000);
        expect(restClock()).toHaveTextContent(fmt(x.rest - 5));
        fireEvent.click(hudButton('Resume'));
        fireEvent.click(hudButton('Skip rest'));
        expect(within(hud()).queryByRole('timer', { name: 'Rest left' })).toBeNull();
        await advance(x.rest * 1000);
        expect(vibrate).not.toHaveBeenCalled();
      });
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate');
    }
  });

  it('the rest alert can be switched off', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      const { x } = await runWithMultiSet();
      await underFakeClock(async () => {
        fireEvent.click(hudButton('Start workout'));
        fireEvent.click(hudButton('Rest alert: on'));
        expect(hudButton('Rest alert: off')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(hudButton('Set done'));
        await advance(x.rest * 1000 + 500);
        expect(vibrate).not.toHaveBeenCalled();
      });
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate');
    }
  });

  it('on the last set the bar offers Done, next; Next machine moves on at any time', async () => {
    const { x } = await runWithMultiSet();
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      for (let s = 1; s < x.sets; s++) {
        fireEvent.click(hudButton('Set done'));
        fireEvent.click(hudButton('Skip rest'));
      }
      expect(within(hud()).getByText(new RegExp(`set ${x.sets} of ${x.sets}`))).toBeInTheDocument();
      expect(hudButton('Done, finish')).toBeInTheDocument();
      expect(within(hud()).queryByRole('button', { name: 'Set done' })).toBeNull();
    });
  });
});

const fmt = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

describe('keeping a run across a reload', () => {
  it('a run in progress comes back paused with its time, step and history id', async () => {
    const shared = fakeHistory();
    const first = await runWithTwoItems(shared);
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      await advance(65_000);
      fireEvent.click(hudButton('Done, next'));
      await advance(10_000);
    });
    first.unmount();

    mount(shared);
    await ready();
    // reopens on the Run tab with the workout paused where it was
    expect(await screen.findByRole('tab', { name: 'Run ●' })).toHaveAttribute('aria-selected', 'true');
    expect(within(hud()).getByText(/Paused · step 2 of 2/)).toBeInTheDocument();
    expect(timer()).toHaveTextContent('01:15');
    expect(screen.getByText(/Your workout was restored/)).toBeInTheDocument();
    expect(screen.getAllByText(/Workout restored and paused/).length).toBeGreaterThan(0);
  });

  it('time while the page was closed is not counted, and the run can be finished and saved', async () => {
    const shared = fakeHistory();
    const first = await runWithTwoItems(shared);
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      await advance(30_000);
      fireEvent.click(hudButton('Done, next'));
    });
    first.unmount();
    mount(shared);
    await ready();
    await screen.findByRole('tab', { name: 'Run ●' });
    await underFakeClock(async () => {
      await advance(600_000); // ten minutes pass with the run restored and paused
      expect(timer()).toHaveTextContent('00:30');
      fireEvent.click(hudButton('Resume'));
      await advance(12_000);
      fireEvent.click(hudButton('Finish'));
      await advance(50);
      expect(shared.store).toHaveLength(1);
      expect(shared.store[0]).toMatchObject({ totalMs: 42_000, doneN: 2 });
    });
  });

  it('a finished or reset run is not brought back', async () => {
    const first = await runWithTwoItems();
    await underFakeClock(async () => {
      fireEvent.click(hudButton('Start workout'));
      await advance(2000);
      fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
      await advance(50);
    });
    expect(localStorage.getItem('pt-run')).toBeNull();
    first.unmount();
    mount();
    await ready();
    expect(screen.queryByRole('tab', { name: 'Run ●' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Zones' })).toHaveAttribute('aria-selected', 'true');
  });

  it('is stored while running and cleared on reset', async () => {
    await runWithTwoItems();
    expect(localStorage.getItem('pt-run')).toBeNull();
    fireEvent.click(hudButton('Start workout'));
    await waitFor(() => expect(localStorage.getItem('pt-run')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(localStorage.getItem('pt-run')).toBeNull());
  });

  it('ignores a corrupted saved run', async () => {
    localStorage.setItem('pt-run', '{"v":1,"gymId":"g1","run":{"status":"running"}}');
    mount();
    await ready();
    expect(screen.queryByRole('tab', { name: 'Run ●' })).toBeNull();
  });
});
