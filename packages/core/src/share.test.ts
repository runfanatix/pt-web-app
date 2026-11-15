import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  firstName,
  mailtoUrl,
  parseSharedProgramme,
  pdfFileName,
  pdfSafe,
  routineText,
  shareUrl,
  tokenFromPath,
  waNumber,
  whatsappUrl,
  type ShareModel,
} from './share.ts';

/* the prototype's own pdfSafe and waNumber, as the reference */
const proto = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'prototype', 'zone-planner-v11.html'),
  'utf8',
);
function slice(from: string, to: string): string {
  const a = proto.indexOf(from);
  const b = proto.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`prototype markers not found: ${from}`);
  return proto.slice(a, b);
}
const reference = runInNewContext(
  `${slice('function pdfSafe(s)', 'function pdfModelSession')} ${slice('function waNumber(raw)', 'function refreshShare')} ({ pdfSafe, waNumber })`,
  {},
) as { pdfSafe: (s: unknown) => string; waNumber: (s: string) => string };

const model: ShareModel = {
  title: 'Leg day',
  client: 'Sam Smith',
  coach: 'Dee',
  date: '2026-11-15',
  notes: '  Drink water.  ',
  gym: 'Virgin Active Bedfordview, 101 Van Buuren Rd',
  items: [
    {
      exercise: 'Incline walk',
      machine: 'Treadmills',
      zone: 'Cardio',
      sets: 1,
      reps: '8 min',
      rest: 0,
      note: 'Easy pace',
      cue: '',
    },
    { exercise: 'Plank', machine: '', zone: '', sets: 3, reps: '30 s', rest: 45, note: '', cue: '' },
  ],
};

describe('routineText', () => {
  it('writes the programme the way the prototype did', () => {
    expect(routineText(model).split('\n')).toEqual([
      'Hi Sam,',
      'Here is your training programme.',
      '',
      '*Leg day*',
      'Client: Sam Smith',
      'Coach: Dee',
      'Gym: Virgin Active Bedfordview, 101 Van Buuren Rd',
      `Date: ${new Date('2026-11-15T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
      '',
      '1. Incline walk (Treadmills, Cardio)',
      '    1 x 8 min. Easy pace',
      '2. Plank',
      '    3 x 30 s, rest 45 s',
      '',
      'Drink water.',
    ]);
  });

  it('adds the link line only when asked, and leaves out what is empty', () => {
    expect(routineText(model, { link: 'https://app.example/p/abc' })).toContain(
      'See it on the gym plan: https://app.example/p/abc',
    );
    const bare = routineText({ ...model, client: '', coach: '', date: '', notes: '', gym: '', title: '' });
    expect(bare.split('\n')[0]).toBe('*Training programme*');
    expect(bare).not.toContain('Client:');
    expect(bare).not.toContain('Coach:');
    expect(bare).not.toContain('Hi ');
  });

  it('never contains anything beyond what it was given (no contact details or notes can sneak in)', () => {
    expect(routineText(model)).not.toMatch(/@|whatsapp|private/i);
  });
});

describe('links', () => {
  it('normalises South African numbers for WhatsApp, and agrees with the prototype', () => {
    expect(waNumber('082 123 4567')).toBe('27821234567');
    expect(waNumber('+27 82 123 4567')).toBe('27821234567');
    expect(waNumber('')).toBe('');
    for (const n of ['082 123 4567', '+27 (0)82-123-4567', '0116543210', 'abc', '27821234567', '  0 82 1 ']) {
      expect(waNumber(n)).toBe(reference.waNumber(n));
    }
  });

  it('builds the WhatsApp link with the encoded message', () => {
    expect(whatsappUrl('082 123 4567', 'Hi *you*')).toBe('https://wa.me/27821234567?text=Hi%20*you*');
    expect(whatsappUrl('', 'x')).toBe('https://wa.me/?text=x');
  });

  it('builds the mail link without the asterisks, and swaps a very long message for a short one', () => {
    const url = mailtoUrl('sam@example.com', model, '*Leg day*\nline');
    expect(url).toBe('mailto:sam%40example.com?subject=Leg%20day&body=Leg%20day%0Aline');
    const long = mailtoUrl('sam@example.com', model, 'x'.repeat(3000));
    expect(decodeURIComponent(long)).toContain('Your training programme is attached as a PDF.');
    expect(decodeURIComponent(long)).toContain('Hi Sam Smith');
    expect(decodeURIComponent(long)).toContain('Dee');
  });

  it('names the PDF file safely', () => {
    expect(pdfFileName({ client: 'Sam Smith', date: '2026-11-15' }, 'programme', '2026-01-01')).toBe(
      'training-programme-Sam-Smith-2026-11-15.pdf',
    );
    expect(pdfFileName({ client: '', date: '' }, 'results', '2026-01-01')).toBe(
      'workout-results-2026-01-01.pdf',
    );
    expect(pdfFileName({ client: 'Zoë / O’Neil', date: '2026-11-15' }, 'programme', 'x')).not.toMatch(
      /[\\/ ']/,
    );
  });

  it('builds and reads share URLs', () => {
    const token = 'a'.repeat(64);
    expect(shareUrl('https://app.example.com/', token)).toBe(`https://app.example.com/p/${token}`);
    expect(tokenFromPath(`/p/${token}`)).toBe(token);
    expect(tokenFromPath(`/p/${token}/`)).toBe(token);
    expect(tokenFromPath(`/p/${token.toUpperCase()}`)).toBe(token);
    for (const bad of [
      '/',
      '/p/',
      '/p/short',
      `/q/${token}`,
      `/p/${token}/extra`,
      '/p/not-hex-not-hex-not-hex',
    ]) {
      expect(tokenFromPath(bad)).toBeNull();
    }
  });

  it('firstName takes the first word', () => {
    expect(firstName('  Sam   Smith ')).toBe('Sam');
    expect(firstName('')).toBe('');
  });
});

describe('pdfSafe', () => {
  it('swaps typographic characters and replaces what the PDF fonts cannot show, like the prototype', () => {
    expect(pdfSafe('‘hi’ “there” – a → b… c · d')).toBe('\'hi\' "there" - a > b... c - d');
    expect(pdfSafe('Café')).toBe('Café');
    expect(pdfSafe('你好')).toBe('??');
    expect(pdfSafe(null)).toBe('');
    for (const s of ['plain', 'Zoë', '“q”', 'a—b', 'emoji 😀', 'tab\there']) {
      expect(pdfSafe(s)).toBe(reference.pdfSafe(s));
    }
  });
});

describe('parseSharedProgramme', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    title: 'Starter',
    notes: 'Easy',
    assigned_at: '2026-11-09T08:00:00+00:00',
    trainer: 'Alice Fitness',
    gym: { name: 'Virgin Active', branch: 'Bedfordview', address: '101 Van Buuren Rd' },
    items: [
      {
        position: 1,
        equipment_id: null,
        exercise_name: 'Plank',
        sets: 3,
        reps: '30 s',
        rest: 45,
        note: '',
        cue: 'Brace',
      },
      {
        position: 0,
        equipment_id: 'e1',
        exercise_name: 'Walk',
        sets: 1,
        reps: '8 min',
        rest: 0,
        note: 'Easy',
        cue: '',
      },
    ],
    floors: [],
    ...over,
  });

  it('reads the programme: items in order, a missing machine as an empty id, cues alongside', () => {
    const p = parseSharedProgramme(raw())!;
    expect(p).toMatchObject({
      title: 'Starter',
      notes: 'Easy',
      trainerName: 'Alice Fitness',
      assignedOn: '2026-11-09',
      gymName: 'Virgin Active Bedfordview',
      gymLine: 'Virgin Active Bedfordview, 101 Van Buuren Rd',
    });
    expect(p.items.map((i) => [i.exercise, i.eid])).toEqual([
      ['Walk', 'e1'],
      ['Plank', ''],
    ]);
    expect(p.cues).toEqual(['', 'Brace']);
    expect(p.layout).toBeNull();
  });

  it('returns null for a bad, revoked or expired link, and tolerates a programme with no gym', () => {
    expect(parseSharedProgramme(null)).toBeNull();
    expect(parseSharedProgramme(undefined)).toBeNull();
    const noGym = parseSharedProgramme(raw({ gym: null }))!;
    expect(noGym.gymName).toBe('');
    expect(noGym.gymLine).toBe('');
  });

  it('draws the layout when floors are present, and rejects malformed data', () => {
    const floors = [
      {
        id: 'f1',
        name: 'Ground',
        w: 1000,
        h: 620,
        position: 0,
        zones: [
          {
            id: 'z1',
            name: 'Cardio',
            category: 'cardio',
            x: 0,
            y: 0,
            w: 200,
            h: 100,
            zone_parts: [],
            equipment: [
              { id: 'e1', name: 'Treadmill', type: 'cardio', x: 10, y: 10, muscles: ['cardio'], notes: '' },
            ],
          },
        ],
        structs: [],
      },
    ];
    expect(parseSharedProgramme(raw({ floors }))!.layout!.equipment).toHaveLength(1);
    expect(() => parseSharedProgramme({ title: 'x' })).toThrow();
    expect(() => parseSharedProgramme(raw({ items: 'nope' }))).toThrow();
  });
});
