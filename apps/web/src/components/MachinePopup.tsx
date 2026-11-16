import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LEVEL_NAMES, rxText, type Layout, type LibraryExercise } from '@pt/core';
import { TYPE_LETTERS } from './FloorPlan.tsx';
import { ModelLine } from './ModelLine.tsx';

type Equip = Layout['equipment'][number];

interface Props {
  equipment: Equip;
  place: string;
  exercises: LibraryExercise[];
  /** How many times each exercise is already in the session for this machine. */
  inSession: Record<string, number>;
  onAdd: (x: LibraryExercise) => void;
  onClose: () => void;
}

const isNarrow = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;

/** Exercises linked to a tapped machine. A floating card by the machine, or a bottom sheet on phones. */
export function MachinePopup({ equipment, place, exercises, inSession, onAdd, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [sheet, setSheet] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const narrow = isNarrow();
    setSheet(narrow);
    if (narrow) return setPos(null);
    const marker = Array.from(document.querySelectorAll('#map [data-eq]')).find(
      (n) => n.getAttribute('data-eq') === equipment.id,
    );
    if (!marker) return;
    const r = marker.getBoundingClientRect();
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), Math.max(8, vw - pw - 8));
    const below = r.bottom + 12;
    const top = below + ph <= vh - 8 ? below : Math.max(8, r.top - 12 - ph);
    setPos({ left, top });
  }, [equipment.id, exercises.length]);

  // Escape closes; focus returns to where it was when the card opens.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment.id]);

  const letter = (TYPE_LETTERS[equipment.type] ?? TYPE_LETTERS.space!).letter;
  return (
    <div
      ref={ref}
      className={`pop${sheet ? ' sheet' : ''}`}
      role="dialog"
      aria-label={`Exercises on ${equipment.name}`}
      tabIndex={-1}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
    >
      <div className="pophead">
        <span className="dot">{letter}</span>
        <div className="t">
          <strong>{equipment.name}</strong>
          <ModelLine equipment={equipment} />
          <span className="sub">
            {place} · {exercises.length} exercise{exercises.length === 1 ? '' : 's'}
          </span>
        </div>
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {exercises.length ? (
        <ul className="poplist">
          {exercises.map((x) => {
            const n = inSession[x.id] ?? 0;
            return (
              <li key={x.id}>
                <button type="button" className="popitem" onClick={() => onAdd(x)}>
                  <span className="txt">
                    <span className="nm">{x.name}</span>
                    <span className="sub">
                      {rxText(x)} · {LEVEL_NAMES[x.level] ?? x.level}
                    </span>
                    {n > 0 && <span className="in">In session{n > 1 ? ` x${n}` : ''}</span>}
                  </span>
                  <span className="plus" aria-hidden="true">
                    +
                  </span>
                </button>
                {x.link && (
                  <a
                    className="demo"
                    href={x.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Watch a demo of ${x.name}`}
                  >
                    Watch demo
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="popempty">No exercises are linked to this equipment yet.</p>
      )}
    </div>
  );
}
