import { useState } from 'react';
import { TABS, type Mode, type TabId } from './tabs.ts';
import { GymBar } from './components/GymBar.tsx';

// Placeholder gym until Phase 1 loads it from the database.
const GYM = { name: 'Virgin Active', branch: 'Bedfordview', address: '101 Van Buuren Rd' };

export function App() {
  const [mode, setMode] = useState<Mode>('plan');
  const [tab, setTab] = useState<TabId>('zone');

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <p className="eyebrow">
            {GYM.name} {GYM.branch} &middot; {GYM.address}
          </p>
          <h1>{GYM.branch} Zone Planner</h1>
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
        </div>
      </header>

      <GymBar name={GYM.name} branch={GYM.branch} address={GYM.address} />

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
