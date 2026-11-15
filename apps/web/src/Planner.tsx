import { useState } from 'react';
import type { GymSummary } from '@pt/core';
import { TABS, type Mode, type TabId } from './tabs.ts';
import { GymBar } from './components/GymBar.tsx';

interface Props {
  gyms: GymSummary[];
  onSignOut: () => void;
}

export function Planner({ gyms, onSignOut }: Props) {
  const [mode, setMode] = useState<Mode>('plan');
  const [tab, setTab] = useState<TabId>('zone');
  const [gymId, setGymId] = useState(gyms[0]?.id ?? '');
  const gym = gyms.find((g) => g.id === gymId) ?? gyms[0];

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

  const name = [gym.name, gym.branch].filter(Boolean).join(' ');
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

      <GymBar gyms={gyms} gymId={gym.id} onChange={setGymId} />

      <main className="grid">
        <section className="mapcol" aria-label="Gym floor map">
          <div className="mapscroll">
            <div className="map-placeholder">Floor plan arrives in Phase 2</div>
          </div>
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
