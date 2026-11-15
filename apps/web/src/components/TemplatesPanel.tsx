import { useCallback, useEffect, useState } from 'react';
import { snapsOf, type SessionItem } from '@pt/core';
import type { Template, TemplateApi } from '../data/templates.ts';
import { ConfirmButton } from './ConfirmButton.tsx';

interface Props {
  api: TemplateApi;
  gymId: string;
  gymNames: Record<string, string>;
  items: SessionItem[];
  /** Default template name: the session name. */
  title: string;
  notes: string;
  /** Replace the session with a template, or add it to the end. The parent remaps machines onto the open gym. */
  onUse: (t: Template, mode: 'replace' | 'append') => void;
}

/** Save the routine as a template, and load, add or delete saved ones. */
export function TemplatesPanel({ api, gymId, gymNames, items, title, notes, onUse }: Props) {
  const [list, setList] = useState<Template[] | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setList(await api.list());
    } catch (err) {
      setStatus(`Could not load templates: ${err instanceof Error ? err.message : String(err)}`);
      setList([]);
    }
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const effectiveName = (name || title).trim();

  async function save() {
    if (!items.length) return setStatus('Add at least one exercise before saving a template.');
    if (!effectiveName) return setStatus('Give the template a name.');
    setBusy(true);
    try {
      const { updated } = await api.save({
        gymId,
        name: effectiveName,
        notes: notes.trim(),
        items: snapsOf(items),
      });
      setStatus(`${updated ? 'Updated' : 'Saved'} template "${effectiveName}".`);
      await refresh();
    } catch (err) {
      setStatus(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: Template) {
    try {
      await api.remove(t.id);
      setStatus(`Deleted template "${t.name}".`);
      await refresh();
    } catch (err) {
      setStatus(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <section className="share" aria-label="Templates">
      <h3>Templates</h3>
      <label>
        Template name
        <input
          type="text"
          value={name}
          placeholder={title || 'e.g. Beginner full body'}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="btnrow">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          Save as template
        </button>
      </div>
      <p role="status" aria-live="polite" className="sub">
        {status}
      </p>

      <h4>Saved templates</h4>
      {list === null ? (
        <p className="sub">Loading…</p>
      ) : list.length === 0 ? (
        <p className="empty">No saved templates yet.</p>
      ) : (
        <ul className="rows">
          {list.map((t) => (
            <li key={t.id}>
              <div className="txt">
                <span>{t.name}</span>
                <span className="sub">
                  {t.items.length} exercise{t.items.length === 1 ? '' : 's'}
                  {t.gymId !== gymId && gymNames[t.gymId] ? ` · from ${gymNames[t.gymId]}` : ''}
                </span>
              </div>
              <div className="btnrow">
                <button
                  type="button"
                  className="btn sm primary"
                  aria-label={`Load ${t.name}`}
                  onClick={() => onUse(t, 'replace')}
                >
                  Load
                </button>
                <button
                  type="button"
                  className="btn sm"
                  aria-label={`Add ${t.name} to session`}
                  onClick={() => onUse(t, 'append')}
                >
                  Add to session
                </button>
                <ConfirmButton aria-label={`Delete ${t.name}`} onConfirm={() => void remove(t)}>
                  Delete
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
