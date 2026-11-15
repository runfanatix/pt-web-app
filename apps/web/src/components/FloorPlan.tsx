import type { KeyboardEvent } from 'react';
import {
  routeForFloor,
  structsOn,
  wrapName,
  zoneCountRect,
  zoneLabelRect,
  zonePathD,
  type Layout,
  type SessionItem,
} from '@pt/core';
import { StructShape } from './StructShape.tsx';

export const TYPE_LETTERS: Record<string, { letter: string; name: string }> = {
  cardio: { letter: 'C', name: 'Cardio machine' },
  machine: { letter: 'M', name: 'Selectorised or cable machine' },
  free: { letter: 'F', name: 'Free weights' },
  rig: { letter: 'R', name: 'Rig or functional kit' },
  space: { letter: 'S', name: 'Open space' },
};

type Equip = Layout['equipment'][number];

interface Props {
  layout: Layout;
  floorId: string;
  /** 'all' or a muscle name: machines that do not train it are dimmed. */
  filter: string;
  selZone: string | null;
  /** The machine whose pop-up is open. */
  selEq: string | null;
  /** The routine being built: draws numbers on machines and route lines between them. */
  items?: SessionItem[];
  onSelectZone: (id: string | null) => void;
  onSelectEq: (id: string | null) => void;
}

function onKey(e: KeyboardEvent, action: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    action();
  }
}

/** A small pill above a machine telling where the route goes on another floor. */
function CrossChip({ e, text, slot }: { e: Equip; text: string; slot: number }) {
  const w = Math.max(46, text.length * 5.8 + 14);
  const y = e.y - 34 - slot * 18;
  return (
    <g className="xf xf-ready" pointerEvents="none">
      <rect x={e.x - w / 2} y={y} width={w} height={15} rx={7.5} />
      <text x={e.x} y={y + 7.5}>
        {text}
      </text>
    </g>
  );
}

/** Floor plan: zones (including joined outlines), architecture, route lines, and numbered equipment markers. */
export function FloorPlan({
  layout,
  floorId,
  filter,
  selZone,
  selEq,
  items = [],
  onSelectZone,
  onSelectEq,
}: Props) {
  const floor = layout.floors.find((f) => f.id === floorId) ?? layout.floors[0]!;
  const zones = layout.zones.filter((z) => z.floor === floor.id);
  const structs = structsOn(layout.structs, floor.id);
  const equipment = layout.equipment.filter((e) => e.floor === floor.id);
  const zoneName = new Map(layout.zones.map((z) => [z.id, z.name]));
  const multiFloor = layout.floors.length > 1;
  const floorName = new Map(layout.floors.map((f) => [f.id, f.name]));
  const floorIndex = new Map(layout.floors.map((f, i) => [f.id, i]));
  const equipById = new Map(layout.equipment.map((e) => [e.id, e]));

  const numbers: Record<string, number[]> = {};
  items.forEach((it, i) => (numbers[it.eid] ??= []).push(i + 1));
  const route = routeForFloor(items, equipById, floor.id);
  const slots: Record<string, number> = {};
  const nextSlot = (id: string) => (slots[id] = slots[id] === undefined ? 0 : slots[id] + 1);

  const labelled = (e: Equip): boolean => selZone === e.zone || selEq === e.id;
  // Draw labelled markers last so their names sit on top of the others.
  const ordered = [...equipment.filter((e) => !labelled(e)), ...equipment.filter(labelled)];
  const minWidth = Math.round(720 + Math.max(0, floor.w - 1000) * 0.4);
  const empty = !zones.length && !structs.length && !equipment.length;

  return (
    <svg
      id="map"
      viewBox={`0 0 ${floor.w} ${floor.h}`}
      style={{ minWidth }}
      role="group"
      aria-label="Floor plan with training zones and equipment"
    >
      <defs>
        <pattern id="gridp" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="var(--grid)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={floor.w} height={floor.h} fill="var(--paper)" />
      <rect width={floor.w} height={floor.h} fill="url(#gridp)" />

      {zones.map((z) => {
        const count = layout.equipment.filter((e) => e.zone === z.id).length;
        const an = zoneLabelRect(z);
        const cn = zoneCountRect(z);
        const joined = (z.parts?.length ?? 0) > 0;
        const toggle = () => onSelectZone(selZone === z.id ? null : z.id);
        return (
          <g
            key={z.id}
            className={`zone cat-${z.cat}${selZone === z.id ? ' sel' : ''}`}
            data-zone={z.id}
            role="button"
            tabIndex={0}
            aria-pressed={selZone === z.id}
            aria-label={`${z.name}, ${count} item${count === 1 ? '' : 's'}`}
            onClick={toggle}
            onKeyDown={(e) => onKey(e, toggle)}
          >
            {joined ? (
              <path className="zp" fillRule="evenodd" d={zonePathD(z)} />
            ) : (
              <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={2} />
            )}
            <text className="zl" x={an.x + 10} y={an.y + 22}>
              {z.name.toUpperCase()}
            </text>
            {count > 0 && (
              <text className="zc" x={cn.x + cn.w - 10} y={cn.y + cn.h - 10}>
                {count} item{count > 1 ? 's' : ''}
              </text>
            )}
          </g>
        );
      })}

      <g>
        {structs.map((s) => (
          <g key={s.id} className="st" data-struct={s.id}>
            <StructShape s={s} />
          </g>
        ))}
      </g>

      {empty && (
        <text className="emptyfloor" x={floor.w / 2} y={floor.h / 2}>
          Nothing on this floor yet.
        </text>
      )}

      {route.polylines.map((pl, i) => (
        <polyline key={i} className="route" points={pl.map((p) => p.join(',')).join(' ')} />
      ))}

      {ordered.map((e) => {
        const dim = filter !== 'all' && !(e.muscles as string[]).includes(filter);
        const lab = labelled(e);
        const nums = numbers[e.id] ?? [];
        const cls = `mk${selEq === e.id ? ' sel' : ''}${lab ? ' lab' : ''}${dim ? ' dim' : ''}`;
        const lines = wrapName(e.name);
        const place = (multiFloor ? `${floorName.get(e.floor) ?? ''} · ` : '') + (zoneName.get(e.zone) ?? '');
        const letter = (TYPE_LETTERS[e.type] ?? TYPE_LETTERS.space!).letter;
        const toggle = () => onSelectEq(selEq === e.id ? null : e.id);
        const step = nums.length ? `, session step${nums.length > 1 ? 's' : ''} ${nums.join(' and ')}` : '';
        return (
          <g
            key={e.id}
            className={cls}
            data-eq={e.id}
            transform={`translate(${e.x} ${e.y})`}
            tabIndex={0}
            role="button"
            aria-pressed={selEq === e.id}
            aria-label={`${e.name}, ${place}${step}`}
            onClick={toggle}
            onKeyDown={(ev) => onKey(ev, toggle)}
          >
            <circle className="body" r={12} />
            <text className="gl">{letter}</text>
            {nums.length > 0 && (
              <>
                <circle className="ring" r={17} />
                <circle className="bdg" cx={13} cy={-13} r={10} />
                <text className="bdt" x={13} y={-13}>
                  {nums[0]}
                  {nums.length > 1 ? '+' : ''}
                </text>
              </>
            )}
            <text className="ml" y={27}>
              {lines.map((ln, i) => (
                <tspan key={i} x={0} dy={i === 0 ? 0 : 12}>
                  {ln}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}

      {route.cross.map((c, i) => {
        const fa = floorIndex.get(c.from.floor) ?? 0;
        const fb = floorIndex.get(c.to.floor) ?? 0;
        return (
          <g key={i}>
            {c.from.floor === floor.id && (
              <CrossChip
                e={c.from}
                text={`${fb > fa ? '↑' : '↓'} to ${floorName.get(c.to.floor) ?? ''}`}
                slot={nextSlot(c.from.id)}
              />
            )}
            {c.to.floor === floor.id && (
              <CrossChip
                e={c.to}
                text={`from ${floorName.get(c.from.floor) ?? ''}`}
                slot={nextSlot(c.to.id)}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
