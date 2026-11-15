import type { KeyboardEvent } from 'react';
import {
  RUN_WORD,
  fmtClock,
  machineRun,
  routeForFloor,
  runRouteLegs,
  structsOn,
  wrapName,
  zoneCountRect,
  zoneLabelRect,
  zonePathD,
  type Layout,
  type RunState,
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
  /** When set, the plan shows the live run: colours by progress, arrows, times and a pulse on the current machine. */
  run?: RunState | null;
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
function CrossChip({
  e,
  text,
  slot,
  cls = 'xf-ready',
}: {
  e: Equip;
  text: string;
  slot: number;
  cls?: string;
}) {
  const w = Math.max(46, text.length * 5.8 + 14);
  const y = e.y - 34 - slot * 18;
  return (
    <g className={`xf ${cls}`} pointerEvents="none">
      <rect x={e.x - w / 2} y={y} width={w} height={15} rx={7.5} />
      <text x={e.x} y={y + 7.5}>
        {text}
      </text>
    </g>
  );
}

/** Draw order in the live view: the current machine last, so it sits on top. */
const WEIGHT: Record<string, number> = { none: 0, done: 1, skip: 1, ready: 2, next: 3, now: 4 };

/** Floor plan: zones (including joined outlines), architecture, route lines, and numbered equipment markers. */
export function FloorPlan({
  layout,
  floorId,
  filter,
  selZone,
  selEq,
  items = [],
  run = null,
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

  // Live run: legs with both ends on this floor become arrows, legs with one end here become chips.
  const legs = run ? runRouteLegs(run, items) : [];
  const here: { from: Equip; to: Equip; st: string }[] = [];
  const cross: { from: Equip; to: Equip; st: string }[] = [];
  for (const l of legs) {
    const a = equipById.get(l.from);
    const b = equipById.get(l.to);
    if (!a || !b) continue;
    const ia = a.floor === floor.id;
    const ib = b.floor === floor.id;
    if (ia && ib) here.push({ from: a, to: b, st: l.st });
    else if (ia || ib) cross.push({ from: a, to: b, st: l.st });
  }

  const labelled = (e: Equip): boolean => selZone === e.zone || selEq === e.id;
  const runInfo = (e: Equip) => (run ? machineRun(run, items, e.id) : null);
  // Draw labelled markers (or the current machine) last so their names sit on top of the others.
  const ordered = run
    ? equipment
        .map((e) => ({ e, ri: runInfo(e)! }))
        .sort((a, b) => (WEIGHT[a.ri.st] ?? 0) - (WEIGHT[b.ri.st] ?? 0))
        .map((q) => q.e)
    : [...equipment.filter((e) => !labelled(e)), ...equipment.filter(labelled)];
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
        {(['ready', 'done', 'next'] as const).map((k) => (
          <marker
            key={k}
            id={`ah-${k}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="11"
            markerHeight="11"
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10z" style={{ fill: `var(--run-${k})` }} />
          </marker>
        ))}
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

      {run
        ? here.map((l, i) => {
            const dx = l.to.x - l.from.x;
            const dy = l.to.y - l.from.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < 44) return null;
            const ux = dx / d;
            const uy = dy / d;
            const head = l.st === 'skip' ? 'done' : l.st;
            return (
              <line
                key={i}
                className={`rl rl-${l.st}`}
                x1={(l.from.x + ux * 16).toFixed(1)}
                y1={(l.from.y + uy * 16).toFixed(1)}
                x2={(l.to.x - ux * 22).toFixed(1)}
                y2={(l.to.y - uy * 22).toFixed(1)}
                markerEnd={`url(#ah-${head})`}
              />
            );
          })
        : route.polylines.map((pl, i) => (
            <polyline key={i} className="route" points={pl.map((p) => p.join(',')).join(' ')} />
          ))}

      {ordered.map((e) => {
        const ri = runInfo(e);
        const live = ri && ri.st !== 'none';
        const lab = labelled(e);
        const nums = numbers[e.id] ?? [];
        let cls = 'mk';
        if (ri) cls += ri.st === 'none' ? ' dim' : ` lab st-${ri.st}`;
        else
          cls += `${selEq === e.id ? ' sel' : ''}${lab ? ' lab' : ''}${filter !== 'all' && !(e.muscles as string[]).includes(filter) ? ' dim' : ''}`;
        const lines = wrapName(e.name);
        const place = (multiFloor ? `${floorName.get(e.floor) ?? ''} · ` : '') + (zoneName.get(e.zone) ?? '');
        const letter = (TYPE_LETTERS[e.type] ?? TYPE_LETTERS.space!).letter;
        const toggle = () => onSelectEq(selEq === e.id ? null : e.id);
        const step =
          !ri && nums.length ? `, session step${nums.length > 1 ? 's' : ''} ${nums.join(' and ')}` : '';
        const word = live ? `, ${RUN_WORD[ri.st as keyof typeof RUN_WORD]}` : '';
        const badge = live
          ? ri.st === 'done'
            ? '✓'
            : ri.st === 'skip'
              ? '–'
              : `${ri.nums[0]}${ri.nums.length > 1 ? '+' : ''}`
          : `${nums[0]}${nums.length > 1 ? '+' : ''}`;
        return (
          <g
            key={e.id}
            className={cls}
            data-eq={e.id}
            transform={`translate(${e.x} ${e.y})`}
            tabIndex={0}
            role="button"
            aria-pressed={!ri ? selEq === e.id : undefined}
            aria-label={`${e.name}, ${place}${step}${word}`}
            onClick={toggle}
            onKeyDown={(ev) => onKey(ev, toggle)}
          >
            {live && ri.st === 'now' && (
              <>
                <circle className="pulse" r={15} />
                <circle className="ring-now" r={19} />
              </>
            )}
            <circle className="body" r={12} />
            <text className="gl">{letter}</text>
            {live ? (
              <>
                <circle className="bdg" cx={13} cy={-13} r={10} />
                <text className="bdt" x={13} y={-13}>
                  {badge}
                </text>
              </>
            ) : (
              nums.length > 0 && (
                <>
                  <circle className="ring" r={17} />
                  <circle className="bdg" cx={13} cy={-13} r={10} />
                  <text className="bdt" x={13} y={-13}>
                    {badge}
                  </text>
                </>
              )
            )}
            <text className="ml" y={27}>
              {lines.map((ln, i) => (
                <tspan key={i} x={0} dy={i === 0 ? 0 : 12}>
                  {ln}
                </tspan>
              ))}
              {live && (ri.ms > 0 || ri.st === 'now') && (
                <tspan className="rt" x={0} dy={12}>
                  {fmtClock(ri.ms)}
                </tspan>
              )}
            </text>
          </g>
        );
      })}

      {run
        ? cross.map((c, i) => {
            const fa = floorIndex.get(c.from.floor) ?? 0;
            const fb = floorIndex.get(c.to.floor) ?? 0;
            return (
              <g key={i}>
                {c.from.floor === floor.id && (
                  <CrossChip
                    e={c.from}
                    cls={`xf-${c.st}`}
                    text={`${fb > fa ? '↑' : '↓'} to ${floorName.get(c.to.floor) ?? ''}`}
                    slot={nextSlot(c.from.id)}
                  />
                )}
                {c.to.floor === floor.id && (
                  <CrossChip
                    e={c.to}
                    cls={`xf-${c.st}`}
                    text={`from ${floorName.get(c.from.floor) ?? ''}`}
                    slot={nextSlot(c.to.id)}
                  />
                )}
              </g>
            );
          })
        : route.cross.map((c, i) => {
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
