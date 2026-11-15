import { estimateSeconds, type ItemSnap, type Layout, type LibraryExercise, type ShareModel } from '@pt/core';
import type { PdfModel } from './pdf.ts';

interface Input {
  title: string;
  client: string;
  coach: string;
  date: string;
  notes: string;
  /** "Virgin Active Bedfordview, 101 Van Buuren Rd". */
  gym: string;
  items: ItemSnap[];
  /**
   * The layout of the gym these items belong to, used for machine names and the route map. Pass null when the
   * items belong to a different gym than the one that is open: the exercises are still listed, without machines.
   */
  layout: Layout | null;
  library?: LibraryExercise[];
}

/** One description of a routine, used for the text message, the email and the PDF. Contains nothing private. */
export function buildShare(i: Input): { model: ShareModel; pdf: PdfModel } {
  const equip = new Map((i.layout?.equipment ?? []).map((e) => [e.id, e]));
  const zoneName = new Map((i.layout?.zones ?? []).map((z) => [z.id, z.name]));
  const floorName = new Map((i.layout?.floors ?? []).map((f) => [f.id, f.name]));
  const multi = (i.layout?.floors.length ?? 0) > 1;
  const cueOf = new Map((i.library ?? []).map((x) => [x.id, x.cue]));

  const rows = i.items.map((it) => {
    const e = equip.get(it.eid);
    return {
      eid: e ? e.id : '',
      exercise: it.exercise,
      machine: e ? e.name : '',
      zone: e ? (multi ? `${floorName.get(e.floor) ?? ''} · ` : '') + (zoneName.get(e.zone) ?? '') : '',
      sets: it.sets,
      reps: it.reps,
      rest: it.rest,
      note: it.note,
      cue: it.xid ? (cueOf.get(it.xid) ?? '') : '',
    };
  });
  const model: ShareModel = {
    title: i.title,
    client: i.client,
    coach: i.coach,
    date: i.date,
    notes: i.notes,
    gym: i.gym,
    items: rows,
  };
  return {
    model,
    pdf: {
      ...model,
      items: rows.map((r) => ({ ...r, ms: 0, done: false })),
      actual: null,
      plannedSecs: estimateSeconds(i.items),
      layout: i.layout,
    },
  };
}
