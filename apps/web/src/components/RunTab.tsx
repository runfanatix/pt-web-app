import { useEffect, useState } from 'react';
import {
  estimateSeconds,
  fmtClock,
  isActive,
  stepState,
  type HistoryEntry,
  type Layout,
  type RunState,
  type SessionItem,
} from '@pt/core';
import type { Template, TemplateApi } from '../data/templates.ts';
import { ConfirmButton } from './ConfirmButton.tsx';

type Equip = Layout['equipment'][number];

const LABEL = {
  ready: 'In routine',
  now: 'Now',
  next: 'Still to do',
  done: 'Done',
  skip: 'Skipped',
} as const;

interface Props {
  run: RunState;
  items: SessionItem[];
  equipById: Map<string, Equip>;
  templates: TemplateApi | null;
  history: HistoryEntry[] | null;
  historyError: string;
  onStart: () => void;
  onEnd: () => void;
  onReset: () => void;
  onGo: (uid: string) => void;
  onCopyLog: () => void;
  /** Replace the session with a template (not allowed during a run). */
  onLoadTemplate: (t: Template) => void;
  onCopyEntry: (e: HistoryEntry) => void;
  onDeleteEntry: (e: HistoryEntry) => void;
  status: string;
  /** What the pop-ups and rows call the place of a machine. */
  place: (e: Equip) => string;
}

export function RunTab({
  run,
  items,
  equipById,
  templates,
  history,
  historyError,
  onStart,
  onEnd,
  onReset,
  onGo,
  onCopyLog,
  onLoadTemplate,
  onCopyEntry,
  onDeleteEntry,
  status,
  place,
}: Props) {
  const active = isActive(run);
  const doneN = run.order.length;
  const planned = Math.round(estimateSeconds(items) / 60);

  return (
    <div className="stack">
      <h2>Live run</h2>

      {templates && <WorkoutPicker api={templates} disabled={active} onLoad={onLoadTemplate} />}

      {!items.length ? (
        <p className="empty">
          Choose a workout above, or build a session first: click machines on the plan and add exercises.
        </p>
      ) : (
        <>
          {run.status === 'idle' && (
            <p className="sub">
              Machines in your routine are blue. Start the workout and the current machine turns orange,
              machines still to do turn red with a red route to them, and finished ones go grey. Each machine
              is timed.
            </p>
          )}
          <ol className="runlist" aria-label="Workout steps">
            {items.map((it, i) => {
              const st = run.steps[it.uid] ?? { ms: 0, done: false };
              const ss = stepState(run, it.uid);
              const e = equipById.get(it.eid);
              return (
                <li key={it.uid} className={`ri st-${ss}`}>
                  <span className="num">{i + 1}</span>
                  <div className="txt">
                    <strong>{e ? e.name : 'Removed equipment'}</strong>
                    <span className="sub">{`${it.exercise} · ${it.sets} x ${it.reps}`}</span>
                    <span className="chipst">
                      {ss === 'now' && run.status === 'paused' ? 'Paused' : LABEL[ss]}
                    </span>
                  </div>
                  {run.status !== 'idle' && (
                    <div className="rtime">
                      <b>{fmtClock(st.ms)}</b>
                      {active && ss === 'next' && (
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Go to ${e ? e.name : 'machine'} now`}
                          onClick={() => onGo(it.uid)}
                        >
                          Go now
                        </button>
                      )}
                    </div>
                  )}
                  <span className="sr">{e ? place(e) : ''}</span>
                </li>
              );
            })}
          </ol>

          {run.status !== 'idle' && (
            <div className="summary" aria-label="Run summary">
              <div className="nums">
                <span>
                  <b>{fmtClock(run.total)}</b> total
                </span>
                <span>
                  <b>{doneN}</b> of {items.length} done
                </span>
                <span>
                  <b>~{planned}</b> min planned
                </span>
              </div>
            </div>
          )}

          <div className="btnrow">
            {run.status === 'idle' && (
              <button type="button" className="btn primary" onClick={onStart}>
                Start workout
              </button>
            )}
            {active && (
              <ConfirmButton className="btn danger" onConfirm={onEnd}>
                End workout
              </ConfirmButton>
            )}
            {run.status !== 'idle' && (
              <button type="button" className="btn" onClick={onCopyLog}>
                Copy workout log
              </button>
            )}
            {active ? (
              <ConfirmButton className="btn danger" onConfirm={onReset}>
                Reset
              </ConfirmButton>
            ) : run.status === 'finished' ? (
              <button type="button" className="btn" onClick={onReset}>
                Reset
              </button>
            ) : null}
          </div>
        </>
      )}
      <p role="status" aria-live="polite" className="sub">
        {status}
      </p>

      <h3>Past runs</h3>
      {historyError ? (
        <p className="empty" role="alert">
          {historyError}
        </p>
      ) : history === null ? (
        <p className="sub">Loading…</p>
      ) : (
        <HistoryList
          entries={history.slice(0, 10)}
          total={history.length}
          onCopy={onCopyEntry}
          onDelete={onDeleteEntry}
        />
      )}
    </div>
  );
}

/** Loads a saved workout into the session from the Run tab. Disabled during a run. */
function WorkoutPicker({
  api,
  disabled,
  onLoad,
}: {
  api: TemplateApi;
  disabled: boolean;
  onLoad: (t: Template) => void;
}) {
  const [list, setList] = useState<Template[]>([]);
  useEffect(() => {
    let live = true;
    api.list().then(
      (l) => live && setList(l),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [api]);
  return (
    <label>
      Workout
      <select
        value=""
        disabled={disabled}
        aria-label="Load a saved workout"
        onChange={(e) => {
          const t = list.find((x) => x.id === e.target.value);
          if (t) onLoad(t);
        }}
      >
        <option value="">{list.length ? 'Load a saved workout…' : 'No saved workouts yet'}</option>
        {list.map((t) => (
          <option key={t.id} value={t.id}>
            {`${t.name} (${t.items.length} exercises)`}
          </option>
        ))}
      </select>
    </label>
  );
}

function HistoryList({
  entries,
  total,
  onCopy,
  onDelete,
}: {
  entries: HistoryEntry[];
  total: number;
  onCopy: (e: HistoryEntry) => void;
  onDelete: (e: HistoryEntry) => void;
}) {
  if (!entries.length) {
    return <p className="empty">No completed runs yet. Finish a run in the Run tab and it is saved here.</p>;
  }
  return (
    <>
      <ul className="stack" aria-label="Past runs">
        {entries.map((r) => (
          <li key={r.id}>
            <details className="hist">
              <summary>
                <strong>{r.title}</strong>
                <span className="sub">
                  {r.date}
                  {r.clientName ? ` · ${r.clientName}` : ''} · {fmtClock(r.totalMs)} · {r.doneN}/
                  {r.steps.length} done
                </span>
              </summary>
              <p className="sub">
                {r.gymName ? `Gym: ${r.gymName}. ` : ''}Planned about {r.plannedMin} min. Actual{' '}
                {fmtClock(r.totalMs)}.
              </p>
              <ol className="hrows">
                {r.steps.map((s) => (
                  <li key={s.n}>
                    <span>
                      {s.n}. {s.machine || 'Machine'} <span className="sub">{s.exercise}</span>
                    </span>
                    <b>
                      {s.done || s.ms ? fmtClock(s.ms) : '-'}
                      {s.done ? '' : ' not done'}
                    </b>
                  </li>
                ))}
              </ol>
              <div className="btnrow">
                <button
                  type="button"
                  className="btn sm"
                  aria-label={`Copy log for ${r.title}`}
                  onClick={() => onCopy(r)}
                >
                  Copy log
                </button>
                <ConfirmButton aria-label={`Delete run ${r.title}`} onConfirm={() => onDelete(r)}>
                  Delete
                </ConfirmButton>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {total > entries.length && (
        <p className="sub">
          Showing the latest {entries.length} of {total}.
        </p>
      )}
    </>
  );
}
