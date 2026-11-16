import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RESPONSE_LABEL,
  STATUS_LABEL,
  WEEKDAY_SHORT,
  addDays,
  addMonths,
  bookingProblems,
  bookingRows,
  bookingsOn,
  clashes,
  countsByDate,
  fromIso,
  gymTitle,
  isLive,
  longDate,
  minutesBetween,
  monthGrid,
  monthName,
  reminderText,
  shortDate,
  timeRange,
  toIcs,
  toIso,
  todaySast,
  weekDates,
  whatsappUrl,
  type Booking,
  type ClientRecord,
  type GymSummary,
} from '@pt/core';
import type { BookingsApi } from '../data/bookings.ts';
import { downloadText } from '../data/bookings.ts';
import { newUid } from '../session/sessionState.ts';
import { ConfirmButton } from './ConfirmButton.tsx';

type View = 'month' | 'week' | 'day';
const DURATIONS = [30, 45, 60, 90, 120];

interface Form {
  id: string | null;
  seriesId: string | null;
  clientId: string;
  gymId: string;
  title: string;
  date: string;
  time: string;
  minutes: number;
  weeks: number;
  notes: string;
}

interface Props {
  api: BookingsApi | null;
  clients: ClientRecord[] | null;
  gyms: GymSummary[];
  openGymId: string;
  trainerName: string;
  say: (m: string) => void;
}

/** The trainer's calendar: month, week and day views of booked sessions, with booking, repeating, and marking them done. */
export function CalendarTab({ api, clients, gyms, openGymId, trainerName, say }: Props) {
  const [view, setView] = useState<View>('month');
  const [today] = useState(() => todaySast());
  const [date, setDate] = useState(today);
  const [list, setList] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const month = date.slice(0, 7);
  const [year, mon] = month.split('-').map(Number) as [number, number];
  // Load the whole visible month plus the days of the weeks that spill over it.
  const rangeFrom = addDays(`${month}-01`, -7);
  const rangeTo = addDays(addMonths(`${month}-01`, 1), 8);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setList(await api.list(toIso(rangeFrom, '00:00'), toIso(rangeTo, '00:00')));
      setError('');
    } catch (err) {
      setError(`Could not load your calendar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [api, rangeFrom, rangeTo]);
  useEffect(() => {
    void load();
  }, [load]);

  const clientName = useMemo(
    () => new Map((clients ?? []).map((r) => [r.client.id, r.client.name])),
    [clients],
  );
  const clientRec = useMemo(() => new Map((clients ?? []).map((r) => [r.client.id, r.client])), [clients]);
  const gymName = useMemo(() => new Map(gyms.map((g) => [g.id, gymTitle(g)])), [gyms]);

  if (!api) return <p className="hint">The calendar is not available yet.</p>;

  const counts = countsByDate(list ?? []);
  const move = (dir: -1 | 1) =>
    setDate(
      view === 'month' ? addMonths(`${month}-01`, dir) : addDays(date, dir * (view === 'week' ? 7 : 1)),
    );

  function openNew(d = date) {
    setFormError('');
    setForm({
      id: null,
      seriesId: null,
      clientId: '',
      gymId: openGymId,
      title: 'Training session',
      date: d,
      time: '07:00',
      minutes: 60,
      weeks: 1,
      notes: '',
    });
  }
  function openEdit(b: Booking) {
    const s = fromIso(b.startsAt);
    setFormError('');
    setForm({
      id: b.id,
      seriesId: b.seriesId,
      clientId: b.clientId ?? '',
      gymId: b.gymId ?? '',
      title: b.title,
      date: s.date,
      time: s.time,
      minutes: minutesBetween(b.startsAt, b.endsAt),
      weeks: 1,
      notes: b.notes,
    });
  }

  const draftRange =
    form && /^\d{4}-\d{2}-\d{2}$/.test(form.date) && /^\d{2}:\d{2}$/.test(form.time)
      ? {
          s: toIso(form.date, form.time),
          e: new Date(Date.parse(toIso(form.date, form.time)) + form.minutes * 60000).toISOString(),
        }
      : null;
  const conflicts =
    form && draftRange && list ? clashes(list, draftRange.s, draftRange.e, form.id ?? undefined) : [];

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      say(ok);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    const input = {
      clientId: form.clientId || null,
      gymId: form.gymId || null,
      title: form.title,
      date: form.date,
      time: form.time,
      minutes: form.minutes,
      weeks: form.id ? 1 : form.weeks,
      notes: form.notes,
    };
    const problems = bookingProblems(input);
    if (problems.length) return setFormError(problems.join(' '));
    setFormError('');
    const rows = bookingRows(input, newUid);
    await run(
      async () => {
        if (form.id) {
          const r = rows[0]!;
          const old = list?.find((b) => b.id === form.id);
          const moved = !old || old.startsAt !== r.starts_at || old.endsAt !== r.ends_at;
          await api!.update(form.id, {
            client_id: r.client_id,
            gym_id: r.gym_id,
            title: r.title,
            starts_at: r.starts_at,
            ends_at: r.ends_at,
            notes: r.notes,
            ...(moved ? { client_response: 'pending' as const } : {}),
          });
        } else await api!.create(rows);
        setForm(null);
      },
      form.id
        ? 'Session updated.'
        : rows.length > 1
          ? `${rows.length} weekly sessions booked.`
          : 'Session booked.',
    );
  }

  const setStatus = (b: Booking, status: Booking['status']) =>
    run(
      () => api!.update(b.id, { status, cancelled_by: status === 'cancelled' ? 'trainer' : null }),
      `Marked ${STATUS_LABEL[status].toLowerCase()}.`,
    );

  const sessionCard = (b: Booking) => {
    const c = b.clientId ? clientRec.get(b.clientId) : undefined;
    const name = b.clientId ? (clientName.get(b.clientId) ?? 'Client') : 'No client (blocked time)';
    const live = b.status === 'scheduled';
    const upcoming = Date.parse(b.startsAt) > Date.now();
    return (
      <li key={b.id} className={`booking st-${b.status}`}>
        <div className="btime">
          <b>{fromIso(b.startsAt).time}</b>
          <span className="sub">{minutesBetween(b.startsAt, b.endsAt)} min</span>
        </div>
        <div className="txt">
          <strong>{name}</strong>
          <span className="sub">
            {b.title}
            {b.gymId && gymName.get(b.gymId) ? ` · ${gymName.get(b.gymId)}` : ''}
            {b.seriesId ? ' · repeats weekly' : ''}
          </span>
          <span className="chipst">
            {STATUS_LABEL[b.status]}
            {live && b.clientId ? ` · ${RESPONSE_LABEL[b.response]}` : ''}
          </span>
          {b.notes && <span className="sub">{b.notes}</span>}
        </div>
        <div className="btnrow">
          {live && (
            <>
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() => void setStatus(b, 'completed')}
              >
                Done
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() => void setStatus(b, 'no_show')}
              >
                Did not come
              </button>
              <button type="button" className="btn sm" disabled={busy} onClick={() => openEdit(b)}>
                Edit
              </button>
              {upcoming && c?.whatsapp && (
                <a
                  className="btn sm"
                  target="_blank"
                  rel="noreferrer"
                  href={whatsappUrl(
                    c.whatsapp,
                    reminderText(b, {
                      clientName: c.name,
                      trainerName,
                      gym: b.gymId ? (gymName.get(b.gymId) ?? '') : '',
                    }),
                  )}
                >
                  Remind on WhatsApp
                </a>
              )}
              <ConfirmButton
                aria-label={`Cancel the session with ${name}`}
                disabled={busy}
                onConfirm={() => void setStatus(b, 'cancelled')}
              >
                Cancel
              </ConfirmButton>
              {b.seriesId && (
                <ConfirmButton
                  aria-label={`Cancel this and all later weekly sessions with ${name}`}
                  disabled={busy}
                  onConfirm={() =>
                    void run(
                      () => api!.cancelSeriesFrom(b.seriesId!, b.startsAt),
                      'This and all later weekly sessions cancelled.',
                    )
                  }
                >
                  Cancel this and the rest
                </ConfirmButton>
              )}
            </>
          )}
          {!live && (
            <>
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() => void setStatus(b, 'scheduled')}
              >
                Put back as scheduled
              </button>
              <ConfirmButton
                aria-label={`Delete the session with ${name}`}
                disabled={busy}
                onConfirm={() => void run(() => api!.remove(b.id), 'Session deleted.')}
              >
                Delete
              </ConfirmButton>
            </>
          )}
        </div>
      </li>
    );
  };

  const dayList = (d: string) => {
    const items = bookingsOn(list ?? [], d);
    return items.length ? (
      <ul className="rows bookings" aria-label={`Sessions on ${longDate(d)}`}>
        {items.map(sessionCard)}
      </ul>
    ) : (
      <p className="sub">Nothing booked.</p>
    );
  };

  function exportMonth() {
    const month_ = (list ?? []).filter((b) => isLive(b) && fromIso(b.startsAt).date.startsWith(month));
    downloadText(
      `sessions-${month}.ics`,
      toIcs(
        month_.map((b) => ({
          id: b.id,
          title: `${b.title}${b.clientId && clientName.get(b.clientId) ? ` with ${clientName.get(b.clientId)}` : ''}`,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          location: b.gymId ? gymName.get(b.gymId) : undefined,
        })),
      ),
    );
    say(`Calendar file saved with ${month_.length} session${month_.length === 1 ? '' : 's'}.`);
  }

  const title =
    view === 'month'
      ? `${monthName(mon)} ${year}`
      : view === 'week'
        ? `Week of ${shortDate(weekDates(date)[0]!)}`
        : longDate(date);
  const upcomingCount = (list ?? []).filter(
    (b) => b.status === 'scheduled' && Date.parse(b.endsAt) > Date.now(),
  ).length;

  return (
    <div className="stack">
      <h2>Calendar</h2>
      <div className="calbar">
        <div className="seg" role="group" aria-label="Calendar view">
          {(['month', 'week', 'day'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'Day'}
            </button>
          ))}
        </div>
        <div className="btnrow">
          <button type="button" className="btn sm" aria-label="Previous" onClick={() => move(-1)}>
            ‹
          </button>
          <button type="button" className="btn sm" onClick={() => setDate(today)}>
            Today
          </button>
          <button type="button" className="btn sm" aria-label="Next" onClick={() => move(1)}>
            ›
          </button>
        </div>
      </div>
      <h3 aria-live="polite">{title}</h3>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}

      {view === 'month' && (
        <div className="monthgrid" role="grid" aria-label={`${monthName(mon)} ${year}`}>
          {WEEKDAY_SHORT.map((d) => (
            <span key={d} className="dow" role="columnheader">
              {d}
            </span>
          ))}
          {monthGrid(year, mon)
            .flat()
            .map((d) => {
              const n = counts.get(d.date) ?? 0;
              return (
                <button
                  key={d.date}
                  type="button"
                  role="gridcell"
                  className={`day${d.inMonth ? '' : ' out'}${d.date === today ? ' today' : ''}${d.date === date ? ' sel' : ''}`}
                  aria-label={`${longDate(d.date)}${n ? `, ${n} session${n === 1 ? '' : 's'}` : ''}`}
                  aria-pressed={d.date === date}
                  onClick={() => setDate(d.date)}
                >
                  <span className="dn">{Number(d.date.slice(8))}</span>
                  {n > 0 && <span className="dots">{n}</span>}
                </button>
              );
            })}
        </div>
      )}

      {view === 'week' &&
        weekDates(date).map((d) => (
          <section key={d} className="card" aria-label={longDate(d)}>
            <div className="cardhead">
              <h4>{longDate(d)}</h4>
              <button type="button" className="btn sm" onClick={() => openNew(d)}>
                Add
              </button>
            </div>
            {dayList(d)}
          </section>
        ))}

      {view !== 'week' && (
        <section className="card" aria-label="Selected day">
          <div className="cardhead">
            <h4>{longDate(date)}</h4>
            <button type="button" className="btn primary sm" onClick={() => openNew()}>
              Book a session
            </button>
          </div>
          {list ? dayList(date) : <p className="hint">Loading…</p>}
        </section>
      )}

      <div className="btnrow">
        {view === 'week' && (
          <button type="button" className="btn primary" onClick={() => openNew()}>
            Book a session
          </button>
        )}
        <button type="button" className="btn sm" onClick={exportMonth}>
          Save this month as a calendar file
        </button>
      </div>
      <p className="sub">
        {upcomingCount} upcoming session{upcomingCount === 1 ? '' : 's'} in view. Times are South African
        time.
      </p>

      {form && (
        <section className="card" aria-label={form.id ? 'Edit session' : 'Book a session'}>
          <h3>{form.id ? 'Edit session' : 'Book a session'}</h3>
          <div className="fields">
            <label className="wide">
              Client
              <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">No client (blocked time)</option>
                {(clients ?? []).map((r) => (
                  <option key={r.client.id} value={r.client.id}>
                    {r.client.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label>
              Start time
              <input
                type="time"
                step={300}
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </label>
            <label>
              Length (minutes)
              <select
                value={DURATIONS.includes(form.minutes) ? form.minutes : 'other'}
                onChange={(e) =>
                  e.target.value !== 'other' && setForm({ ...form, minutes: Number(e.target.value) })
                }
              >
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {!DURATIONS.includes(form.minutes) && <option value="other">{form.minutes}</option>}
              </select>
            </label>
            <label>
              Gym
              <select value={form.gymId} onChange={(e) => setForm({ ...form, gymId: e.target.value })}>
                <option value="">No gym</option>
                {gyms.map((g) => (
                  <option key={g.id} value={g.id}>
                    {gymTitle(g)}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Title
              <input
                type="text"
                maxLength={120}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            {!form.id && (
              <label>
                Repeat every week for
                <select
                  value={form.weeks}
                  onChange={(e) => setForm({ ...form, weeks: Number(e.target.value) })}
                >
                  {[1, 4, 8, 12, 26, 52].map((w) => (
                    <option key={w} value={w}>
                      {w === 1 ? 'Just this once' : `${w} weeks`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="wide">
              Notes (only you see these)
              <input
                type="text"
                maxLength={1000}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
          {form.id && form.seriesId && (
            <p className="sub">This changes only this session, not the others in the weekly series.</p>
          )}
          {conflicts.length > 0 && (
            <p role="status" className="warn">
              {`Clash: ${conflicts
                .map(
                  (c) =>
                    `${c.clientId ? (clientName.get(c.clientId) ?? 'a client') : 'blocked time'} at ${timeRange(c)}`,
                )
                .join(', ')}. You can still save it.`}
            </p>
          )}
          {formError && (
            <p role="alert" className="err">
              {formError}
            </p>
          )}
          <div className="btnrow">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
              {form.id ? 'Save changes' : 'Book it'}
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              Close
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
