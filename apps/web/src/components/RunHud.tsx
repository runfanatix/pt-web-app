import { useState } from 'react';
import {
  estimateSeconds,
  fmtClock,
  isActive,
  nextUndone,
  setProgress,
  type Layout,
  type RunState,
  type SessionItem,
} from '@pt/core';
import { alertsEnabled, setAlertsEnabled } from '../lib/alerts.ts';

type Equip = Layout['equipment'][number];

interface Props {
  run: RunState;
  items: SessionItem[];
  equipById: Map<string, Equip>;
  title: string;
  client: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onBack: () => void;
  onNext: () => void;
  onCompleteSet: () => void;
  onSkipRest: () => void;
  onCopyLog: () => void;
  onReset: () => void;
}

/** The bar above the plan during a run: clocks, the current machine and set, the rest countdown, and the big buttons. */
export function RunHud({
  run,
  items,
  equipById,
  title,
  client,
  onStart,
  onPause,
  onResume,
  onBack,
  onNext,
  onCompleteSet,
  onSkipRest,
  onCopyLog,
  onReset,
}: Props) {
  const [alerts, setAlerts] = useState(alertsEnabled);
  const planned = Math.round(estimateSeconds(items) / 60);
  const doneN = run.order.length;

  if (run.status === 'idle') {
    return (
      <div className="hud st-ready" role="region" aria-label="Live workout">
        <div className="hudnow">
          <span className="lab">Ready</span>
          <strong>
            {title || 'Workout'}
            {client ? ` · ${client}` : ''}
          </strong>
          <span className="sub">
            {items.length} step{items.length === 1 ? '' : 's'}, about {planned} min planned. Press start when
            the client begins.
          </span>
        </div>
        <div className="hudbtns">
          <button type="button" className="btn primary big" onClick={onStart}>
            Start workout
          </button>
        </div>
      </div>
    );
  }

  if (run.status === 'finished') {
    return (
      <div className="hud st-done" role="region" aria-label="Live workout">
        <div className="clock">
          <span className="lab">Total time</span>
          <b>{fmtClock(run.total)}</b>
        </div>
        <div className="hudnow">
          <span className="lab">Workout finished</span>
          <strong>
            {doneN} of {items.length} steps done
          </strong>
          <span className="sub">Planned about {planned} min</span>
        </div>
        <div className="hudbtns">
          <button type="button" className="btn big" onClick={onCopyLog}>
            Copy log
          </button>
          <button type="button" className="btn big" disabled={!doneN} onClick={onBack}>
            Undo last
          </button>
          <button type="button" className="btn primary big" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
    );
  }

  const it = items.find((i) => i.uid === run.cur);
  const e = it ? equipById.get(it.eid) : undefined;
  const curMs = run.cur ? (run.steps[run.cur]?.ms ?? 0) : 0;
  const last = !nextUndone(run, items, run.cur);
  const paused = run.status === 'paused';
  const sp = setProgress(run, items);
  const resting = run.restLeft !== null;
  const multiSet = !!sp && sp.sets > 1;

  return (
    <div className={`hud ${resting ? 'st-rest' : 'st-now'}`} role="region" aria-label="Live workout">
      <div className="clock">
        <span className="lab">Total</span>
        <b role="timer" aria-label="Total time">
          {fmtClock(run.total)}
        </b>
      </div>
      {resting ? (
        <div className="clock rest">
          <span className="lab">Rest</span>
          <b role="timer" aria-label="Rest left">
            {fmtClock(run.restLeft ?? 0)}
          </b>
        </div>
      ) : (
        <div className="clock">
          <span className="lab">At machine</span>
          <b>{fmtClock(curMs)}</b>
        </div>
      )}
      <div className="hudnow">
        <span className="lab">
          {paused ? 'Paused' : resting ? 'Rest' : 'Now'} · step {Math.min(doneN + 1, items.length)} of{' '}
          {items.length}
          {multiSet && sp ? ` · set ${sp.setNo} of ${sp.sets}` : ''}
        </span>
        <strong>{e ? e.name : 'Machine'}</strong>
        <span className="sub">
          {resting && sp
            ? `Rest, then set ${sp.setNo} of ${sp.sets}`
            : it
              ? `${it.exercise} · ${it.sets} x ${it.reps}`
              : ''}
        </span>
      </div>
      <div className="hudbtns">
        <button type="button" className="btn big" onClick={paused ? onResume : onPause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn big" disabled={!doneN} onClick={onBack}>
          Back
        </button>
        {resting ? (
          <button type="button" className="btn now big" onClick={onSkipRest}>
            Skip rest
          </button>
        ) : multiSet && sp && !sp.lastSet ? (
          <button type="button" className="btn now big" onClick={onCompleteSet}>
            Set done
          </button>
        ) : (
          <button type="button" className="btn now big" onClick={onNext} disabled={!isActive(run)}>
            {last ? 'Done, finish' : 'Done, next'}
          </button>
        )}
        {multiSet && sp && (resting || !sp.lastSet) && (
          <button type="button" className="btn big" onClick={onNext}>
            {last ? 'Finish' : 'Next machine'}
          </button>
        )}
        <button
          type="button"
          className="btn sm"
          aria-pressed={alerts}
          title="Vibrate and beep when a rest ends"
          onClick={() => {
            setAlerts(!alerts);
            setAlertsEnabled(!alerts);
          }}
        >
          Rest alert: {alerts ? 'on' : 'off'}
        </button>
      </div>
    </div>
  );
}
