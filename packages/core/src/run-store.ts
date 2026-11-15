/**
 * Saving a run in progress so it survives a reload. Pure: the web app owns the storage; this validates what comes
 * back and decides what state to restore.
 */
import { z } from 'zod';
import type { RunState } from './run.ts';

export const RunStateSchema = z.object({
  status: z.enum(['idle', 'running', 'paused', 'finished']),
  total: z.number().min(0),
  last: z.number(),
  steps: z.record(z.object({ ms: z.number().min(0), done: z.boolean() })),
  order: z.array(z.string()),
  cur: z.string().nullable(),
  startedAt: z.number(),
  histId: z.string(),
  setNo: z.number().int().min(1),
  restLeft: z.number().min(0).nullable(),
  restEnds: z.number().int().min(0),
});

/** What is kept in the browser: the run and the gym it belongs to. */
export const StoredRunSchema = z.object({ v: z.literal(1), gymId: z.string(), run: RunStateSchema });
export type StoredRun = z.infer<typeof StoredRunSchema>;

export function storedRun(gymId: string, run: RunState): StoredRun {
  return { v: 1, gymId, run };
}

/**
 * The state to restore after a reload, or null if there is nothing worth restoring. Only a run in progress
 * is restored. A run that was running comes back **paused**: the time the page was closed is not the client's
 * workout time, and the trainer resumes when the client is ready. A rest that was counting down stays frozen.
 */
export function restoreRun(raw: unknown): { gymId: string; run: RunState } | null {
  const parsed = StoredRunSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { gymId, run } = parsed.data;
  if (run.status !== 'running' && run.status !== 'paused') return null;
  if (!run.cur || !run.steps[run.cur]) return null;
  return { gymId, run: { ...run, status: 'paused' } };
}
