import { describe, expect, it } from 'vitest';
import { exercisesFor, estimateSeconds, type Layout } from '@pt/core';
import { buildPdf, type PdfItem, type PdfModel } from './pdf.ts';
import { bedfordviewData } from '../test-utils.ts';

const data = bedfordviewData();
const layout = data.layout;
const machines = layout.equipment.filter((e) => exercisesFor(data.library, e.id).length > 0);
const zoneName = new Map(layout.zones.map((z) => [z.id, z.name]));

function item(i: number, over: Partial<PdfItem> = {}): PdfItem {
  const m = machines[i % machines.length]!;
  const x = exercisesFor(data.library, m.id)[0]!;
  return {
    eid: m.id,
    exercise: x.name,
    machine: m.name,
    zone: zoneName.get(m.zone) ?? '',
    sets: x.sets,
    reps: x.reps,
    rest: x.rest,
    note: '',
    cue: x.cue,
    ms: 0,
    done: false,
    ...over,
  };
}

function model(items: PdfItem[], over: Partial<PdfModel> = {}): PdfModel {
  return {
    title: 'Leg day',
    client: 'Sam Smith',
    coach: 'Dee',
    date: '2026-11-15',
    notes: 'Drink water.',
    gym: 'Virgin Active Bedfordview, 101 Van Buuren Rd',
    items,
    actual: null,
    plannedSecs: estimateSeconds(items),
    layout,
    ...over,
  };
}

/** The PDF is written uncompressed, so its text can be searched. */
const text = (m: PdfModel) => buildPdf(m).output();

describe('programme PDF', () => {
  const items = [item(0), item(5), item(10)];

  it('is a real PDF with the title, the details and every exercise', () => {
    const doc = buildPdf(model(items));
    const out = doc.output();
    expect(out.startsWith('%PDF-')).toBe(true);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(out).toContain('(TRAINING PROGRAMME)');
    expect(out).toContain('(Leg day)');
    expect(out).toContain('(Sam Smith)');
    expect(out).toContain('(Dee)');
    expect(out).toContain('(Virgin Active Bedfordview, 101 Van Buuren Rd)');
    for (const it of items) expect(out).toContain(`(${it.exercise})`);
    expect(out).toContain('(Drink water.)');
    expect(out).toContain('Page 1 of');
  });

  it('draws the route around the gym: heading, zone names and a numbered stop for each machine', () => {
    const out = text(model(items));
    expect(out).toContain('(Your route around the gym)');
    expect(out).toContain('(CARDIO)');
    for (const it of items) expect(out).toContain(`(${it.machine})`);
    expect(out).toMatch(/\(1\) Tj/);
    expect(out).toMatch(/\(3\) Tj/);
  });

  it('has no route map without a layout, and is smaller for it', () => {
    const out = text(model(items, { layout: null }));
    expect(out).not.toContain('Your route around the gym');
    expect(out.length).toBeLessThan(text(model(items)).length);
  });

  it('starts new pages for a long programme and numbers them', () => {
    const many = Array.from({ length: 40 }, (_, i) => item(i));
    const doc = buildPdf(model(many));
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    const out = doc.output();
    expect(out).toContain(`of ${doc.getNumberOfPages()})`);
    expect(out).toContain('(40)');
  });

  it('shows a machine that has been removed from the plan without a stop, and still lists the exercise', () => {
    const out = text(model([item(0, { eid: 'gone', machine: '', zone: '', exercise: 'Plank' })]));
    expect(out).toContain('(Plank)');
  });

  it('replaces characters the PDF fonts cannot show', () => {
    const out = text(model([item(0, { exercise: 'Push‑up 你好', note: 'Don’t rush – slow' })]));
    expect(out).toContain("Don't rush - slow");
    expect(out).toContain('??');
    expect(out).not.toContain('你');
  });

  it('prints nothing it was not given: only the programme fields appear', () => {
    const out = text(model(items));
    expect(out).not.toMatch(/@|whatsapp|private|goals|date of birth|emergency/i);
  });

  it('draws joined zones and shared stairs without failing', () => {
    const joined: Layout = {
      ...layout,
      zones: layout.zones.map((z, i) =>
        i === 0 ? { ...z, parts: [{ x: z.x + z.w, y: z.y, w: 60, h: 60 }] } : z,
      ),
    };
    expect(() => buildPdf(model(items, { layout: joined }))).not.toThrow();
  });
});

describe('workout results PDF', () => {
  const run = [
    item(0, { ms: 65_000, done: true }),
    item(5, { ms: 30_000, done: true }),
    item(10, { ms: 12_000, done: false }),
  ];

  it('adds the actual times, the total, and marks a step started but not finished', () => {
    const out = text(model(run, { actual: { totalMs: 107_000 } }));
    expect(out).toContain('(WORKOUT RESULTS)');
    expect(out).toContain('(ACTUAL)');
    expect(out).toContain('(01:05)');
    expect(out).toContain('(00:30)');
    expect(out).toContain('(00:12*)');
    expect(out).toContain('(Total workout time)');
    expect(out).toContain('(01:47)');
    expect(out).toContain('* started but not completed');
    expect(out).toContain('(Route around the gym)');
  });

  it('a programme PDF has no ACTUAL column', () => {
    expect(text(model(run))).not.toContain('(ACTUAL)');
  });
});
