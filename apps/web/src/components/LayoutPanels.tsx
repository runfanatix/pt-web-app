import { useState } from 'react';
import {
  STRUCT_DEFS,
  STRUCT_ORDER,
  addFloor,
  addStruct,
  deleteFloor,
  deleteStruct,
  duplicateZone,
  floorExtent,
  joinCandidates,
  joinZones,
  lineLength,
  moveStructToFloor,
  renameFloor,
  rotateStruct,
  scaleStruct,
  setFloorSize,
  setStructLabel,
  setStructNumber,
  setStructShared,
  setStructTurn,
  splitPart,
  structPercent,
  zoneConnected,
  zoneRects,
  type Layout,
  type StructField,
} from '@pt/core';
import { ConfirmButton } from './ConfirmButton.tsx';
import { newUid } from '../session/sessionState.ts';

type Zone = Layout['zones'][number];
type Struct = Layout['structs'][number];

/** Buttons that add architecture to the floor on show. */
export function StructKey({
  layout,
  floorId,
  snap,
  onChange,
  onSelectStruct,
}: {
  layout: Layout;
  floorId: string;
  snap: boolean;
  onChange: (l: Layout) => void;
  onSelectStruct: (id: string) => void;
}) {
  return (
    <section className="card" aria-label="Add architecture">
      <h3>Architecture</h3>
      <p className="sub">
        Add stairs, lifts, doors, walls and more to this floor. Stairs and lifts show on every floor by
        default.
      </p>
      <div className="chips">
        {STRUCT_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            className="chip"
            onClick={() => {
              const id = newUid();
              onChange(addStruct(layout, t, floorId, id, snap));
              onSelectStruct(id);
            }}
          >
            {`Add ${STRUCT_DEFS[t]?.name.toLowerCase()}`}
          </button>
        ))}
      </div>
    </section>
  );
}

const numField = (
  label: string,
  key: StructField,
  value: number,
  step: number,
  set: (k: StructField, v: string) => void,
) => (
  <label key={key}>
    {label}
    <input type="number" step={step} value={Math.round(value)} onChange={(e) => set(key, e.target.value)} />
  </label>
);

/** The selected architectural item: position, size, scale, label, turn, floor, shared. */
export function StructCard({
  layout,
  s,
  floorId,
  onChange,
  onDeselect,
  say,
}: {
  layout: Layout;
  s: Struct;
  floorId: string;
  onChange: (l: Layout) => void;
  onDeselect: () => void;
  say: (m: string) => void;
}) {
  const def = STRUCT_DEFS[s.type];
  if (!def) return null;
  const kind = def.kind;
  const shared = s.shared && def.vertical;
  const set = (k: StructField, v: string) => onChange(setStructNumber(layout, s.id, k, v, floorId));
  const floorName = layout.floors.find((f) => f.id === s.floor)?.name ?? '';
  return (
    <section className="card" aria-label="Selected architecture">
      <div className="cardhead">
        <div>
          <h3>{def.name}</h3>
          <p className="sub">
            {floorName}
            {kind === 'line' ? ` · length ${Math.round(lineLength(s))} px` : ''}
          </p>
        </div>
        <button type="button" className="x" aria-label="Deselect architecture" onClick={onDeselect}>
          ×
        </button>
      </div>
      <p className="sub">
        {kind === 'line'
          ? 'Drag it to move it. Pull the round grips at either end to make it longer or shorter, or type a scale.'
          : kind === 'box'
            ? 'Drag it to move it. Pull the grips on its edges and corners to resize.'
            : 'Drag it to move it. Use Rotate to turn it a quarter turn.'}
      </p>
      {def.vertical && (
        <label className="chk">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => onChange(setStructShared(layout, s.id, e.target.checked, floorId))}
          />
          Same position on every floor
        </label>
      )}
      <div className="fields">
        {!shared && layout.floors.length > 1 && (
          <label>
            Floor
            <select
              value={s.floor}
              onChange={(e) => onChange(moveStructToFloor(layout, s.id, e.target.value))}
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
          Scale (%)
          <input
            type="number"
            min={25}
            max={600}
            step={10}
            value={structPercent(s)}
            onChange={(e) => onChange(scaleStruct(layout, s.id, e.target.value, floorId))}
          />
        </label>
        {kind !== 'line' && (
          <label className="wide">
            Label on the plan
            <input
              type="text"
              maxLength={40}
              value={s.label}
              onChange={(e) => onChange(setStructLabel(layout, s.id, e.target.value))}
            />
          </label>
        )}
        {kind === 'box' && (
          <>
            {numField('Left (x)', 'x', s.x, 10, set)}
            {numField('Top (y)', 'y', s.y, 10, set)}
            {numField('Width', 'w', s.w ?? 0, 10, set)}
            {numField('Height', 'h', s.h ?? 0, 10, set)}
          </>
        )}
        {kind === 'sym' && (
          <>
            {numField('Centre x', 'x', s.x, 10, set)}
            {numField('Centre y', 'y', s.y, 10, set)}
            {numField(s.type === 'column' ? 'Size' : 'Width', 'w', s.w ?? 0, 2, set)}
            <label>
              Turned
              <select
                value={s.rot}
                onChange={(e) => onChange(setStructTurn(layout, s.id, Number(e.target.value)))}
              >
                {[0, 90, 180, 270].map((r) => (
                  <option key={r} value={r}>
                    {r}°
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {kind === 'line' && (
          <>
            {numField('Start x', 'x', s.x, 10, set)}
            {numField('Start y', 'y', s.y, 10, set)}
            {numField('End x', 'x2', s.x2 ?? 0, 10, set)}
            {numField('End y', 'y2', s.y2 ?? 0, 10, set)}
          </>
        )}
      </div>
      <div className="btnrow">
        <button type="button" className="btn" onClick={() => onChange(rotateStruct(layout, s.id, floorId))}>
          Rotate 90°
        </button>
        <ConfirmButton
          aria-label="Delete architecture"
          onConfirm={() => {
            onChange(deleteStruct(layout, s.id));
            onDeselect();
            say(`${def.name} deleted. Save to keep this.`);
          }}
        >
          Delete
        </ConfirmButton>
      </div>
    </section>
  );
}

/** The floor on show: name, size, add and delete. */
export function FloorCard({
  layout,
  floorId,
  onChange,
  onGoToFloor,
  say,
}: {
  layout: Layout;
  floorId: string;
  onChange: (l: Layout) => void;
  onGoToFloor: (id: string) => void;
  say: (m: string) => void;
}) {
  const f = layout.floors.find((q) => q.id === floorId);
  const [name, setName] = useState(f?.name ?? '');
  const [forFloor, setForFloor] = useState(floorId);
  if (!f) return null;
  const min = floorExtent(layout, f.id);
  const structsHere = layout.structs.filter(
    (s) => s.floor === f.id && !(s.shared && STRUCT_DEFS[s.type]?.vertical),
  );
  const zonesHere = layout.zones.filter((z) => z.floor === f.id).length;
  const machinesHere = layout.equipment.filter((e) => e.floor === f.id).length;
  if (forFloor !== f.id) {
    setForFloor(f.id);
    setName(f.name);
  }
  return (
    <section className="card" aria-label="This floor">
      <h3>This floor</h3>
      <div className="fields">
        <label className="wide">
          Floor name
          <input
            type="text"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim()) onChange(renameFloor(layout, f.id, name));
              else setName(f.name);
            }}
          />
        </label>
        <label>
          Plan width
          <input
            type="number"
            step={100}
            min={min.w}
            max={2400}
            value={f.w}
            onChange={(e) => onChange(setFloorSize(layout, f.id, e.target.value, f.h))}
          />
        </label>
        <label>
          Plan height
          <input
            type="number"
            step={100}
            min={min.h}
            max={1800}
            value={f.h}
            onChange={(e) => onChange(setFloorSize(layout, f.id, f.w, e.target.value))}
          />
        </label>
      </div>
      <p className="sub">
        Each floor has its own zones, architecture and equipment. A session can use machines from any floor.
        Deleting a floor also deletes its zones, architecture and equipment.
      </p>
      <div className="btnrow">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const id = newUid();
            onChange(addFloor(layout, id, f.id));
            onGoToFloor(id);
          }}
        >
          Add a floor
        </button>
        {layout.floors.length > 1 && (
          <ConfirmButton
            aria-label="Delete this floor"
            onConfirm={() => {
              const r = deleteFloor(layout, f.id);
              onChange(r.layout);
              onGoToFloor(r.layout.floors[0]!.id);
              say(
                `Floor deleted, with ${r.removedZones} zone${r.removedZones === 1 ? '' : 's'} and ${r.removedMachines.length} machine${r.removedMachines.length === 1 ? '' : 's'}. Save to keep this.`,
              );
            }}
          >
            {`Delete this floor (${zonesHere} zone${zonesHere === 1 ? '' : 's'}, ${machinesHere} machine${machinesHere === 1 ? '' : 's'}, ${structsHere.length} architecture)`}
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}

/** Join, split and duplicate, for the zone being edited. */
export function ZoneShaping({
  layout,
  zone,
  part,
  onPart,
  onChange,
  onSelectZone,
  onCopies,
  onGoToFloor,
  say,
}: {
  layout: Layout;
  zone: Zone;
  part: number;
  onPart: (i: number) => void;
  onChange: (l: Layout) => void;
  onSelectZone: (id: string) => void;
  /** Machines copied by a duplicate: their exercise links are copied when the layout is saved. */
  onCopies: (copies: { from: string; to: string }[]) => void;
  onGoToFloor: (id: string) => void;
  say: (m: string) => void;
}) {
  const [target, setTarget] = useState('');
  const [withMachines, setWithMachines] = useState(true);
  const rects = zoneRects(zone);
  const np = (zone.parts ?? []).length;
  const cands = joinCandidates(layout, zone.id);
  const machines = layout.equipment.filter((e) => e.zone === zone.id).length;
  const to = layout.floors.some((f) => f.id === target) ? target : zone.floor;

  return (
    <>
      <h4>Join zones</h4>
      {np > 0 && (
        <>
          <p className="sub">
            {`This zone is ${np + 1} joined rectangles. Pick a part to resize it with the grips, or drag any part to move the whole zone.`}
          </p>
          <div className="chips">
            {rects.map((_, i) => (
              <button
                key={i}
                type="button"
                className="chip"
                aria-pressed={i === part}
                onClick={() => onPart(i)}
              >
                {`Part ${i + 1}`}
              </button>
            ))}
          </div>
          {!zoneConnected(zone) && (
            <p className="sub">
              Some parts no longer touch each other. Drag them back together, or split the loose part off.
            </p>
          )}
          <div className="btnrow">
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const r = splitPart(layout, zone.id, part, newUid());
                if (!r) return;
                onChange(r.layout);
                onSelectZone(r.newZoneId);
                onPart(0);
                say(`Split "${r.name}" off as its own zone.`);
              }}
            >
              {`Split part ${part + 1} off as its own zone`}
            </button>
          </div>
        </>
      )}
      {cands.length ? (
        <>
          <p className="sub">
            These zones touch this one. Join merges them into one irregular space, and their equipment comes
            along.
          </p>
          <div className="btnrow">
            {cands.map((q) => (
              <button
                key={q.id}
                type="button"
                className="btn sm"
                onClick={() => {
                  const r = joinZones(layout, zone.id, q.id);
                  if (!r.ok) return say(r.reason);
                  onChange(r.layout);
                  onPart(r.firstPart);
                  say(`Joined "${q.name}" into "${zone.name}". They are now one zone.`);
                }}
              >
                {`Join “${q.name}”`}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="sub">
          No zone touches this one yet. Drag or resize zones until their edges meet (within about 12 px) and a
          Join button appears here.
        </p>
      )}

      <h4>Duplicate zone</h4>
      <p className="sub">
        {`Makes a copy of this zone${np ? ' (shape included)' : ''} with its ${machines} machine${machines === 1 ? '' : 's'} and their exercise links.`}
      </p>
      <div className="fields">
        <label>
          Copy to
          <select value={to} onChange={(e) => setTarget(e.target.value)}>
            {layout.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id === zone.floor ? 'This floor, offset a little' : f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="chk">
          <input type="checkbox" checked={withMachines} onChange={(e) => setWithMachines(e.target.checked)} />
          Include the machines
        </label>
      </div>
      <div className="btnrow">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const ids = layout.equipment.filter((e) => e.zone === zone.id).map(() => newUid());
            const r = duplicateZone(layout, zone.id, newUid(), to, withMachines, ids);
            if (!r) return;
            onChange(r.layout);
            onCopies(r.copies);
            onGoToFloor(to);
            onSelectZone(r.newZoneId);
            onPart(0);
            say(
              `Duplicated as "${r.name}" ${withMachines ? `with ${r.copies.length} machine${r.copies.length === 1 ? '' : 's'}` : 'without machines'}.`,
            );
          }}
        >
          Duplicate zone
        </button>
      </div>
    </>
  );
}
