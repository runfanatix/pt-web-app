import { useState } from 'react';
import { mailtoUrl, pdfFileName, routineText, whatsappUrl } from '@pt/core';
import type { PdfModel } from '../lib/pdf.ts';
import { savePdf } from '../lib/pdf.ts';
import { copyText } from '../lib/clipboard.ts';

interface Props {
  pdf: PdfModel;
  /** A link to include in the message ("See it on the gym plan"), if there is one. */
  link?: string;
  /** Starting values for the send-to fields (the client's saved number and email). */
  whatsapp?: string;
  email?: string;
}

/**
 * Send a programme to a client: copy the message, open WhatsApp or the mail app with it filled in, or save the PDF.
 * The number and address are for this send only; a client's saved details are changed in their profile.
 */
export function SendActions({ pdf, link, whatsapp = '', email = '' }: Props) {
  const [wa, setWa] = useState(whatsapp);
  const [mail, setMail] = useState(email);
  const [status, setStatus] = useState('');
  const text = routineText(pdf, link ? { link } : {});

  async function copy() {
    setStatus(
      (await copyText(text)) ? 'Message copied.' : 'Could not copy. Select the message and copy it by hand.',
    );
  }
  function save() {
    try {
      savePdf(pdf, pdfFileName(pdf, 'programme', new Date().toISOString().slice(0, 10)));
      setStatus(
        'PDF saved. Attach it in WhatsApp or your email app: the page cannot attach files to another app.',
      );
    } catch (err) {
      setStatus(`The PDF could not be made: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="stack">
      <div className="meta">
        <label>
          WhatsApp number
          <input
            type="tel"
            inputMode="tel"
            placeholder="e.g. 082 123 4567"
            value={wa}
            onChange={(e) => setWa(e.target.value)}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            inputMode="email"
            placeholder="name@example.com"
            value={mail}
            onChange={(e) => setMail(e.target.value)}
          />
        </label>
      </div>
      <div className="btnrow">
        <button type="button" className="btn primary" onClick={save}>
          1. Save PDF
        </button>
        <button type="button" className="btn" onClick={() => void copy()}>
          Copy message
        </button>
      </div>
      <div className="btnrow">
        <a className="btn" target="_blank" rel="noopener noreferrer" href={whatsappUrl(wa, text)}>
          2. Open WhatsApp
        </a>
        <a className="btn" target="_blank" rel="noopener noreferrer" href={mailtoUrl(mail, pdf, text)}>
          2. Open email
        </a>
      </div>
      <p className="sub">
        Step 1 saves the PDF. Step 2 opens WhatsApp or your email app with the message and the number or
        address filled in. Numbers starting with 0 are treated as South African (+27). If a button does
        nothing, use Copy message.
      </p>
      <p role="status" aria-live="polite" className="sub">
        {status}
      </p>
    </div>
  );
}
