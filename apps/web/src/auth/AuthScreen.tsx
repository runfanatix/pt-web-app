import { useState, type FormEvent } from 'react';
import { PRIVACY_NOTICE_VERSION } from '@pt/core';
import { useAuth } from './AuthProvider.tsx';

type Mode = 'signin' | 'signup';

export function AuthScreen() {
  const { client } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const signup = mode === 'signup';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (signup && !accepted) return;
    setBusy(true);
    setMessage(null);
    try {
      if (signup) {
        // The database trigger turns this metadata into a consent record (POPIA) when the account is created.
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { display_name: name.trim(), privacy_notice_version: PRIVACY_NOTICE_VERSION } },
        });
        if (error) throw error;
        if (!data.session)
          setMessage({ kind: 'info', text: 'Check your email to confirm your account, then sign in.' });
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Something went wrong. Try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap auth-wrap">
      <p className="eyebrow">PT Planner</p>
      <h1>{signup ? 'Create your trainer account' : 'Sign in'}</h1>
      <form className="auth-form" onSubmit={onSubmit}>
        {signup && (
          <label>
            Your name
            <input
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {signup && (
          <label className="consent">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>
              I have read the privacy notice and agree to my personal information, and my clients&apos;
              information that I add, being processed by PT Planner as described in it.
            </span>
          </label>
        )}
        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${message.kind}`}>
            {message.text}
          </p>
        )}
        <button type="submit" className="btn primary big" disabled={busy || (signup && !accepted)}>
          {signup ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button
        type="button"
        className="btn link"
        onClick={() => {
          setMode(signup ? 'signin' : 'signup');
          setMessage(null);
        }}
      >
        {signup ? 'I already have an account' : 'Create a trainer account'}
      </button>
    </div>
  );
}
