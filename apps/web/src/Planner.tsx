import { useState } from 'react';
import type { GymSummary } from '@pt/core';
import { TABS, type Mode, type TabId } from './tabs.ts';
import { GymBar } from './components/GymBar.tsx';
import { FloorPlan } from './components/FloorPlan.tsx';
import { FloorTabs, Legend, MuscleChips } from './components/PlanControls.tsx';
import { useLayout, type LayoutLoader } from './data/useLayout.ts';

interface Props {
  gyms: GymSummary[];
  loadLayout: LayoutLoader;
  onSignOut: () => void;
}

export function Planner({ gyms, loadLayout, onSignOut }: Props) {
  const [mode, setMode] = useState<Mode>('plan');
  const [tab, setTab] = useState<TabId>('zone');
  const [gymId, setGymId] = useState(gyms[0]?.id ?? '');
  const [floorId, setFloorId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [selZone, setSelZone] = useState<string | null>(null);
  const [selEq, setSelEq] = useState<string | null>(null);
  const gym = gyms.find((g) => g.id === gymId) ?? gyms[0];
  const layoutState = useLayout(loadLayout, gym?.id ?? null);

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

  const name = [gym.name, gym.branch].filter(Boolean).join(' ');
  const layout = layoutState.status === 'ready' ? layoutState.layout : null;
  const activeFloor = layout ? (layout.floors.find((f) => f.id === floorId) ?? layout.floors[0]!) : null;
  const hint =
    mode === 'edit'
      ? 'Layout editing arrives in a later phase. For now the plan is read-only.'
      : 'Click a zone to label all of its equipment. Pick a muscle to highlight the machines that train it.';

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
              <FloorTabs floors={layout.floors} floorId={activeFloor.id} onChange={changeFloor} />
              <MuscleChips filter={filter} onChange={setFilter} />
            </>
          )}
          <div className="mapscroll">
            {layoutState.status === 'loading' && (
              <div className="map-placeholder">Loading the floor plan…</div>
            )}
            {layoutState.status === 'error' && (
              <div className="map-placeholder" role="alert">
                {`Could not load the floor plan: ${layoutState.message}`}
              </div>
            )}
            {layout && activeFloor && (
              <FloorPlan
                layout={layout}
                floorId={activeFloor.id}
                filter={filter}
                selZone={selZone}
                selEq={selEq}
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
              </button>
            ))}
          </div>
          <div id="panelBody" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel-body">
            <p className="hint">{TABS.find((t) => t.id === tab)?.label} tab: not built yet.</p>
          </div>
        </aside>
      </main>
    </div>
  );
}
