import { useEffect, useMemo, useState } from 'react';
import {
  buildHistoryEntry,
  fmtClock,
  isActive,
  itemsPerFloor,
  setProgress,
  stepState,
  type Layout,
  type RunState,
  type SharedProgramme,
} from '@pt/core';
import type { PortalApi } from '../data/portal.ts';
import { useRun } from '../run/useRun.ts';
import { newUid } from '../session/sessionState.ts';
import { FloorPlan } from '../components/FloorPlan.tsx';
import { FloorTabs } from '../components/PlanControls.tsx';
import { RunHud } from '../components/RunHud.tsx';

type Equip = Layout['equipment'][number];

const LABEL = {
  ready: 'To do',
  now: 'Now',
  next: 'Still to do',
  done: 'Done',
  skip: 'Skipped',
} as const;

/**
 * The client runs their own programme on their phone: the same run bar, rest countdown and live plan the trainer
 * uses. When they finish, the workout is saved for them and shows in their trainer's history.
 */
export function PortalRun({
  programmeId,
  p,
  api,
  onExit,
}: {
  programmeId: string;
  p: SharedProgramme;
  api: PortalApi;
  onExit: () => void;
}) {
  const items = p.items;
  const layout = p.layout;
  const rc = useRun(items, `portal:${programmeId}`);
  const run = rc.run;
  const [floorId, setFloorId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const equipById = useMemo(() => new Map((layout?.equipment ?? []).map((e) => [e.id, e])), [layout]);
  const zoneName = new Map((layout?.zones ?? []).map((z) => [z.id, z.name]));
  const floorName = new Map((layout?.floors ?? []).map((f) => [f.id, f.name]));
  const place = (e: Equip) =>
    ((layout?.floors.length ?? 0) > 1 ? `${floorName.get(e.floor) ?? ''} · ` : '') +
    (zoneName.get(e.zone) ?? '');
  const floor = layout ? (layout.floors.find((f) => f.id === floorId) ?? layout.floors[0]!) : null;
  const sp = setProgress(run, items);

  // Follow the current machine onto its floor.
  useEffect(() => {
    const it = run.cur ? items.find((i) => i.uid === run.cur) : undefined;
    const e = it ? equipById.get(it.eid) : undefined;
    if (e) setFloorId(e.floor);
  }, [run.cur, items, equipById]);

  async function save(r: RunState) {
    const id = r.histId || newUid();
    const entry = buildHistoryEntry({
      id,
      run: r,
      items,
      meta: { title: p.title, client: '', clientId: '', coach: '', date: p.assignedOn, notes: '' },
      equipment: equipById,
      place,
      gym: { id: '', name: p.gymName },
    });
    if (!entry) return setMsg('Workout finished.');
    rc.markSaved(id);
    try {
      const ok = await api.saveRun(programmeId, entry);
      setMsg(
        ok
          ? `Well done! Workout finished in ${fmtClock(r.total)} and saved to your history.`
          : 'Workout finished, but it could not be saved.',
      );
    } catch (err) {
      setMsg(
        `Workout finished, but it could not be saved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  function next() {
    const r = rc.next();
    if (r.status === 'finished') void save(r);
  }
  function end() {
    const r = rc.finish();
    if (r.status === 'finished') void save(r);
  }

  return (
    <div className="wrap">
      <button type="button" className="btn sm" onClick={onExit} disabled={run.status === 'running'}>
        ← Back to my programme
      </button>
      <header className="top">
        <div>
          <p className="eyebrow">{[p.trainerName, p.gymLine].filter(Boolean).join(' · ')}</p>
          <h1>{p.title}</h1>
          <p className="lede">
            Do the exercises in order, or tap a machine on the plan to jump to it. Tap Set done after each
            set.
          </p>
        </div>
      </header>

      <RunHud
        run={run}
        items={items}
        equipById={equipById}
        title={p.title}
        client=""
        onStart={rc.start}
        onPause={rc.pause}
        onResume={rc.resume}
        onBack={rc.back}
        onNext={next}
        onCompleteSet={rc.completeSet}
        onSkipRest={rc.skipRest}
        onReset={rc.reset}
      />
      <p role="status" aria-live="polite" className="hint">
        {msg}
      </p>

      <main className="grid">
        <section className="mapcol" aria-label="Gym floor map">
          {layout && floor ? (
            <>
              <FloorTabs
                floors={layout.floors}
                floorId={floor.id}
                counts={itemsPerFloor(items, equipById)}
                onChange={setFloorId}
              />
              <div className="mapscroll">
                <FloorPlan
                  layout={layout}
                  floorId={floor.id}
                  filter="all"
                  selZone={null}
                  selEq={null}
                  items={items}
                  run={run}
                  onSelectZone={() => {}}
                  onSelectEq={(id) => id && isActive(run) && rc.jumpToMachine(id)}
                />
              </div>
            </>
          ) : (
            <p className="empty">There is no gym plan for this programme.</p>
          )}
        </section>
        <section className="panel" aria-label="Workout steps">
          <div className="panel-body stack">
            <ol className="runlist" aria-label="Workout steps">
              {items.map((it, i) => {
                const st = run.steps[it.uid] ?? { ms: 0, done: false };
                const ss = stepState(run, it.uid);
                const e = equipById.get(it.eid);
                return (
                  <li key={it.uid} className={`ri st-${ss}`}>
                    <span className="num">{i + 1}</span>
                    <div className="txt">
                      <strong>{it.exercise}</strong>
                      <span className="sub">{`${e ? e.name : ''}${e ? ' · ' : ''}${it.sets} x ${it.reps}`}</span>
                      {it.note && <span className="sub">{it.note}</span>}
                      <span className="chipst">
                        {ss === 'now'
                          ? `${run.status === 'paused' ? 'Paused' : run.restLeft !== null ? 'Resting' : 'Now'}${sp && sp.sets > 1 ? ` · set ${sp.setNo} of ${sp.sets}` : ''}`
                          : LABEL[ss]}
                      </span>
                    </div>
                    {run.status !== 'idle' && (
                      <div className="rtime">
                        <b>{fmtClock(st.ms)}</b>
                        {isActive(run) && ss === 'next' && (
                          <button
                            type="button"
                            className="btn sm"
                            aria-label={`Go to ${it.exercise} now`}
                            onClick={() => rc.go(it.uid)}
                          >
                            Go now
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {isActive(run) && (
              <div className="btnrow">
                <button type="button" className="btn" onClick={end}>
                  Finish early
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
