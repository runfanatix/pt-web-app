import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ExerciseInput, Layout, LibraryExercise } from '@pt/core';
import { LibraryTab } from './components/LibraryTab.tsx';
import { MachinePopup } from './components/MachinePopup.tsx';
import type { LibraryApi } from './data/libraryApi.ts';

const layout: Layout = {
  floors: [{ id: 'f1', name: 'Ground', w: 1000, h: 620 }],
  zones: [
    { id: 'z1', name: 'Strength', cat: 'strength', x: 0, y: 0, w: 200, h: 100, floor: 'f1' },
    { id: 'z2', name: 'Cardio', cat: 'cardio', x: 300, y: 0, w: 200, h: 100, floor: 'f1' },
    { id: 'z3', name: 'Empty zone', cat: 'studio', x: 600, y: 0, w: 200, h: 100, floor: 'f1' },
  ],
  structs: [],
  equipment: [
    {
      id: 'm1',
      name: 'Leg press',
      zone: 'z1',
      type: 'machine',
      x: 10,
      y: 10,
      muscles: ['legs'],
      notes: '',
      floor: 'f1',
    },
    {
      id: 'm2',
      name: 'Smith machine',
      zone: 'z1',
      type: 'machine',
      x: 40,
      y: 10,
      muscles: ['chest'],
      notes: '',
      floor: 'f1',
    },
    {
      id: 'm3',
      name: 'Treadmill',
      zone: 'z2',
      type: 'cardio',
      x: 310,
      y: 10,
      muscles: ['cardio'],
      notes: '',
      floor: 'f1',
    },
  ],
};
const ex = (over: Partial<LibraryExercise> & { id: string; name: string }): LibraryExercise => ({
  muscles: [],
  level: 'B',
  sets: 3,
  reps: '10',
  rest: 60,
  cue: '',
  equipmentIds: [],
  ...over,
});
const lib = [
  ex({
    id: 'sq',
    name: 'Squat',
    muscles: ['legs', 'glutes'],
    equipmentIds: ['m1'],
    builtIn: true,
    cue: 'Brace',
  }),
  ex({ id: 'bp', name: 'Bench press', muscles: ['chest'], equipmentIds: ['m2'], builtIn: true }),
  ex({
    id: 'mine',
    name: 'My lunge',
    muscles: ['legs'],
    level: 'I',
    sets: 4,
    reps: '8',
    rest: 90,
    cue: 'Tall',
    link: 'https://x.co/v',
    equipmentIds: ['m1'],
  }),
  ex({ id: 'pl', name: 'Plank', muscles: ['core'], builtIn: true }),
];

function fakeApi() {
  const api: LibraryApi = {
    create: vi.fn(async () => 'new-id'),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    addLinks: vi.fn(async () => {}),
    removeLinks: vi.fn(async () => {}),
  };
  return api;
}
function mount(api = fakeApi(), library = lib) {
  const onChanged = vi.fn();
  const say = vi.fn();
  render(<LibraryTab library={library} layout={layout} api={api} onChanged={onChanged} say={say} />);
  return { api, onChanged, say };
}

beforeEach(() => localStorage.clear());

describe('the exercise list', () => {
  it('shows every exercise by name with its muscles, level and how many machines it is linked to', () => {
    mount();
    const list = screen.getByRole('list', { name: 'Exercises' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.txt > span')!.textContent),
    ).toEqual(['Bench press', 'My lunge', 'Plank', 'Squat']);
    expect(screen.getByText('4 exercises. Link each one', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open My lunge' })).toHaveTextContent(
      'legs · Intermediate · 1 linked',
    );
    expect(screen.getByRole('button', { name: 'Open Squat' })).toHaveTextContent('came with the app');
  });

  it('searches by name or muscle, filters by muscle and machine, and says when nothing matches', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'glutes' } });
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Muscle'), { target: { value: 'legs' } });
    expect(screen.getByText('Showing 2 of 4')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: 'm2' } });
    expect(screen.getByText(/No exercises match/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Muscle'), { target: { value: 'all' } });
    expect(screen.getByRole('button', { name: 'Open Bench press' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: 'none' } });
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Plank' })).toBeInTheDocument();
  });

  it('the equipment filter lists machines by zone and leaves out empty zones', () => {
    mount();
    const select = screen.getByLabelText('Equipment');
    expect(Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)).toEqual([
      'Strength',
      'Cardio',
    ]);
  });
});

describe('a new exercise', () => {
  async function fillAndSave(api: LibraryApi) {
    fireEvent.click(screen.getByRole('button', { name: 'New exercise' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Hack squat ' } });
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'I' } });
    fireEvent.change(screen.getByLabelText('Demo link (optional)'), {
      target: { value: 'youtube.com/watch?v=1' },
    });
    fireEvent.change(screen.getByLabelText('Sets'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Reps or time'), { target: { value: '8-10' } });
    fireEvent.change(screen.getByLabelText('Rest (s)'), { target: { value: '90' } });
    fireEvent.click(screen.getByLabelText('legs'));
    fireEvent.click(screen.getByLabelText('glutes'));
    fireEvent.change(screen.getByLabelText('Coaching cue'), { target: { value: 'Heels down' } });
    fireEvent.click(screen.getByLabelText('Leg press'));
    fireEvent.click(screen.getByRole('button', { name: 'Save exercise' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  }

  it('is made with everything typed, a tidied link, and linked to the chosen machines', async () => {
    const { api, onChanged, say } = mount();
    await fillAndSave(api);
    expect(api.create).toHaveBeenCalledWith({
      name: 'Hack squat',
      level: 'I',
      sets: 4,
      reps: '8-10',
      rest: 90,
      cue: 'Heels down',
      link: 'https://youtube.com/watch?v=1',
      muscles: ['legs', 'glutes'],
    });
    expect(api.addLinks).toHaveBeenCalledWith('new-id', ['m1']);
    expect(onChanged).toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith('Added "Hack squat".');
    expect(screen.getByRole('heading', { name: 'Exercise library' })).toBeInTheDocument();
  });

  it('needs a name, refuses a bad link and a name that is already used, and saves nothing until fixed', async () => {
    const { api } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'New exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save exercise' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the exercise a name.');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'squat' } });
    fireEvent.change(screen.getByLabelText('Demo link (optional)'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save exercise' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The demo link must start with http:// or https://.');
    expect(alert).toHaveTextContent('An exercise called "Squat" already exists.');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('cancel goes back without saving', () => {
    const { api } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'New exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Exercise library' })).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });
});

describe('changing one of my own exercises', () => {
  it('opens with its details and links, saves changes, and only sends the machines that changed', async () => {
    const { api } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open My lunge' }));
    expect(screen.getByLabelText('Name')).toHaveValue('My lunge');
    expect(screen.getByLabelText('Leg press')).toBeChecked();
    expect(screen.getByLabelText('Smith machine')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Sets'), { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText('Leg press'));
    fireEvent.click(screen.getByLabelText('Treadmill'));
    fireEvent.click(screen.getByRole('button', { name: 'Save exercise' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(
      'mine',
      expect.objectContaining({ name: 'My lunge', sets: 5, level: 'I', link: 'https://x.co/v' }),
    );
    expect(api.addLinks).toHaveBeenCalledWith('mine', ['m3']);
    expect(api.removeLinks).toHaveBeenCalledWith('mine', ['m1']);
  });

  it('can be deleted, in two taps', async () => {
    const { api, say } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open My lunge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete exercise' }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('mine'));
    expect(say).toHaveBeenCalledWith('Deleted "My lunge".');
  });
});

describe('the exercises that came with the app', () => {
  it('cannot be rewritten or deleted, but can be linked to machines', async () => {
    const { api } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open Squat' }));
    expect(screen.getByRole('note')).toHaveTextContent('came with the app');
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Sets')).toBeDisabled();
    expect(screen.getByLabelText('legs')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete exercise' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Treadmill'));
    fireEvent.click(screen.getByRole('button', { name: 'Save machines' }));
    await waitFor(() => expect(api.addLinks).toHaveBeenCalledWith('sq', ['m3']));
    expect(api.update).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('can be copied to make my own version, with its links', async () => {
    const { api, say } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open Squat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make my own copy' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Squat (mine)', cue: 'Brace', muscles: ['legs', 'glutes'] }),
    );
    expect(api.addLinks).toHaveBeenCalledWith('new-id', ['m1']);
    expect(say).toHaveBeenCalledWith(expect.stringContaining('Squat (mine)'));
  });
});

describe('adding many at once', () => {
  async function importText(text: string, api = fakeApi()) {
    const out = mount(api);
    fireEvent.click(screen.getByText('Add many exercises at once'));
    fireEvent.change(screen.getByLabelText('Paste lines here'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    return out;
  }

  it('makes new ones with their machines, extends existing ones, and says what happened', async () => {
    const { api } = await importText(
      'Goblet squat | legs | Smith machine | I | 3 | 12 | 60 | Elbows in\nsquat | glutes | Treadmill, Mystery',
    );
    await waitFor(() =>
      expect(screen.getByText(/Added 1, updated 1\. Equipment not found: Mystery\./)).toBeInTheDocument(),
    );
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Goblet squat', level: 'I', reps: '12', cue: 'Elbows in' }),
    );
    expect(api.addLinks).toHaveBeenCalledWith('new-id', ['m2']);
    // the shared "Squat" is only linked, never rewritten
    expect(api.addLinks).toHaveBeenCalledWith('sq', ['m3']);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('adds muscles and a cue to one of my own, but nothing is changed on a shared one', async () => {
    const { api } = await importText('my lunge | glutes, core | | | | | | Chest up');
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(
      'mine',
      expect.objectContaining({ muscles: ['legs', 'glutes', 'core'], cue: 'Tall' }),
    );
  });

  it('asks for some lines when there are none, and refuses lines with no name', async () => {
    await importText('');
    expect(screen.getByText('Paste some lines first.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Paste lines here'), { target: { value: ' | legs | ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText('Nothing to add: those lines have no exercise name.')).toBeInTheDocument();
  });
});

describe('the demo link in the machine pop-up', () => {
  const equipment = layout.equipment[0]!;
  const props = { equipment, place: 'Strength', inSession: {}, onAdd: vi.fn(), onClose: vi.fn() };
  it('shows a Watch demo link only for exercises that have one, opening safely in a new tab', () => {
    render(<MachinePopup {...props} exercises={[lib[2]!, lib[0]!]} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://x.co/v');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(links[0]).toHaveAccessibleName('Watch a demo of My lunge');
  });
});

describe('the library without a gym or a service', () => {
  it('waits for the floor plan, and says when it is unavailable', () => {
    const { unmount } = render(
      <LibraryTab library={lib} layout={null} api={fakeApi()} onChanged={() => {}} say={() => {}} />,
    );
    expect(screen.getByText('Waiting for the floor plan…')).toBeInTheDocument();
    unmount();
    render(<LibraryTab library={lib} layout={layout} api={null} onChanged={() => {}} say={() => {}} />);
    expect(screen.getByText('The library is not available yet.')).toBeInTheDocument();
  });
  void ({} as ExerciseInput);
});
