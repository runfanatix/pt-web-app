import { useEffect, useRef, useState } from 'react';
import {
  exercisesFor,
  itemsPerFloor,
  remapItems,
  type GymSummary,
  type Layout,
  type LibraryExercise,
} from '@pt/core';
import { TABS, type Mode, type TabId } from './tabs.ts';
import { GymBar } from './components/GymBar.tsx';
import { FloorPlan } from './components/FloorPlan.tsx';
import { FloorTabs, Legend, MuscleChips } from './components/PlanControls.tsx';
import { MachinePopup } from './components/MachinePopup.tsx';
import { SessionTab } from './components/SessionTab.tsx';
import { TemplatesPanel } from './components/TemplatesPanel.tsx';
import { ZonesTab } from './components/ZonesTab.tsx';
import { useGymData, type GymDataLoader } from './data/useLayout.ts';
import type { Template, TemplateApi } from './data/templates.ts';
import { useSession } from './session/useSession.ts';

interface Props {
  gyms: GymSummary[];
  loadGym: GymDataLoader;
  /** Null until the trainer profile has loaded; templates are unavailable until then. */
  templates: TemplateApi | null;
  onSignOut: () => void;
}

interface ToastState {
  msg: string;
  /** Offer a "View session" shortcut (when the Session tab is not open). */
  view: boolean;
}

export function Planner({ gyms, loadGym, templates, onSignOut }: Props) {
  const [mode, setMode] = useState<Mode>('plan');
  const [tab, setTab] = useState<TabId>('zone');
  const [gymId, setGymId] = useState(gyms[0]?.id ?? '');
  const [floorId, setFloorId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [selZone, setSelZone] = useState<string | null>(null);
  const [selEq, setSelEq] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gym = gyms.find((g) => g.id === gymId) ?? gyms[0];
  const gymState = useGymData(loadGym, gym?.id ?? null);
  const { session, dispatch } = useSession(gym?.id ?? null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  if (!gym) {
    return (
      <div className="wrap">
        <p className="eyebrow">PT Planner</p>
        <h1>No gym yet</h1>
        <p className="lede">
          Your account has no gyms. Import one with <code>scripts/import-prototype.ts</code> (see
          docs/05-import-script.md).
        </p>
        <button type="button" className="btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  const data = gymState.status === 'ready' ? gymState.data : null;
  const layout: Layout | null = data?.layout ?? null;
  const library: LibraryExercise[] = data?.library ?? [];
  const activeFloor = layout ? (layout.floors.find((f) => f.id === floorId) ?? layout.floors[0]!) : null;
  const equipById = new Map((layout?.equipment ?? []).map((e) => [e.id, e]));

  function say(msg: string, view = false) {
    clearTimeout(toastTimer.current);
    setToast({ msg, view });
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }
  function changeGym(id: string) {
    setGymId(id);
    setFloorId(null);
    setFilter('all');
    setSelZone(null);
    setSelEq(null);
  }
  function changeFloor(id: string) {
    setFloorId(id);
    setSelZone(null);
    setSelEq(null);
  }
  function addExercise(eid: string, x: LibraryExercise) {
    dispatch({ type: 'add', eid, exercise: x });
    say(`Added ${x.name} (${session.items.length + 1} in session)`, true);
  }
  function focusFirstFloor(eid: string | undefined) {
    const e = eid ? equipById.get(eid) : undefined;
    if (e) setFloorId(e.floor);
  }

  async function applyTemplate(t: Template, how: 'replace' | 'append') {
    if (!layout) return;
    const candidates = layout.equipment.map((e) => ({ id: e.id, name: e.name, type: e.type }));
    const present = new Set(candidates.map((c) => c.id));
    const links = Object.fromEntries(library.map((x) => [x.id, x.equipmentIds]));
    const missing = [...new Set(t.items.map((i) => i.eid).filter((id) => id && !present.has(id)))];
    let oldInfo = new Map<string, { name: string; type: string }>();
    if (missing.length && templates) {
      try {
        oldInfo = await templates.equipmentInfo(missing);
      } catch {
        /* without the old machine names the remap falls back to exercise links */
      }
    }
    const r = remapItems(t.items, candidates, links, oldInfo);
    dispatch(
      how === 'replace'
        ? { type: 'load', items: r.items, title: t.name, notes: t.notes }
        : { type: 'append', items: r.items },
    );
    setSelEq(null);
    focusFirstFloor(r.items[0]?.eid);
    setTab('session');
    const bits = [
      `${how === 'replace' ? 'Loaded' : 'Added'} "${t.name}" (${r.items.length} exercise${r.items.length === 1 ? '' : 's'})`,
    ];
    if (r.moved) bits.push(`${r.moved} moved to matching equipment`);
    if (r.skipped) bits.push(`${r.skipped} skipped: no matching equipment here`);
    say(bits.join('. ') + '.');
  }

  const name = [gym.name, gym.branch].filter(Boolean).join(' ');
  const popupEq = mode === 'plan' && selEq ? equipById.get(selEq) : undefined;
  const hint =
    mode === 'edit'
      ? 'Layout editing arrives in a later phase. For now the plan is read-only.'
      : 'Click a machine to see its exercises and add one to the session. Click a zone to label all of its equipment.';
  const zoneName = new Map((layout?.zones ?? []).map((z) => [z.id, z.name]));
  const floorName = new Map((layout?.floors ?? []).map((f) => [f.id, f.name]));
  const placeOf = (e: Layout['equipment'][number]) =>
    ((layout?.floors.length ?? 0) > 1 ? `${floorName.get(e.floor) ?? ''} · ` : '') +
    (zoneName.get(e.zone) ?? '');
  const gymNames = Object.fromEntries(gyms.map((g) => [g.id, [g.name, g.branch].filter(Boolean).join(' ')]));

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <p className="eyebrow">{[name, gym.address].filter(Boolean).join(' · ')}</p>
          <h1>{gym.branch || gym.name} Zone Planner</h1>
          <p className="lede">
            Click a machine on the plan, pick an exercise from its pop-up, and it lands in your session.
          </p>
        </div>
        <div className="topright">
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={mode === 'plan'} onClick={() => setMode('plan')}>
              Plan session
            </button>
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
              Edit layout
            </button>
          </div>
          <button type="button" className="btn sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <GymBar gyms={gyms} gymId={gym.id} onChange={changeGym} />

      <main className="grid">
        <section className="mapcol" aria-label="Gym floor map">
          {layout && activeFloor && (
            <>
              <FloorTabs
                floors={layout.floors}
                floorId={activeFloor.id}
                counts={itemsPerFloor(session.items, equipById)}
                onChange={changeFloor}
              />
              <MuscleChips filter={filter} onChange={setFilter} />
            </>
          )}
          <div className="mapscroll">
            {gymState.status === 'loading' && <div className="map-placeholder">Loading the floor plan…</div>}
            {gymState.status === 'error' && (
              <div className="map-placeholder" role="alert">
                {`Could not load the floor plan: ${gymState.message}`}
              </div>
            )}
            {layout && activeFloor && (
              <FloorPlan
                layout={layout}
                floorId={activeFloor.id}
                filter={filter}
                selZone={selZone}
                selEq={selEq}
                items={session.items}
                onSelectZone={setSelZone}
                onSelectEq={setSelEq}
              />
            )}
          </div>
          <Legend />
          <p className="hint">{hint}</p>
        </section>
        <aside className="panel" aria-label="Planner panel">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="panelBody"
                onClick={() => setTab(t.id)}
              >
                {t.id === 'zone' && mode === 'edit' ? 'Layout' : t.label}
                {t.id === 'session' ? ` (${session.items.length})` : ''}
              </button>
            ))}
          </div>
          <div id="panelBody" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel-body">
            {tab === 'zone' && layout && activeFloor && (
              <ZonesTab
                layout={layout}
                library={library}
                floorId={activeFloor.id}
                selEq={selEq}
                onSelectEq={setSelEq}
                onAdd={addExercise}
              />
            )}
            {tab === 'session' && layout && (
              <SessionTab
                meta={session.meta}
                items={session.items}
                layout={layout}
                library={library}
                dispatch={dispatch}
              >
                {templates ? (
                  <TemplatesPanel
                    api={templates}
                    gymId={gym.id}
                    gymNames={gymNames}
                    items={session.items}
                    title={session.meta.title}
                    notes={session.meta.notes}
                    onUse={(t, how) => void applyTemplate(t, how)}
                  />
                ) : null}
              </SessionTab>
            )}
            {!layout && (tab === 'zone' || tab === 'session') && (
              <p className="hint">Waiting for the floor plan…</p>
            )}
            {tab !== 'zone' && tab !== 'session' && (
              <p className="hint">{TABS.find((t) => t.id === tab)?.label} tab: not built yet.</p>
            )}
          </div>
        </aside>
      </main>

      {popupEq && layout && (
        <MachinePopup
          equipment={popupEq}
          place={placeOf(popupEq)}
          exercises={exercisesFor(library, popupEq.id)}
          inSession={session.items
            .filter((it) => it.eid === popupEq.id && it.xid)
            .reduce<Record<string, number>>((m, it) => ({ ...m, [it.xid!]: (m[it.xid!] ?? 0) + 1 }), {})}
          onAdd={(x) => addExercise(popupEq.id, x)}
          onClose={() => setSelEq(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast.msg}
          {toast.view && tab !== 'session' && (
            <button type="button" className="link" onClick={() => setTab('session')}>
              View session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
