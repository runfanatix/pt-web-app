/**
 * Pure floor-plan geometry, ported from prototype/zone-planner-v11.html (zoneRects, zoneLoops, zonePathD,
 * zoneLabelRect, zoneCountRect, wrapName, shared stairs and lifts). No DOM, no state: unit-testable.
 * The tests run the prototype's own functions side by side with these to prove they agree.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A zone as far as geometry is concerned: a primary rectangle plus optional extra parts (a joined zone). */
export interface ZoneShape extends Rect {
  parts?: Rect[] | undefined;
}

export type Point = [number, number];

export function zoneRects(z: ZoneShape): Rect[] {
  return [{ x: z.x, y: z.y, w: z.w, h: z.h }, ...(z.parts ?? [])];
}

/**
 * Outline of the union of a zone's rectangles, as closed loops of [x, y] points.
 * Coordinate-compress all edges, mark covered cells, collect boundary edges, chain them into loops and drop
 * collinear points. A ring-shaped zone gives two loops (outer and hole); draw with the even-odd fill rule.
 */
export function zoneLoops(z: ZoneShape): Point[][] {
  const rs = zoneRects(z);
  let xs: number[] = [];
  let ys: number[] = [];
  rs.forEach((r) => {
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  });
  const uniq = (a: number[]): number[] => {
    const sorted = a.slice().sort((p, q) => p - q);
    return sorted.filter((v, i) => !i || v !== sorted[i - 1]);
  };
  xs = uniq(xs);
  ys = uniq(ys);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const cov: boolean[][] = [];
  for (let j = 0; j < ny; j++) {
    const row: boolean[] = [];
    for (let i = 0; i < nx; i++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      row.push(rs.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h));
    }
    cov.push(row);
  }
  const covered = (a: number, b: number): boolean => a >= 0 && b >= 0 && a < nx && b < ny && cov[b]![a]!;

  interface Edge {
    a: Point;
    b: Point;
    used: boolean;
  }
  const byStart: Record<string, Edge[]> = {};
  const all: Edge[] = [];
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const e: Edge = { a: [x0, y0], b: [x1, y1], used: false };
    const k = x0 + ',' + y0;
    (byStart[k] ??= []).push(e);
    all.push(e);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!covered(i, j)) continue;
      if (!covered(i, j - 1)) add(xs[i]!, ys[j]!, xs[i + 1]!, ys[j]!);
      if (!covered(i + 1, j)) add(xs[i + 1]!, ys[j]!, xs[i + 1]!, ys[j + 1]!);
      if (!covered(i, j + 1)) add(xs[i + 1]!, ys[j + 1]!, xs[i]!, ys[j + 1]!);
      if (!covered(i - 1, j)) add(xs[i]!, ys[j + 1]!, xs[i]!, ys[j]!);
    }
  }

  const loops: Point[][] = [];
  all.forEach((e0) => {
    if (e0.used) return;
    const pts: Point[] = [e0.a];
    let e: Edge | undefined = e0;
    while (e && !e.used) {
      e.used = true;
      pts.push(e.b);
      const next: Edge | undefined = (byStart[e.b[0] + ',' + e.b[1]] ?? []).filter((u) => !u.used)[0];
      e = next;
    }
    pts.pop();
    let again = true;
    while (again && pts.length > 3) {
      again = false;
      for (let k = 0; k < pts.length; k++) {
        const p0 = pts[(k + pts.length - 1) % pts.length]!;
        const p1 = pts[k]!;
        const p2 = pts[(k + 1) % pts.length]!;
        if ((p0[0] === p1[0] && p1[0] === p2[0]) || (p0[1] === p1[1] && p1[1] === p2[1])) {
          pts.splice(k, 1);
          again = true;
          break;
        }
      }
    }
    loops.push(pts);
  });
  return loops;
}

/** SVG path data for the zone outline (use with fill-rule="evenodd"). */
export function zonePathD(z: ZoneShape): string {
  return zoneLoops(z)
    .map((pts) => 'M' + pts.map((p) => p[0] + ' ' + p[1]).join('L') + 'Z')
    .join('');
}

function wideOnly(z: ZoneShape): Rect[] {
  const rs = zoneRects(z);
  const wide = rs.filter((r) => r.w >= 60);
  return wide.length ? wide : rs;
}

/** The rectangle that holds the zone name: the top-left part (wide parts preferred). */
export function zoneLabelRect(z: ZoneShape): Rect {
  return wideOnly(z).reduce((b, r) => (r.y < b.y || (r.y === b.y && r.x < b.x) ? r : b));
}

/** The rectangle that holds the item count: the bottom-right part (wide parts preferred). */
export function zoneCountRect(z: ZoneShape): Rect {
  return wideOnly(z).reduce((b, r) => {
    const rb = r.y + r.h;
    const bb = b.y + b.h;
    return rb > bb || (rb === bb && r.x + r.w > b.x + b.w) ? r : b;
  });
}

/** Splits a machine name over two lines at the space nearest the middle (names of 11 characters or fewer stay whole). */
export function wrapName(n: string): string[] {
  if (n.length <= 11 || n.indexOf(' ') < 0) return [n];
  let best = -1;
  let bd = 999;
  const mid = n.length / 2;
  for (let i = 0; i < n.length; i++) {
    if (n.charAt(i) === ' ') {
      const d = Math.abs(i - mid);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  }
  return [n.slice(0, best), n.slice(best + 1)];
}

/* ---------------------------------------------------------------- architectural structures */

export type StructKind = 'box' | 'sym' | 'line';

export interface StructDef {
  name: string;
  kind: StructKind;
  /** Stairs and lifts run through every floor: a shared one shows in the same spot on each. */
  vertical: boolean;
}

export const STRUCT_DEFS: Record<string, StructDef> = {
  stairs: { name: 'Staircase', kind: 'box', vertical: true },
  lift: { name: 'Lift', kind: 'box', vertical: true },
  door: { name: 'Door', kind: 'sym', vertical: false },
  revolving: { name: 'Revolving door', kind: 'sym', vertical: false },
  dglass: { name: 'Double glass door', kind: 'sym', vertical: false },
  column: { name: 'Column', kind: 'sym', vertical: false },
  toilets: { name: 'Toilets', kind: 'box', vertical: false },
  wall: { name: 'Wall', kind: 'line', vertical: false },
  balustrade: { name: 'Balustrade', kind: 'line', vertical: false },
  glass: { name: 'Glass facade', kind: 'line', vertical: false },
};

export interface StructLike {
  type: string;
  floor: string;
  shared: boolean;
}

export function structOnFloor(s: StructLike, floorId: string): boolean {
  return s.floor === floorId || (s.shared && !!STRUCT_DEFS[s.type]?.vertical);
}

const KIND_RANK: Record<StructKind, number> = { line: 0, box: 1, sym: 2 };

/** Structures to draw on a floor, back to front: lines, then boxes, then symbols. */
export function structsOn<T extends StructLike>(structs: T[], floorId: string): T[] {
  return structs
    .filter((s) => structOnFloor(s, floorId))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ra = KIND_RANK[STRUCT_DEFS[a.s.type]?.kind ?? 'sym'];
      const rb = KIND_RANK[STRUCT_DEFS[b.s.type]?.kind ?? 'sym'];
      return ra - rb || a.i - b.i;
    })
    .map((q) => q.s);
}
