/**
 * The programme (or workout results) as a PDF: header, gym line, meta row, exercise table, and one route map per
 * floor. A port of buildPdf from prototype/zone-planner-v11.html. It is given only what may be printed: no contact
 * details, no private notes.
 */
import { jsPDF } from 'jspdf';
import {
  STRUCT_DEFS,
  fmtClock,
  fmtDate,
  pdfSafe,
  structsOn,
  zoneLabelRect,
  zoneLoops,
  zoneRects,
  type Layout,
  type ShareItem,
  type ShareModel,
} from '@pt/core';

export interface PdfItem extends ShareItem {
  /** Machine id, to place the stop on the map ('' if the machine is gone). */
  eid: string;
  /** Actual time at this step, for a results PDF. */
  ms: number;
  done: boolean;
}

export interface PdfModel extends Omit<ShareModel, 'items'> {
  items: PdfItem[];
  /** Set for a results PDF: adds an ACTUAL column and the total time. */
  actual: { totalMs: number } | null;
  plannedSecs: number;
  /** The gym's layout for the route maps. Null: no maps. */
  layout: Layout | null;
}

type RGB = [number, number, number];
const INK: RGB = [22, 33, 43];
const MUTED: RGB = [86, 101, 116];
const LINE: RGB = [198, 207, 216];
const ACC: RGB = [200, 32, 47];
const TINT: RGB = [243, 246, 248];
const INKC: RGB = [60, 70, 80];
const GLASS: RGB = [90, 160, 200];
const PDF_ZONE: Record<string, RGB> = {
  cardio: [220, 231, 248],
  strength: [236, 226, 198],
  functional: [212, 235, 218],
  studio: [230, 218, 242],
  water: [205, 235, 240],
  amenity: [228, 231, 235],
  outdoor: [238, 240, 242],
};

export function buildPdf(m: PdfModel): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: false });
  const W = 210;
  const H = 297;
  const M = 16;
  let y = 0;
  const items = m.items;
  const hasAct = !!m.actual;
  const layout = m.layout;
  const multiFloor = (layout?.floors.length ?? 0) > 1;

  const tc = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const dc = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const fc = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const lines = (
    t: string,
    w: number,
    size: number,
    style: 'normal' | 'bold' | 'italic' = 'normal',
  ): string[] => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    return doc.splitTextToSize(pdfSafe(t), w) as string[];
  };
  /** Starts a new page when `h` mm will not fit. Returns true if it did. */
  const need = (h: number): boolean => {
    if (y + h > H - 18) {
      doc.addPage();
      y = 18;
      return true;
    }
    return false;
  };

  fc(ACC);
  doc.rect(0, 0, W, 5, 'F');
  y = 20;
  tc(MUTED);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(hasAct ? 'WORKOUT RESULTS' : 'TRAINING PROGRAMME', M, y);
  y += 8;
  tc(INK);
  lines(m.title || 'Training programme', W - 2 * M, 20, 'bold').forEach((l) => {
    doc.text(l, M, y);
    y += 8;
  });
  y -= 2;
  if (m.gym) {
    tc(MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(pdfSafe(m.gym), M, y + 2);
    y += 8;
  }
  const meta = [
    ['Client', m.client],
    ['Coach', m.coach],
    ['Date', m.date ? fmtDate(m.date) : ''],
  ].filter((q): q is [string, string] => !!q[1]);
  if (meta.length) {
    const cw = (W - 2 * M) / meta.length;
    meta.forEach((q, i) => {
      const x = M + i * cw;
      tc(MUTED);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(q[0].toUpperCase(), x, y + 4);
      tc(INK);
      doc.text(lines(q[1], cw - 4, 11, 'bold')[0] ?? '', x, y + 10);
    });
    y += 16;
  }
  dc(LINE);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 7;
  const plannedMin = Math.round(m.plannedSecs / 60);
  tc(MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(
    `${items.length} exercise${items.length === 1 ? '' : 's'}  -  ${
      m.actual
        ? `${fmtClock(m.actual.totalMs)} total time (planned about ${plannedMin} min)`
        : `about ${plannedMin} min`
    }`,
    M,
    y,
  );
  y += 7;
  if (m.notes.trim()) {
    const nl = lines(m.notes.trim(), W - 2 * M, 9.5, 'normal');
    need(10 + nl.length * 4.3);
    tc(INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('NOTES', M, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    nl.forEach((l) => {
      need(5);
      doc.text(l, M, y);
      y += 4.3;
    });
    y += 4;
  }

  const X_EX = M + 12;
  const X_SETS = W - M - (hasAct ? 70 : 44);
  const X_REST = W - M - (hasAct ? 30 : 2);
  const EXW = X_SETS - X_EX - 4;
  let anyPartial = false;
  const th = () => {
    fc(TINT);
    doc.rect(M, y, W - 2 * M, 7, 'F');
    tc(MUTED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('#', M + 2, y + 4.8);
    doc.text('EXERCISE', X_EX, y + 4.8);
    doc.text('SETS x REPS', X_SETS, y + 4.8);
    doc.text('REST', X_REST, y + 4.8, { align: 'right' });
    if (hasAct) doc.text('ACTUAL', W - M - 2, y + 4.8, { align: 'right' });
    y += 9;
  };
  need(30);
  th();
  items.forEach((it, i) => {
    const nameL = lines(it.exercise || 'Exercise', EXW, 11, 'bold');
    const subL = it.machine ? lines(it.machine + (it.zone ? `  -  ${it.zone}` : ''), EXW, 8.5, 'normal') : [];
    const noteT = it.note ? it.note : it.cue || '';
    const noteL = noteT ? lines(noteT, EXW, 9, 'italic') : [];
    const rowH = 3 + nameL.length * 5 + subL.length * 4 + noteL.length * 4.2 + 3;
    if (need(rowH)) th();
    fc(ACC);
    doc.circle(M + 4, y + 4.2, 3.2, 'F');
    tc([255, 255, 255]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(String(i + 1), M + 4, y + 5.3, { align: 'center' });
    let ty = y + 5;
    tc(INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    nameL.forEach((l) => {
      doc.text(l, X_EX, ty);
      ty += 5;
    });
    tc(MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    subL.forEach((l) => {
      doc.text(l, X_EX, ty - 0.5);
      ty += 4;
    });
    tc(INK);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    noteL.forEach((l) => {
      doc.text(l, X_EX, ty);
      ty += 4.2;
    });
    tc(INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(pdfSafe(`${it.sets} x ${it.reps}`), X_SETS, y + 5);
    doc.setFont('helvetica', 'normal');
    doc.text(it.rest ? `${it.rest} s` : '-', X_REST, y + 5, { align: 'right' });
    if (hasAct) {
      const at = it.done ? fmtClock(it.ms) : it.ms > 0 ? `${fmtClock(it.ms)}*` : '-';
      if (!it.done && it.ms > 0) anyPartial = true;
      if (it.done) {
        tc(INK);
        doc.setFont('helvetica', 'bold');
      } else {
        tc(MUTED);
        doc.setFont('helvetica', 'normal');
      }
      doc.text(at, W - M - 2, y + 5, { align: 'right' });
    }
    y += rowH;
    dc(LINE);
    doc.setLineWidth(0.2);
    doc.line(M, y - 1, W - M, y - 1);
  });
  if (m.actual) {
    need(14);
    y += 2;
    tc(INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Total workout time', W - M - 30, y + 3, { align: 'right' });
    doc.text(fmtClock(m.actual.totalMs), W - M - 2, y + 3, { align: 'right' });
    y += 7;
    if (anyPartial) {
      tc(MUTED);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('* started but not completed', M, y);
      y += 5;
    }
  }

  // Route maps: one per floor that has a stop on it.
  if (layout && items.length) {
    const equipById = new Map(layout.equipment.map((e) => [e.id, e]));
    const zoneName = new Map(layout.zones.map((z) => [z.id, z.name]));
    const floorName = new Map(layout.floors.map((f) => [f.id, f.name]));
    const routeZones: string[] = [];
    items.forEach((it) => {
      if (it.zone && routeZones[routeZones.length - 1] !== it.zone) routeZones.push(it.zone);
    });
    const used = new Set<string>();
    items.forEach((it) => {
      const e = equipById.get(it.eid);
      if (e) used.add(e.floor);
    });
    const floorsUsed = layout.floors.filter((f) => used.has(f.id));
    let sc = 1;
    const drawStruct = (q: Layout['structs'][number], ox: number, oy: number) => {
      const def = STRUCT_DEFS[q.type];
      if (!def) return;
      const X = (v: number) => ox + v * sc;
      const Y = (v: number) => oy + v * sc;
      dc(INKC);
      fc([255, 255, 255]);
      if (def.kind === 'line') {
        if (q.type === 'glass') {
          dc(GLASS);
          doc.setLineWidth(0.7);
        } else if (q.type === 'wall') doc.setLineWidth(1.1);
        else doc.setLineWidth(0.3);
        doc.line(X(q.x), Y(q.y), X(q.x2 ?? q.x), Y(q.y2 ?? q.y));
      } else if (def.kind === 'box') {
        const w = q.w || 40;
        const h = q.h || 40;
        doc.setLineWidth(0.35);
        doc.rect(X(q.x), Y(q.y), w * sc, h * sc, 'FD');
        tc(INKC);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5);
        doc.text(
          pdfSafe(q.type === 'toilets' ? 'WC' : (q.label || def.name).toUpperCase()),
          X(q.x + w / 2),
          Y(q.y + h / 2) + 0.8,
          {
            align: 'center',
          },
        );
      } else {
        const w = q.w || 30;
        const a = ((q.rot || 0) * Math.PI) / 180;
        const co = Math.cos(a);
        const si = Math.sin(a);
        const P = (lx: number, ly: number): [number, number] => [
          X(q.x + lx * co - ly * si),
          Y(q.y + lx * si + ly * co),
        ];
        const hw = w / 2;
        const seg = (a1: [number, number], a2: [number, number]) => doc.line(a1[0], a1[1], a2[0], a2[1]);
        if (q.type === 'column') {
          fc(INKC);
          doc.rect(X(q.x - hw), Y(q.y - hw), w * sc, w * sc, 'F');
          return;
        }
        if (q.type === 'revolving') {
          dc(GLASS);
          doc.setLineWidth(0.5);
          doc.circle(X(q.x), Y(q.y), hw * sc, 'S');
          seg(P(-hw * 0.7, -hw * 0.7), P(hw * 0.7, hw * 0.7));
          seg(P(hw * 0.7, -hw * 0.7), P(-hw * 0.7, hw * 0.7));
          return;
        }
        if (q.type === 'dglass') {
          dc(GLASS);
          doc.setLineWidth(0.6);
          seg(P(-hw, 0), P(hw, 0));
          seg(P(-hw, 0), P(-hw, -hw));
          seg(P(hw, 0), P(hw, -hw));
          return;
        }
        doc.setLineWidth(0.6);
        seg(P(-hw, 0), P(hw, 0));
        seg(P(-hw, 0), P(-hw, -w));
      }
    };

    floorsUsed.forEach((fl, fi) => {
      sc = Math.min((W - 2 * M) / fl.w, 215 / fl.h);
      const mh = fl.h * sc;
      const head = fi === 0 ? 12 + Math.max(1, Math.ceil(routeZones.join('  >  ').length / 95)) * 4 : 0;
      if (!need(mh + 22 + head)) y += 6;
      if (fi === 0) {
        tc(INK);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(hasAct ? 'Route around the gym' : 'Your route around the gym', M, y);
        y += 5;
        if (routeZones.length) {
          tc(MUTED);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          lines(routeZones.join('  >  '), W - 2 * M, 8.5, 'normal').forEach((l) => {
            doc.text(l, M, y);
            y += 4;
          });
        }
        y += 2;
      }
      if (multiFloor) {
        tc(INK);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(pdfSafe(fl.name), M, y + 3);
        y += 6;
      }
      const ox = M;
      const oy = y;
      fc([248, 250, 251]);
      dc(LINE);
      doc.setLineWidth(0.3);
      doc.rect(ox, oy, fl.w * sc, mh, 'FD');
      layout.zones
        .filter((z) => z.floor === fl.id)
        .forEach((z) => {
          fc(PDF_ZONE[z.cat] ?? [230, 230, 230]);
          dc([150, 160, 170]);
          doc.setLineWidth(0.25);
          const an = zoneLabelRect(z);
          if (z.parts && z.parts.length) {
            zoneRects(z).forEach((r) => doc.rect(ox + r.x * sc, oy + r.y * sc, r.w * sc, r.h * sc, 'F'));
            zoneLoops(z).forEach((pts) => {
              pts.forEach((p, i) => {
                const q = pts[(i + 1) % pts.length]!;
                doc.line(ox + p[0] * sc, oy + p[1] * sc, ox + q[0] * sc, oy + q[1] * sc);
              });
            });
          } else doc.rect(ox + z.x * sc, oy + z.y * sc, z.w * sc, z.h * sc, 'FD');
          tc(MUTED);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6);
          doc.text(pdfSafe(z.name.toUpperCase()), ox + an.x * sc + 1.5, oy + an.y * sc + 3.5);
        });
      structsOn(layout.structs, fl.id).forEach((q) => drawStruct(q, ox, oy));

      const stops: { e: Layout['equipment'][number]; nums: number[] }[] = [];
      const byEq = new Map<string, { e: Layout['equipment'][number]; nums: number[] }>();
      const path: Layout['equipment'] = [];
      let lastId: string | null = null;
      items.forEach((it, i) => {
        const e = equipById.get(it.eid);
        if (!e) return;
        if (lastId !== e.id) {
          path.push(e);
          lastId = e.id;
        }
        if (e.floor !== fl.id) return;
        let st = byEq.get(e.id);
        if (!st) {
          st = { e, nums: [] };
          byEq.set(e.id, st);
          stops.push(st);
        }
        st.nums.push(i + 1);
      });
      const moves: [Layout['equipment'][number], string][] = [];
      dc(ACC);
      doc.setLineWidth(0.5);
      doc.setLineDashPattern([1.6, 1.2], 0);
      for (let k = 1; k < path.length; k++) {
        const pa = path[k - 1]!;
        const pb = path[k]!;
        const ia = pa.floor === fl.id;
        const ib = pb.floor === fl.id;
        if (ia && ib) doc.line(ox + pa.x * sc, oy + pa.y * sc, ox + pb.x * sc, oy + pb.y * sc);
        else if (ia) moves.push([pa, `to ${floorName.get(pb.floor) ?? ''}`]);
        else if (ib) moves.push([pb, `from ${floorName.get(pa.floor) ?? ''}`]);
      }
      doc.setLineDashPattern([], 0);
      stops.forEach((st) => {
        const cx = ox + st.e.x * sc;
        const cy = oy + st.e.y * sc;
        const label = st.nums.join(',');
        const r = label.length > 2 ? 4.8 : 3.6;
        fc(ACC);
        doc.circle(cx, cy, r, 'F');
        tc([255, 255, 255]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(label.length > 2 ? 6 : 7.5);
        doc.text(label, cx, cy + 1, { align: 'center' });
        tc(INK);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5);
        doc.text(pdfSafe(st.e.name), cx, cy + r + 2.6, { align: 'center' });
      });
      moves.forEach((mv, mi) => {
        tc(ACC);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        doc.text(pdfSafe(`> ${mv[1]}`), ox + mv[0].x * sc, oy + mv[0].y * sc - 5 - (mi % 3) * 2.6, {
          align: 'center',
        });
      });
      void zoneName;
      y = oy + mh + 6;
    });
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    tc(MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(pdfSafe((m.title || 'Training programme') + (m.client ? `  -  ${m.client}` : '')), M, H - 8);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc;
}

/** Builds the PDF and offers it as a download. */
export function savePdf(m: PdfModel, fileName: string): void {
  buildPdf(m).save(fileName);
}
