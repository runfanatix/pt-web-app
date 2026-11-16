import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { defaultInvoiceSettings, nextMonthStart, todaySast } from '@pt/core';
import { App } from './App.tsx';
import { InvoicesTab } from './components/InvoicesTab.tsx';
import type { InvoicesApi, PaymentSettings } from './data/invoices.ts';

const today = todaySast();
const month = nextMonthStart(today);

function fakeApi(
  ps: PaymentSettings = {
    enabled: false,
    sandbox: true,
    merchantId: '',
    hasKey: false,
    hasPassphrase: false,
  },
) {
  const api: InvoicesApi = {
    settings: vi.fn(async () => ({
      ...defaultInvoiceSettings(),
      businessName: 'Alice',
      address: '',
      email: '',
      phone: '',
    })),
    saveSettings: vi.fn(async () => {}),
    rates: vi.fn(async () => []),
    setRate: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    generate: vi.fn(),
    addLine: vi.fn(async () => {}),
    updateLine: vi.fn(async () => {}),
    removeLine: vi.fn(async () => {}),
    setStatus: vi.fn(async () => {}),
    markPaid: vi.fn(async () => {}),
    markUnpaid: vi.fn(async () => {}),
    email: vi.fn(async () => true),
    removeDraft: vi.fn(async () => {}),
    paymentSettings: vi.fn(async () => ps),
    savePaymentSettings: vi.fn(async () => {}),
  };
  return api;
}
function mount(api: InvoicesApi, say = vi.fn()) {
  render(<InvoicesTab api={api} clients={[]} say={say} />);
  return say;
}

beforeEach(() => localStorage.clear());

describe('the trainer’s PayFast settings', () => {
  it('say whether the secrets are saved without ever showing them', async () => {
    mount(
      fakeApi({ enabled: true, sandbox: true, merchantId: '10000100', hasKey: true, hasPassphrase: true }),
    );
    fireEvent.click(await screen.findByText(/^Online payments \(PayFast\)/));
    expect(screen.getByLabelText('PayFast merchant ID')).toHaveValue('10000100');
    const key = screen.getByLabelText('PayFast merchant key');
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('placeholder', 'Saved: type to replace');
    expect(key).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/PayFast passphrase/)).toHaveAttribute('type', 'password');
  });

  it('switching it on needs the merchant ID and key; saving sends only what was typed', async () => {
    const api = fakeApi();
    mount(api);
    fireEvent.click(await screen.findByText(/^Online payments \(PayFast\)/));
    fireEvent.click(screen.getByLabelText('Let clients pay invoices online'));
    fireEvent.click(screen.getByRole('button', { name: 'Save online payment settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your PayFast merchant ID.');
    fireEvent.change(screen.getByLabelText('PayFast merchant ID'), { target: { value: '10000100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save online payment settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your PayFast merchant key.');
    fireEvent.change(screen.getByLabelText('PayFast merchant key'), { target: { value: '46f0cd694581a' } });
    fireEvent.change(screen.getByLabelText(/PayFast passphrase/), { target: { value: 'my phrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save online payment settings' }));
    await waitFor(() => expect(api.savePaymentSettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.savePaymentSettings).mock.calls[0]![0]).toEqual({
      enabled: true,
      sandbox: true,
      merchantId: '10000100',
      merchantKey: '46f0cd694581a',
      passphrase: 'my phrase',
    });
  });

  it('an already-saved key does not have to be typed again', async () => {
    const api = fakeApi({
      enabled: false,
      sandbox: true,
      merchantId: '1',
      hasKey: true,
      hasPassphrase: false,
    });
    mount(api);
    fireEvent.click(await screen.findByText(/^Online payments \(PayFast\)/));
    fireEvent.click(screen.getByLabelText('Let clients pay invoices online'));
    fireEvent.click(screen.getByRole('button', { name: 'Save online payment settings' }));
    await waitFor(() => expect(api.savePaymentSettings).toHaveBeenCalled());
    expect(vi.mocked(api.savePaymentSettings).mock.calls[0]![0]).toMatchObject({
      enabled: true,
      merchantKey: '',
    });
  });

  it('switching it off needs no keys', async () => {
    const api = fakeApi({
      enabled: true,
      sandbox: false,
      merchantId: '1',
      hasKey: true,
      hasPassphrase: false,
    });
    const say = mount(api);
    fireEvent.click(await screen.findByText(/^Online payments \(PayFast\)/));
    fireEvent.click(screen.getByLabelText('Let clients pay invoices online'));
    fireEvent.click(screen.getByRole('button', { name: 'Save online payment settings' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Online payment is switched off.'));
    expect(vi.mocked(api.savePaymentSettings).mock.calls[0]![0]).toMatchObject({ enabled: false });
  });
});

describe('the client paying online', () => {
  const SESSION = { user: { id: 'u1', email: 'dan@example.com' } } as unknown as Session;
  const overview = {
    email: 'dan@example.com',
    memberships: [
      {
        client_id: 'c1',
        client_name: 'Dan Dillon',
        trainer: {
          business_name: 'Alice Fitness',
          display_name: 'a',
          address: '',
          contact_email: '',
          contact_phone: '',
          information_officer_name: '',
          information_officer_email: '',
        },
        programmes: [],
        consents: [],
      },
    ],
  };
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    client_id: 'c1',
    number: 'AF-202612-001',
    period_start: month,
    issued_on: today,
    due_on: month,
    status: 'sent',
    vat_percent: 0,
    subtotal_cents: 180000,
    vat_cents: 0,
    total_cents: 180000,
    notes: '',
    paid_at: null,
    pay_online: true,
    trainer: {
      business_name: 'Alice Fitness',
      address: '',
      contact_email: '',
      contact_phone: '',
      bank_details: 'FNB 123456',
      payment_link: '',
      terms: '',
    },
    lines: [{ description: 'Sessions', quantity: 4, unit_cents: 45000, amount_cents: 180000 }],
    ...over,
  });
  async function open(rows: unknown[], invoke: (name: string, opts: unknown) => Promise<unknown>) {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: SESSION } }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      rpc: vi.fn(async (name: string) => ({
        data: name === 'portal_overview' ? overview : name === 'portal_invoices' ? rows : null,
        error: null,
      })),
      functions: { invoke: vi.fn(invoke) },
    } as unknown as SupabaseClient;
    render(<App client={client} pathname="/portal" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'My invoices' }));
    return client;
  }

  it('sees a pay button with the amount when the trainer takes online payment, and still has the EFT details', async () => {
    await open([row()], async () => ({ data: null, error: null }));
    expect(
      await screen.findByRole('button', { name: /^Pay R1.800,00 now by card or instant EFT$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/FNB 123456/)).toBeInTheDocument();
  });

  it('sees no pay button when online payment is off, or the invoice is already paid', async () => {
    await open(
      [
        row({ pay_online: false }),
        row({ id: 'inv-2', number: 'N-2', status: 'paid', paid_at: `${today}T10:00:00Z` }),
      ],
      async () => ({ data: null, error: null }),
    );
    await screen.findByText(/You owe/);
    expect(screen.queryByRole('button', { name: /now by card/ })).toBeNull();
  });

  it('pressing it asks the server for the signed form and posts exactly the returned fields to PayFast', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const client = await open([row()], async () => ({
      data: {
        url: 'https://sandbox.payfast.co.za/eng/process',
        fields: { merchant_id: '10000100', amount: '1800.00', signature: 'abc' },
      },
      error: null,
    }));
    fireEvent.click(await screen.findByRole('button', { name: /now by card/ }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(client.functions.invoke).toHaveBeenCalledWith('payfast-checkout', {
      body: { invoiceId: 'inv-1' },
    });
    const form = submit.mock.instances[0] as unknown as HTMLFormElement;
    expect(form.method).toBe('post');
    expect(form.action).toBe('https://sandbox.payfast.co.za/eng/process');
    expect(Object.fromEntries(new FormData(form) as unknown as Iterable<[string, string]>)).toEqual({
      merchant_id: '10000100',
      amount: '1800.00',
      signature: 'abc',
    });
    submit.mockRestore();
  });

  it('if the server cannot prepare it, the client is told to pay by EFT and nothing is posted', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    await open([row()], async () => ({ data: null, error: { message: 'boom' } }));
    fireEvent.click(await screen.findByRole('button', { name: /now by card/ }));
    expect(await screen.findByText(/Please pay by EFT instead/)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    submit.mockRestore();
  });

  it('coming back from PayFast shows a confirming message', async () => {
    window.history.pushState({}, '', '/portal?paid=AF-202612-001');
    await open([row()], async () => ({ data: null, error: null }));
    expect(
      await screen.findByText(/PayFast is confirming your payment for AF-202612-001/),
    ).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });
});
