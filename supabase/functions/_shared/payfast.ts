/**
 * PayFast (https://www.payfast.co.za) payments: building the signed payment form, and checking the Instant
 * Transaction Notification (ITN) PayFast sends when a payment happens. Plain TypeScript with no imports, so the Edge
 * Functions (Deno) and the unit tests (Node) both use it.
 *
 * PayFast signs with MD5 over the fields URL-encoded the way PHP's urlencode does, in a fixed order, with the
 * merchant's passphrase added at the end. The passphrase must never leave the server.
 */

/* ---------------------------------------------------------------- MD5 (Web Crypto has none) */

function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);
  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i]! + M[g]!) | 0;
      A = D;
      D = C;
      C = B;
      const s = S[(i >> 4) * 4 + (i % 4)]!;
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => odv.setInt32(i * 4, v, true));
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
}
export { md5 };

/* ---------------------------------------------------------------- encoding and signing */

/** PHP's urlencode: spaces become +, and everything except letters, digits and -_. is %XX (upper case). */
export function phpUrlencode(v: string): string {
  return encodeURIComponent(v)
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

export type Fields = [string, string][];

/** key=value&key=value with values trimmed and url-encoded, skipping empty ones, then the passphrase if there is one. */
export function paramString(fields: Fields, passphrase = ''): string {
  const parts = fields.filter(([, v]) => v.trim() !== '').map(([k, v]) => `${k}=${phpUrlencode(v.trim())}`);
  if (passphrase.trim() !== '') parts.push(`passphrase=${phpUrlencode(passphrase.trim())}`);
  return parts.join('&');
}
export const sign = (fields: Fields, passphrase = ''): string => md5(paramString(fields, passphrase));

export const payfastHost = (sandbox: boolean): string =>
  sandbox ? 'https://sandbox.payfast.co.za' : 'https://www.payfast.co.za';
export const processUrl = (sandbox: boolean): string => `${payfastHost(sandbox)}/eng/process`;
export const validateUrl = (sandbox: boolean): string => `${payfastHost(sandbox)}/eng/query/validate`;

/** 180000 -> "1800.00" */
export const amountString = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
/** "1800.00" -> 180000, or null when it is not an amount. */
export function centsFromAmount(a: string): number | null {
  const t = a.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export interface CheckoutInput {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  sandbox: boolean;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  /** Our invoice id: PayFast hands it back in the notification. */
  invoiceId: string;
  totalCents: number;
  invoiceNumber: string;
  description: string;
  clientName: string;
  clientEmail: string;
}

/** The signed form a browser posts to PayFast. The fields are in PayFast's required order. */
export function checkoutForm(i: CheckoutInput): { url: string; fields: Record<string, string> } {
  const [first, ...rest] = i.clientName.trim().split(/\s+/);
  const ordered: Fields = [
    ['merchant_id', i.merchantId],
    ['merchant_key', i.merchantKey],
    ['return_url', i.returnUrl],
    ['cancel_url', i.cancelUrl],
    ['notify_url', i.notifyUrl],
    ['name_first', (first ?? '').slice(0, 100)],
    ['name_last', rest.join(' ').slice(0, 100)],
    ['email_address', i.clientEmail.slice(0, 100)],
    ['m_payment_id', i.invoiceId],
    ['amount', amountString(i.totalCents)],
    ['item_name', `Invoice ${i.invoiceNumber}`.slice(0, 100)],
    ['item_description', i.description.slice(0, 255)],
  ];
  const fields: Record<string, string> = {};
  for (const [k, v] of ordered) if (v.trim() !== '') fields[k] = v.trim();
  fields.signature = sign(ordered, i.passphrase);
  return { url: processUrl(i.sandbox), fields };
}

/* ---------------------------------------------------------------- the payment notification (ITN) */

/** The posted body as fields, in the order PayFast sent them. */
export function parseItn(body: string): Fields {
  return body
    .split('&')
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=');
      const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
      return (i < 0 ? [dec(p), ''] : [dec(p.slice(0, i)), dec(p.slice(i + 1))]) as [string, string];
    });
}

/** Whether the notification's signature matches what we work out from its fields and the passphrase. */
export function itnSignatureValid(fields: Fields, passphrase: string): boolean {
  const given = fields.find(([k]) => k === 'signature')?.[1] ?? '';
  const rest = fields.filter(([k]) => k !== 'signature');
  return given !== '' && given.toLowerCase() === sign(rest, passphrase);
}

/** The text sent back to PayFast to confirm the notification really came from them (no passphrase). */
export const itnConfirmationBody = (fields: Fields): string =>
  paramString(fields.filter(([k]) => k !== 'signature'));

export interface ItnVerdict {
  ok: boolean;
  reason: string;
  invoiceId: string;
  paymentRef: string;
  amountCents: number;
}

/**
 * Everything that can be checked without asking PayFast: the signature, that the payment is COMPLETE, and that the
 * amount is a valid amount. (The caller then compares the amount with the invoice and asks PayFast to confirm.)
 */
export function checkItn(fields: Fields, passphrase: string): ItnVerdict {
  const get = (k: string) => fields.find(([f]) => f === k)?.[1] ?? '';
  const bad = (reason: string): ItnVerdict => ({
    ok: false,
    reason,
    invoiceId: get('m_payment_id'),
    paymentRef: get('pf_payment_id'),
    amountCents: 0,
  });
  if (!itnSignatureValid(fields, passphrase)) return bad('The signature does not match.');
  if (get('payment_status') !== 'COMPLETE')
    return bad(`The payment status is ${get('payment_status') || 'missing'}, not COMPLETE.`);
  const cents = centsFromAmount(get('amount_gross'));
  if (cents === null) return bad('The amount is not valid.');
  if (!get('m_payment_id') || !get('pf_payment_id')) return bad('The payment has no reference.');
  return {
    ok: true,
    reason: '',
    invoiceId: get('m_payment_id'),
    paymentRef: get('pf_payment_id'),
    amountCents: cents,
  };
}
