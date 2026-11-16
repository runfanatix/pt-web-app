import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  INVOICE_STATUS_LABEL,
  InvoiceSettingsSchema,
  PAY_METHODS,
  PAY_METHOD_LABEL,
  addMonths,
  autoInvoiceDay,
  defaultInvoiceSettings,
  fmtDate,
  invoiceMessage,
  isOverdue,
  monthLabel,
  nextMonthStart,
  outstanding,
  parseRand,
  rand,
  shortDate,
  todaySast,
  whatsappUrl,
  type ClientRecord,
  type GenerationSummary,
  type Invoice,
  type InvoiceSettings,
  type PayMethod,
} from '@pt/core';
import type { ClientRate, InvoicesApi } from '../data/invoices.ts';
import { copyText } from '../lib/clipboard.ts';
import { pdfModelFromInvoice, saveInvoicePdf } from '../lib/invoicePdf.ts';
import { ConfirmButton } from './ConfirmButton.tsx';

type Settings = InvoiceSettings & { businessName: string; address: string; email: string; phone: string };

const randText = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','));

/** One editable line of a draft: changes are saved when the field is left. */
function LineRow({
  line,
  onSave,
  onRemove,
  disabled,
}: {
  line: Invoice['lines'][number];
  onSave: (l: { description: string; quantity: number; unitCents: number }) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [d, setD] = useState(line.description);
  const [q, setQ] = useState(String(line.quantity));
  const [p, setP] = useState(randText(line.unitCents));
  useEffect(() => {
    setD(line.description);
    setQ(String(line.quantity));
    setP(randText(line.unitCents));
  }, [line.description, line.quantity, line.unitCents]);
  const commit = () => {
    const qty = Number(q.replace(',', '.'));
    const cents = parseRand(p);
    if (!d.trim() || !Number.isFinite(qty) || qty < 0 || cents === null) return;
    if (d.trim() !== line.description || qty !== line.quantity || cents !== line.unitCents)
      onSave({ description: d.trim(), quantity: qty, unitCents: cents });
  };
  return (
    <div className="fields invline">
      <label className="wide">
        Description
        <input
          type="text"
          maxLength={300}
          value={d}
          disabled={disabled}
          onChange={(e) => setD(e.target.value)}
          onBlur={commit}
        />
      </label>
      <label>
        Quantity
        <input
          type="text"
          inputMode="decimal"
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          onBlur={commit}
        />
      </label>
      <label>
        Price (R)
        <input
          type="text"
          inputMode="decimal"
          value={p}
          disabled={disabled}
          onChange={(e) => setP(e.target.value)}
          onBlur={commit}
        />
      </label>
      <button
        type="button"
        className="btn sm"
        aria-label={`Remove line ${line.description}`}
        disabled={disabled}
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

interface Props {
  api: InvoicesApi | null;
  clients: ClientRecord[] | null;
  say: (m: string) => void;
}

/** Monthly invoicing: set rates, make next month's invoices from the calendar (or let it happen automatically), send and track them. */
export function InvoicesTab({ api, clients, say }: Props) {
  const [today] = useState(() => todaySast());
  const [month, setMonth] = useState(() => nextMonthStart(todaySast()));
  const [list, setList] = useState<Invoice[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<InvoiceSettings>(defaultInvoiceSettings());
  const [rateText, setRateText] = useState('');
  const [rates, setRates] = useState<ClientRate[]>([]);
  const [summary, setSummary] = useState<GenerationSummary | null>(null);
  const [error, setError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [payFor, setPayFor] = useState<{ id: string; method: PayMethod; date: string } | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const [l, s, r] = await Promise.all([api.list(), api.settings(), api.rates()]);
      setList(l);
      setSettings(s);
      setRates(r);
      setError('');
    } catch (err) {
      setError(`Could not load invoices: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!settings) return;
    const { businessName: _b, address: _a, email: _e, phone: _p, ...s } = settings;
    void _b;
    void _a;
    void _e;
    void _p;
    setDraft(s);
    setRateText(randText(s.defaultRate));
  }, [settings]);

  const whatsapp = useMemo(
    () => new Map((clients ?? []).map((r) => [r.client.id, r.client.whatsapp])),
    [clients],
  );
  if (!api) return <p className="hint">Invoicing is not available yet.</p>;

  const mine = (list ?? []).filter((i) => i.periodStart === month);
  const owed = outstanding(list ?? [], today);
  const pay = (s: Settings) => ({ bankDetails: s.bankDetails, paymentLink: s.paymentLink, terms: s.terms });

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      if (ok) say(ok);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    const cents = rateText.trim() === '' ? null : parseRand(rateText);
    if (rateText.trim() !== '' && cents === null)
      return setSettingsError('Enter the default rate as a number, like 450 or 450,50.');
    const next = { ...draft, defaultRate: cents };
    const parsed = InvoiceSettingsSchema.safeParse(next);
    if (!parsed.success) return setSettingsError(parsed.error.issues.map((i) => i.message).join(' '));
    setSettingsError('');
    await run(() => api!.saveSettings(parsed.data), 'Invoice settings saved.');
  }

  async function generate() {
    setBusy(true);
    try {
      const r = await api!.generate(month);
      setSummary(r);
      await load();
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function send(i: Invoice) {
    if (!settings) return;
    await run(async () => {
      if (i.status === 'draft') await api!.setStatus(i.id, 'sent');
      const emailed = i.clientEmail ? await api!.email(i.id) : false;
      say(
        emailed
          ? `Invoice ${i.number} emailed to ${i.clientEmail}.`
          : `Invoice ${i.number} marked as sent. The email could not be sent${i.clientEmail ? ' (email is not set up yet)' : ' (no email address for this client)'}: send it by WhatsApp or download the PDF.`,
      );
    });
  }

  function pdf(i: Invoice) {
    if (!settings) return;
    saveInvoicePdf(
      pdfModelFromInvoice(
        i,
        {
          name: settings.businessName,
          address: settings.address,
          email: settings.email,
          phone: settings.phone,
        },
        pay(settings),
      ),
    );
  }

  const card = (i: Invoice) => {
    const draftable = i.status === 'draft';
    const wa = i.clientId ? whatsapp.get(i.clientId) : '';
    const msg = settings ? invoiceMessage(i, settings.businessName, pay(settings)) : '';
    const late = isOverdue(i, today);
    return (
      <li key={i.id} className={`invoice st-${i.status}`} aria-label={`Invoice ${i.number}`}>
        <div className="cardhead">
          <div>
            <strong>{i.clientName}</strong>
            <span className="sub">
              {i.number} · due {shortDate(i.dueOn)}
              {i.autoGenerated ? ' · made automatically' : ''}
            </span>
          </div>
          <div className="invtotal">
            <b>{rand(i.total)}</b>
            <span className="chipst">
              {INVOICE_STATUS_LABEL[i.status]}
              {late ? ' · overdue' : ''}
              {i.status === 'sent' && i.emailQueuedAt && !i.emailedAt ? ' · waiting to be emailed' : ''}
              {i.status === 'sent' && i.emailedAt ? ' · emailed' : ''}
              {i.status === 'paid' && i.paidMethod
                ? ` · ${PAY_METHOD_LABEL[i.paidMethod]}${i.paidAt ? ` on ${shortDate(i.paidAt.slice(0, 10))}` : ''}`
                : ''}
            </span>
          </div>
        </div>
        {draftable ? (
          <>
            {i.lines.map((l) => (
              <LineRow
                key={l.id}
                line={l}
                disabled={busy}
                onSave={(v) => void run(() => api.updateLine(l.id, v))}
                onRemove={() => void run(() => api.removeLine(l.id))}
              />
            ))}
            <div className="btnrow">
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    api.addLine(i.id, i.lines.length + 1, {
                      description: 'Adjustment',
                      quantity: 1,
                      unitCents: 0,
                    }),
                  )
                }
              >
                Add a line
              </button>
            </div>
          </>
        ) : (
          <ul className="rows" aria-label={`Lines of ${i.number}`}>
            {i.lines.map((l) => (
              <li key={l.id}>
                <span className="txt">
                  {l.description}
                  <span className="sub">{`${l.quantity} x ${rand(l.unitCents)} = ${rand(l.amountCents)}`}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="sub">
          {i.vatPercent > 0 ? `Subtotal ${rand(i.subtotal)} + VAT ${i.vatPercent}% ${rand(i.vat)}. ` : ''}
          {i.notes}
        </p>
        <div className="btnrow">
          {(i.status === 'draft' || i.status === 'sent') && (
            <button type="button" className="btn sm primary" disabled={busy} onClick={() => void send(i)}>
              {i.status === 'draft' ? 'Send to client' : 'Email again'}
            </button>
          )}
          <button type="button" className="btn sm" onClick={() => pdf(i)}>
            Download PDF
          </button>
          {i.status === 'sent' && wa && (
            <a className="btn sm" target="_blank" rel="noreferrer" href={whatsappUrl(wa, msg)}>
              Send on WhatsApp
            </a>
          )}
          {i.status === 'sent' && (
            <button
              type="button"
              className="btn sm"
              onClick={() => void copyText(msg).then((ok) => say(ok ? 'Message copied.' : 'Could not copy.'))}
            >
              Copy message
            </button>
          )}
          {i.status === 'sent' && (
            <button
              type="button"
              className="btn sm"
              onClick={() => setPayFor({ id: i.id, method: 'eft', date: today })}
            >
              Mark as paid
            </button>
          )}
          {i.status === 'sent' && (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() =>
                void run(() => api.setStatus(i.id, 'draft'), 'Back to draft: you can change the lines.')
              }
            >
              Edit again
            </button>
          )}
          {i.status === 'paid' && (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => void run(() => api.markUnpaid(i.id), 'Marked as not paid.')}
            >
              Mark as not paid
            </button>
          )}
          {(i.status === 'draft' || i.status === 'sent') && (
            <ConfirmButton
              aria-label={`Cancel invoice ${i.number}`}
              disabled={busy}
              onConfirm={() =>
                void run(() => api.setStatus(i.id, 'void'), 'Invoice cancelled. You can make a new one.')
              }
            >
              Cancel invoice
            </ConfirmButton>
          )}
          {i.status === 'draft' && (
            <ConfirmButton
              aria-label={`Delete draft ${i.number}`}
              disabled={busy}
              onConfirm={() => void run(() => api.removeDraft(i.id), 'Draft deleted.')}
            >
              Delete draft
            </ConfirmButton>
          )}
        </div>
        {payFor?.id === i.id && (
          <div className="fields" aria-label="Record payment">
            <label>
              Paid by
              <select
                value={payFor.method}
                onChange={(e) => setPayFor({ ...payFor, method: e.target.value as PayMethod })}
              >
                {PAY_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAY_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Paid on
              <input
                type="date"
                value={payFor.date}
                onChange={(e) => setPayFor({ ...payFor, date: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn primary sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.markPaid(i.id, payFor.method, payFor.date).then(() => setPayFor(null)),
                  `Invoice ${i.number} marked as paid.`,
                )
              }
            >
              Save payment
            </button>
            <button type="button" className="btn sm" onClick={() => setPayFor(null)}>
              Close
            </button>
          </div>
        )}
      </li>
    );
  };

  const next = settings ? autoInvoiceDay(today, draft.daysBefore) : '';

  return (
    <div className="stack">
      <h2>Invoices</h2>
      <p className="sub">
        Clients are billed monthly in advance for the sessions in your calendar. Book their sessions for the
        coming month, then make the invoices here, or switch on automatic invoicing in the settings below.
      </p>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}

      {list && (
        <p role="status" className="sub">
          {owed.count
            ? `Owed to you: ${rand(owed.owed)} across ${owed.count} invoice${owed.count === 1 ? '' : 's'}${owed.overdueCount ? `, of which ${rand(owed.overdue)} is overdue (${owed.overdueCount})` : ''}.`
            : 'Nothing is owed to you right now.'}
        </p>
      )}

      <section className="card" aria-label="Make invoices">
        <div className="calbar">
          <h3>{monthLabel(month)}</h3>
          <div className="btnrow">
            <button
              type="button"
              className="btn sm"
              aria-label="Previous month"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              ‹
            </button>
            <button type="button" className="btn sm" onClick={() => setMonth(nextMonthStart(today))}>
              Next month
            </button>
            <button
              type="button"
              className="btn sm"
              aria-label="Following month"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              ›
            </button>
          </div>
        </div>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void generate()}>
          {`Make the ${monthLabel(month)} invoices`}
        </button>
        {summary && summary.month === month && (
          <div role="status" aria-label="What was made">
            <p>
              {summary.generated
                ? `Made ${summary.generated} invoice${summary.generated === 1 ? '' : 's'} as drafts. Check them, then send.`
                : 'No new invoices were made.'}
            </p>
            {summary.skippedExisting > 0 && (
              <p className="sub">{`${summary.skippedExisting} client${summary.skippedExisting === 1 ? ' already has' : 's already have'} an invoice for this month.`}</p>
            )}
            {summary.skippedNoSessions > 0 && (
              <p className="sub">{`${summary.skippedNoSessions} client${summary.skippedNoSessions === 1 ? ' has' : 's have'} no sessions booked this month.`}</p>
            )}
            {summary.skippedNoRate.length > 0 && (
              <p className="warn">{`No rate set for ${summary.skippedNoRate.join(', ')}. Set a rate below, then make the invoices again.`}</p>
            )}
          </div>
        )}
      </section>

      <section aria-label={`${monthLabel(month)} invoices`}>
        {list === null ? (
          <p className="hint">Loading…</p>
        ) : mine.length ? (
          <ul className="rows invoices" aria-label="Invoices">
            {mine.map(card)}
          </ul>
        ) : (
          <p className="sub">{`No invoices for ${monthLabel(month)} yet.`}</p>
        )}
      </section>

      <details className="card" aria-label="Rates">
        <summary>
          <strong>Rates per client</strong>
        </summary>
        <p className="sub">
          A client with no rate of their own pays the default rate
          {settings?.defaultRate != null ? ` (${rand(settings.defaultRate)})` : ' (not set yet)'}. The rate is
          per session.
        </p>
        <ul className="rows">
          {rates.map((r) => (
            <RateRow
              key={r.clientId}
              r={r}
              onSave={(c) => void run(() => api.setRate(r.clientId, c), `Rate saved for ${r.name}.`)}
            />
          ))}
          {!rates.length && <li className="sub">No clients yet.</li>}
        </ul>
      </details>

      <details className="card" aria-label="Invoice settings">
        <summary>
          <strong>Invoice settings</strong>
        </summary>
        <div className="fields">
          <label>
            Default rate per session (R)
            <input
              type="text"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
            />
          </label>
          <label>
            VAT (%) (0 if you do not charge VAT)
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={draft.vatPercent}
              onChange={(e) => setDraft({ ...draft, vatPercent: Number(e.target.value) })}
            />
          </label>
          <label>
            Invoice number prefix
            <input
              type="text"
              maxLength={10}
              value={draft.prefix}
              onChange={(e) => setDraft({ ...draft, prefix: e.target.value })}
            />
          </label>
          <label className="wide">
            Bank details (shown on every invoice)
            <textarea
              rows={3}
              maxLength={600}
              value={draft.bankDetails}
              onChange={(e) => setDraft({ ...draft, bankDetails: e.target.value })}
            />
          </label>
          <label className="wide">
            Payment link (optional, from PayFast, Yoco, Ozow or similar)
            <input
              type="url"
              maxLength={300}
              value={draft.paymentLink}
              placeholder="https://"
              onChange={(e) => setDraft({ ...draft, paymentLink: e.target.value })}
            />
          </label>
          <label className="wide">
            Payment terms (optional)
            <input
              type="text"
              maxLength={600}
              value={draft.terms}
              onChange={(e) => setDraft({ ...draft, terms: e.target.value })}
            />
          </label>
        </div>
        <h4>Automatic invoicing</h4>
        <label className="chk">
          <input
            type="checkbox"
            checked={draft.auto}
            onChange={(e) => setDraft({ ...draft, auto: e.target.checked })}
          />
          Make next month’s invoices automatically
        </label>
        <div className="fields">
          <label>
            Days before the month ends
            <input
              type="number"
              min={0}
              max={25}
              value={draft.daysBefore}
              onChange={(e) => setDraft({ ...draft, daysBefore: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="chk">
          <input
            type="checkbox"
            checked={draft.autoSend}
            onChange={(e) => setDraft({ ...draft, autoSend: e.target.checked })}
          />
          Send them to clients without checking first
        </label>
        <p className="sub">
          {draft.auto
            ? `This month’s run is on ${fmtDate(next)}: that is when next month’s invoices are made from the sessions in your calendar. ${draft.autoSend ? 'They go out straight away (marked as sent, and emailed once email is set up).' : 'They wait as drafts for you to check and send.'} Clients with no sessions or no rate are skipped.`
            : 'Automatic invoicing is off: press the button above each month.'}
        </p>
        {settingsError && (
          <p role="alert" className="err">
            {settingsError}
          </p>
        )}
        <div className="btnrow">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void saveSettings()}>
            Save settings
          </button>
        </div>
      </details>
    </div>
  );
}

function RateRow({ r, onSave }: { r: ClientRate; onSave: (cents: number | null) => void }) {
  const [t, setT] = useState(randText(r.rateCents));
  useEffect(() => setT(randText(r.rateCents)), [r.rateCents]);
  return (
    <li>
      <label className="txt">
        {r.name}
        <input
          type="text"
          inputMode="decimal"
          aria-label={`Rate for ${r.name}`}
          placeholder="Default rate"
          value={t}
          onChange={(e) => setT(e.target.value)}
          onBlur={() => {
            const cents = t.trim() === '' ? null : parseRand(t);
            if (t.trim() !== '' && cents === null) return setT(randText(r.rateCents));
            if (cents !== r.rateCents) onSave(cents);
          }}
        />
      </label>
    </li>
  );
}
