import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  amountString,
  centsFromAmount,
  checkItn,
  checkoutForm,
  itnConfirmationBody,
  itnSignatureValid,
  md5,
  paramString,
  parseItn,
  phpUrlencode,
  processUrl,
  sign,
  validateUrl,
  type Fields,
} from '../../../supabase/functions/_shared/payfast.ts';

describe('md5', () => {
  it('matches the known answers', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });
  it('matches Node on 300 random strings of every length, including accents and emoji', () => {
    let s = 7;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const alphabet = 'abcXYZ019 &=%+é€😀\n';
    for (let i = 0; i < 300; i++) {
      const len = Math.floor(rnd() * 150);
      const str = Array.from({ length: len }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
      expect(md5(str)).toBe(createHash('md5').update(str, 'utf8').digest('hex'));
    }
  });
  it('is right at the block boundaries', () => {
    for (const n of [54, 55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      const str = 'x'.repeat(n);
      expect(md5(str)).toBe(createHash('md5').update(str).digest('hex'));
    }
  });
});

describe('url encoding and signing', () => {
  it('encodes like PHP urlencode', () => {
    expect(phpUrlencode('John Doe')).toBe('John+Doe');
    expect(phpUrlencode('a@b.co')).toBe('a%40b.co');
    expect(phpUrlencode("Hello (x)!*'~")).toBe('Hello+%28x%29%21%2A%27%7E');
    expect(phpUrlencode('https://x.co/p?a=1&b=2')).toBe('https%3A%2F%2Fx.co%2Fp%3Fa%3D1%26b%3D2');
    expect(phpUrlencode('a-b_c.d')).toBe('a-b_c.d');
  });
  it('the parameter string trims, skips empty values, and puts the passphrase last', () => {
    const f: Fields = [
      ['a', ' x y '],
      ['b', ''],
      ['c', '1&2'],
    ];
    expect(paramString(f)).toBe('a=x+y&c=1%262');
    expect(paramString(f, ' pass word ')).toBe('a=x+y&c=1%262&passphrase=pass+word');
    expect(sign(f, 'p')).toBe(createHash('md5').update('a=x+y&c=1%262&passphrase=p').digest('hex'));
  });
  it('amounts are two decimals and read back exactly', () => {
    expect(amountString(180000)).toBe('1800.00');
    expect(amountString(5)).toBe('0.05');
    expect(amountString(123456)).toBe('1234.56');
    expect(centsFromAmount('1800.00')).toBe(180000);
    expect(centsFromAmount('0.5')).toBe(50);
    expect(centsFromAmount('12')).toBe(1200);
    expect(centsFromAmount('1,800.00')).toBeNull();
    expect(centsFromAmount('-1')).toBeNull();
    expect(centsFromAmount('')).toBeNull();
  });
  it('the live and sandbox addresses', () => {
    expect(processUrl(false)).toBe('https://www.payfast.co.za/eng/process');
    expect(processUrl(true)).toBe('https://sandbox.payfast.co.za/eng/process');
    expect(validateUrl(true)).toBe('https://sandbox.payfast.co.za/eng/query/validate');
  });
});

describe('the payment form', () => {
  const input = {
    merchantId: '10000100',
    merchantKey: '46f0cd694581a',
    passphrase: 'my secret phrase',
    sandbox: true,
    returnUrl: 'https://app.example/portal?paid=INV-1',
    cancelUrl: 'https://app.example/portal',
    notifyUrl: 'https://x.supabase.co/functions/v1/payfast-notify',
    invoiceId: 'a1b2c3',
    totalCents: 180000,
    invoiceNumber: 'AF-202612-001',
    description: 'Training sessions, December 2026',
    clientName: 'Dan van der Merwe',
    clientEmail: 'dan@example.com',
  };
  it('has every field PayFast needs, split names, and the amount to two decimals', () => {
    const { url, fields } = checkoutForm(input);
    expect(url).toBe('https://sandbox.payfast.co.za/eng/process');
    expect(fields).toMatchObject({
      merchant_id: '10000100',
      merchant_key: '46f0cd694581a',
      m_payment_id: 'a1b2c3',
      amount: '1800.00',
      name_first: 'Dan',
      name_last: 'van der Merwe',
      email_address: 'dan@example.com',
      item_name: 'Invoice AF-202612-001',
    });
  });
  it('is signed over the fields in PayFast’s order with the passphrase, and the passphrase is not sent', () => {
    const { fields } = checkoutForm(input);
    const { signature, ...rest } = fields;
    const order = [
      'merchant_id',
      'merchant_key',
      'return_url',
      'cancel_url',
      'notify_url',
      'name_first',
      'name_last',
      'email_address',
      'm_payment_id',
      'amount',
      'item_name',
      'item_description',
    ];
    expect(Object.keys(rest)).toEqual(order);
    const str = order.map((k) => `${k}=${phpUrlencode(rest[k]!)}`).join('&') + '&passphrase=my+secret+phrase';
    expect(signature).toBe(createHash('md5').update(str).digest('hex'));
    expect(JSON.stringify(fields)).not.toContain('secret phrase');
  });
  it('a different passphrase gives a different signature, and an empty one is left out', () => {
    expect(checkoutForm({ ...input, passphrase: 'other' }).fields.signature).not.toBe(
      checkoutForm(input).fields.signature,
    );
    const none = checkoutForm({ ...input, passphrase: '' }).fields;
    const { signature, ...rest } = none;
    expect(signature).toBe(sign(Object.entries(rest) as Fields));
  });
  it('leaves out empty fields (a client with no email or a one-word name)', () => {
    const { fields } = checkoutForm({ ...input, clientEmail: '', clientName: 'Dan' });
    expect(fields).not.toHaveProperty('email_address');
    expect(fields).not.toHaveProperty('name_last');
  });
});

describe('the payment notification', () => {
  const passphrase = 'my secret phrase';
  function itn(over: Record<string, string> = {}, pass = passphrase): string {
    const f: Fields = Object.entries({
      m_payment_id: 'a1b2c3',
      pf_payment_id: '1089250',
      payment_status: 'COMPLETE',
      item_name: 'Invoice AF-202612-001',
      amount_gross: '1800.00',
      amount_fee: '-55.20',
      amount_net: '1744.80',
      name_first: 'Dan',
      email_address: 'dan@example.com',
      merchant_id: '10000100',
      ...over,
    });
    const body = f.map(([k, v]) => `${k}=${phpUrlencode(v)}`).join('&');
    return `${body}&signature=${sign(f, pass)}`;
  }
  it('a genuine, complete payment passes and gives the invoice, reference and amount', () => {
    const v = checkItn(parseItn(itn()), passphrase);
    expect(v).toEqual({
      ok: true,
      reason: '',
      invoiceId: 'a1b2c3',
      paymentRef: '1089250',
      amountCents: 180000,
    });
  });
  it('a changed amount, status or reference breaks the signature', () => {
    for (const [k, val] of [
      ['amount_gross', '1.00'],
      ['m_payment_id', 'other'],
      ['pf_payment_id', '9'],
    ]) {
      const tampered = itn().replace(new RegExp(`${k}=[^&]*`), `${k}=${val}`);
      expect(checkItn(parseItn(tampered), passphrase)).toMatchObject({
        ok: false,
        reason: 'The signature does not match.',
      });
    }
  });
  it('the wrong passphrase, or none, fails', () => {
    expect(itnSignatureValid(parseItn(itn()), 'wrong')).toBe(false);
    expect(itnSignatureValid(parseItn(itn({}, '')), passphrase)).toBe(false);
    expect(itnSignatureValid(parseItn('a=1'), passphrase)).toBe(false);
  });
  it('a payment that is not COMPLETE is not accepted, even with a valid signature', () => {
    const v = checkItn(parseItn(itn({ payment_status: 'CANCELLED' })), passphrase);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/CANCELLED/);
  });
  it('a bad amount or a missing reference is refused', () => {
    expect(checkItn(parseItn(itn({ amount_gross: 'abc' })), passphrase).ok).toBe(false);
    expect(checkItn(parseItn(itn({ m_payment_id: '' })), passphrase).ok).toBe(false);
  });
  it('reads the posted body in order, decoding + and %XX, and the confirmation body drops the signature', () => {
    const f = parseItn('b=2&a=x+y%40z&signature=abc&empty=');
    expect(f).toEqual([
      ['b', '2'],
      ['a', 'x y@z'],
      ['signature', 'abc'],
      ['empty', ''],
    ]);
    expect(itnConfirmationBody(f)).toBe('b=2&a=x+y%40z');
  });
  it('spaces and symbols in values still verify', () => {
    const v = checkItn(
      parseItn(itn({ item_name: 'Invoice (Dan & Co) 100%', name_first: 'Zoë' })),
      passphrase,
    );
    expect(v.ok).toBe(true);
  });
});
