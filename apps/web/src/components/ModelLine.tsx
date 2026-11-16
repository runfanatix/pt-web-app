import { modelWithCode, type ModelEntry } from '@pt/core';
import { useModelOf } from '../data/catalogueApi.ts';

/** The real machine behind a plan item, e.g. "Technogym Selection Chest Press (MPY01)". Nothing if it is not known. */
export function ModelLine({ equipment }: { equipment: { catalogueId?: string | null } | undefined | null }) {
  const entry = useModelOf(equipment);
  return entry ? <span className="model">{modelWithCode(entry)}</span> : null;
}

/** The model's specifications as a short list. */
export function SpecList({ entry }: { entry: ModelEntry | undefined }) {
  if (!entry || !entry.item.specs.length) return null;
  return (
    <dl className="specs">
      {entry.item.specs.map((s, i) => (
        <div key={i}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
