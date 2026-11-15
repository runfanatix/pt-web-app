import type { ReactNode } from 'react';
import { STRUCT_DEFS } from '@pt/core';
import type { Layout } from '@pt/core';

type Struct = Layout['structs'][number];

/** Default sizes (the prototype's STRUCTS table), used when a row has none. */
const DEFAULTS: Record<string, { w: number; h: number }> = {
  stairs: { w: 80, h: 44 },
  lift: { w: 36, h: 36 },
  toilets: { w: 76, h: 50 },
  door: { w: 36, h: 0 },
  revolving: { w: 46, h: 0 },
  dglass: { w: 68, h: 0 },
  column: { w: 14, h: 0 },
};

function Symbol({ type, w }: { type: string; w: number }): ReactNode {
  const hw = w / 2;
  if (type === 'door') {
    return (
      <>
        <line className="sa-cut" x1={-hw} y1={0} x2={hw} y2={0} />
        <line className="sa-door" x1={-hw} y1={0} x2={-hw} y2={-w} />
        <path className="sa-arc" d={`M${hw} 0 A${w} ${w} 0 0 0 ${-hw} ${-w}`} />
      </>
    );
  }
  if (type === 'dglass') {
    return (
      <>
        <line className="sa-cut" x1={-hw} y1={0} x2={hw} y2={0} />
        <line className="sa-gleaf" x1={-hw} y1={0} x2={-hw} y2={-hw} />
        <line className="sa-gleaf" x1={hw} y1={0} x2={hw} y2={-hw} />
        <path className="sa-garc" d={`M0 0 A${hw} ${hw} 0 0 0 ${-hw} ${-hw}`} />
        <path className="sa-garc" d={`M0 0 A${hw} ${hw} 0 0 1 ${hw} ${-hw}`} />
      </>
    );
  }
  if (type === 'revolving') {
    const d = hw * 0.72;
    return (
      <>
        <line className="sa-cut" x1={-hw - 3} y1={0} x2={hw + 3} y2={0} />
        <circle className="sa-rev" r={hw} />
        <line className="sa-blade" x1={-d} y1={-d} x2={d} y2={d} />
        <line className="sa-blade" x1={d} y1={-d} x2={-d} y2={d} />
      </>
    );
  }
  if (type === 'column') return <rect className="sa-col" x={-hw} y={-hw} width={w} height={w} />;
  return null;
}

/** One architectural item, drawn as plain SVG (a port of the prototype's structSvg). */
export function StructShape({ s }: { s: Struct }) {
  const kind = STRUCT_DEFS[s.type]?.kind;
  if (!kind) return null;

  if (kind === 'line') {
    const x1 = s.x;
    const y1 = s.y;
    const x2 = s.x2 ?? s.x + 140;
    const y2 = s.y2 ?? s.y;
    if (s.type === 'wall') return <line className="sa-wall" x1={x1} y1={y1} x2={x2} y2={y2} />;
    if (s.type === 'glass') {
      return (
        <>
          <line className="sa-glass-band" x1={x1} y1={y1} x2={x2} y2={y2} />
          <line className="sa-glass" x1={x1} y1={y1} x2={x2} y2={y2} />
        </>
      );
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const n = Math.max(1, Math.round(len / 12));
    const posts = Array.from({ length: n + 1 }, (_, i) => {
      const px = x1 + (dx * i) / n;
      const py = y1 + (dy * i) / n;
      return (
        <line
          key={i}
          className="sa-balp"
          x1={(px - nx * 3.5).toFixed(1)}
          y1={(py - ny * 3.5).toFixed(1)}
          x2={(px + nx * 3.5).toFixed(1)}
          y2={(py + ny * 3.5).toFixed(1)}
        />
      );
    });
    return (
      <>
        <line className="sa-bal" x1={x1} y1={y1} x2={x2} y2={y2} />
        {posts}
      </>
    );
  }

  const def = DEFAULTS[s.type] ?? { w: 40, h: 40 };

  if (kind === 'box') {
    const bw = s.w || def.w;
    const bh = s.h || def.h;
    const horiz = bw >= bh;
    const steps = Math.max(2, Math.floor((horiz ? bw : bh) / 8));
    return (
      <>
        <rect className="sa-box" x={s.x} y={s.y} width={bw} height={bh} rx={1.5} />
        {s.type === 'stairs' &&
          Array.from({ length: steps - 1 }, (_, i) => {
            const k = i + 1;
            const p = horiz ? s.x + (bw * k) / steps : s.y + (bh * k) / steps;
            return horiz ? (
              <line key={k} className="sa-step" x1={p.toFixed(1)} y1={s.y} x2={p.toFixed(1)} y2={s.y + bh} />
            ) : (
              <line key={k} className="sa-step" x1={s.x} y1={p.toFixed(1)} x2={s.x + bw} y2={p.toFixed(1)} />
            );
          })}
        {s.type === 'lift' && (
          <>
            <line className="sa-step" x1={s.x} y1={s.y} x2={s.x + bw} y2={s.y + bh} />
            <line className="sa-step" x1={s.x + bw} y1={s.y} x2={s.x} y2={s.y + bh} />
          </>
        )}
        {s.type === 'toilets' && (
          <text className="sa-wc" x={s.x + bw / 2} y={s.y + bh / 2}>
            WC
          </text>
        )}
        {s.label && (
          <text className="sa-lab" x={s.x + bw / 2} y={s.y + bh + 10}>
            {s.label}
          </text>
        )}
      </>
    );
  }

  const w = s.w || def.w;
  const labelY = s.y + (s.type === 'door' || s.type === 'dglass' ? 13 : w / 2 + 11);
  return (
    <>
      <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot || 0})`}>
        <Symbol type={s.type} w={w} />
      </g>
      {s.label && (
        <text className="sa-lab" x={s.x} y={labelY}>
          {s.label}
        </text>
      )}
    </>
  );
}
