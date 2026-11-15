import { useState } from 'react';
import {
  CATEGORIES,
  EQUIPMENT_TYPES,
  MUSCLES,
  addEquipment,
  addZone,
  deleteEquipment,
  deleteZone,
  moveZoneToFloor,
  partRect,
  renameEquipment,
  renameZone,
  setEquipmentFloor,
  setEquipmentNotes,
  setEquipmentZone,
  setZoneCategory,
  setZoneNumber,
  type Layout,
  type LibraryExercise,
} from '@pt/core';
import { ConfirmButton } from './ConfirmButton.tsx';
import { TYPE_LETTERS } from './FloorPlan.tsx';
import { newUid } from '../session/sessionState.ts';
import { FloorCard, StructCard, StructKey, ZoneShaping } from './LayoutPanels.tsx';

type Equip = Layout['equipment'][number];

interface Props {
  layout: Layout;
  /** Which floor the plan is showing: new zones land there. */
  floorId: string;
  snap: boolean;
  onSnap: (on: boolean) => void;
  selZone: string | null;
  selEq: string | null;
  part: number;
  onPart: (i: number) => void;
  onSelectZone: (id: string | null) => void;
  onSelectEq: (id: string | null) => void;
  selStruct: string | null;
  onSelectStruct: (id: string | null) => void;
  onGoToFloor: (id: string) => void;
  /** Machines copied by a duplicate, whose exercise links are copied after the layout is saved. */
  onCopies: (copies: { from: string; to: string }[]) => void;
  /** A change to the working copy. */
  onChange: (l: Layout) => void;
  library: LibraryExercise[];
  /** Machines that exist in the database (links can only be edited for these). */
  savedEquipment: Set<string>;
  onLink: (exerciseId: string, equipmentId: string, linked: boolean) => void;
  say: (msg: string) => void;
}

/** The Layout tab: add, rename, move to another floor, retype and delete zones and machines. */
export function LayoutTab(p: Props) {
  const { layout, onChange } = p;
  const zone = p.selZone ? layout.zones.find((z) => z.id === p.selZone) : undefined;
  const struct = p.selStruct ? layout.structs.find((q) => q.id === p.selStruct) : undefined;
  const eq = p.selEq ? layout.equipment.find((e) => e.id === p.selEq) : undefined;
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Equip['type']>('machine');
  const [newMuscle, setNewMuscle] = useState<Equip['muscles'][number]>('chest');
  const [filter, setFilter] = useState('');

  const rect = zone ? partRect(zone, p.part) : null;
  const machinesIn = zone ? layout.equipment.filter((e) => e.zone === zone.id).length : 0;
  const addTarget = zone?.id ?? layout.zones.find((z) => z.floor === p.floorId)?.id;

  function addMachine() {
    if (!addTarget) return p.say('Add a zone first.');
    const id = newUid();
    const next = addEquipment(layout, {
      id,
      name: newName,
      zoneId: addTarget,
      type: newType,
      muscle: newMuscle,
    });
    if (next === layout) return p.say('Give the machine a name.');
    onChange(next);
    p.onSelectEq(id);
    setNewName('');
  }

  const numberField = (label: string, key: 'x' | 'y' | 'w' | 'h') => (
    <label>
      {label}
      <input
        type="number"
        value={rect ? Math.round(rect[key]) : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (zone && Number.isFinite(v)) onChange(setZoneNumber(layout, zone.id, p.part, key, v));
        }}
      />
    </label>
  );

  return (
    <div className="stack">
      <section className="card" aria-label="Zones">
        <div className="cardhead">
          <h3>Zones</h3>
          <label className="chk">
            <input type="checkbox" checked={p.snap} onChange={(e) => p.onSnap(e.target.checked)} />
            Snap to grid
          </label>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const id = newUid();
            onChange(addZone(layout, p.floorId, id, p.snap));
            p.onSelectZone(id);
            p.onPart(0);
          }}
        >
          Add zone
        </button>
        {!zone && <p className="sub">Tap a zone on the plan to move, resize or rename it.</p>}
        {zone && rect && (
          <div className="fields">
            <label className="wide">
              Name
              <input
                type="text"
                value={zone.name}
                maxLength={60}
                onChange={(e) => onChange(renameZone(layout, zone.id, e.target.value))}
              />
            </label>
            {layout.floors.length > 1 && (
              <label>
                Floor
                <select
                  value={zone.floor}
                  onChange={(e) => onChange(moveZoneToFloor(layout, zone.id, e.target.value))}
                >
                  {layout.floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Type
              <select
                value={zone.cat}
                onChange={(e) =>
                  onChange(setZoneCategory(layout, zone.id, e.target.value as typeof zone.cat))
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            {numberField('Left', 'x')}
            {numberField('Top', 'y')}
            {numberField('Width', 'w')}
            {numberField('Height', 'h')}
            <div className="wide">
              <ZoneShaping
                layout={layout}
                zone={zone}
                part={p.part}
                onPart={p.onPart}
                onChange={onChange}
                onSelectZone={p.onSelectZone}
                onCopies={p.onCopies}
                onGoToFloor={p.onGoToFloor}
                say={p.say}
              />
              <ConfirmButton
                aria-label="Delete zone"
                onConfirm={() => {
                  const r = deleteZone(layout, zone.id);
                  onChange(r.layout);
                  p.onSelectZone(null);
                  p.say(
                    r.removedMachines
                      ? `Zone deleted, with ${r.removedMachines} machine${r.removedMachines === 1 ? '' : 's'}. Save to keep this.`
                      : 'Zone deleted. Save to keep this.',
                  );
                }}
              >
                {machinesIn
                  ? `Delete zone and its ${machinesIn} machine${machinesIn === 1 ? '' : 's'}`
                  : 'Delete zone'}
              </ConfirmButton>
            </div>
          </div>
        )}
      </section>

      <StructKey
        layout={layout}
        floorId={p.floorId}
        snap={p.snap}
        onChange={onChange}
        onSelectStruct={p.onSelectStruct}
      />
      {struct && (
        <StructCard
          layout={layout}
          s={struct}
          floorId={p.floorId}
          onChange={onChange}
          onDeselect={() => p.onSelectStruct(null)}
          say={p.say}
        />
      )}
      <FloorCard
        layout={layout}
        floorId={p.floorId}
        onChange={onChange}
        onGoToFloor={p.onGoToFloor}
        say={p.say}
      />

      <section className="card" aria-label="Add a machine">
        <h3>Add a machine</h3>
        <p className="sub">
          {addTarget
            ? `It goes in ${layout.zones.find((z) => z.id === addTarget)?.name}. Drag it into place on the plan.`
            : 'Add a zone first.'}
        </p>
        <div className="fields">
          <label className="wide">
            Machine name
            <input type="text" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label>
            Kind
            <select value={newType} onChange={(e) => setNewType(e.target.value as Equip['type'])}>
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LETTERS[t]?.name ?? t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trains
            <select
              value={newMuscle}
              onChange={(e) => setNewMuscle(e.target.value as Equip['muscles'][number])}
            >
              {MUSCLES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="btn" onClick={addMachine}>
          Add machine
        </button>
      </section>

      {eq && (
        <section className="card" aria-label="Selected machine">
          <div className="cardhead">
            <h3>{eq.name}</h3>
            <button
              type="button"
              className="x"
              aria-label="Deselect machine"
              onClick={() => p.onSelectEq(null)}
            >
              ×
            </button>
          </div>
          <div className="fields">
            <label className="wide">
              Name
              <input
                type="text"
                value={eq.name}
                maxLength={60}
                onChange={(e) => onChange(renameEquipment(layout, eq.id, e.target.value))}
              />
            </label>
            {layout.floors.length > 1 && (
              <label>
                Floor
                <select
                  value={eq.floor}
                  onChange={(e) => onChange(setEquipmentFloor(layout, eq.id, e.target.value))}
                >
                  {layout.floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Zone
              <select
                value={eq.zone}
                onChange={(e) => onChange(setEquipmentZone(layout, eq.id, e.target.value))}
              >
                {layout.zones
                  .filter((z) => z.floor === eq.floor)
                  .map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="wide">
              Notes
              <input
                type="text"
                value={eq.notes}
                maxLength={1000}
                onChange={(e) => onChange(setEquipmentNotes(layout, eq.id, e.target.value))}
              />
            </label>
          </div>
          <h4>Exercises on this machine</h4>
          {!p.savedEquipment.has(eq.id) ? (
            <p className="sub">Save the layout first, then choose which exercises this machine can do.</p>
          ) : (
            <>
              <input
                type="text"
                placeholder="Find an exercise"
                aria-label="Find an exercise"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <ul className="rows linkrows">
                {p.library
                  .filter((x) => x.name.toLowerCase().includes(filter.trim().toLowerCase()))
                  .slice(0, 60)
                  .map((x) => (
                    <li key={x.id}>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={x.equipmentIds.includes(eq.id)}
                          onChange={(e) => p.onLink(x.id, eq.id, e.target.checked)}
                        />
                        {x.name}
                      </label>
                    </li>
                  ))}
              </ul>
            </>
          )}
          <ConfirmButton
            aria-label="Delete machine"
            onConfirm={() => {
              onChange(deleteEquipment(layout, eq.id));
              p.onSelectEq(null);
              p.say('Machine deleted. Save to keep this.');
            }}
          >
            Delete machine
          </ConfirmButton>
        </section>
      )}
    </div>
  );
}
