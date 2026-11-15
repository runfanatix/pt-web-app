import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from './auth/AuthProvider.tsx';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { useGyms } from './data/useGym.ts';
import { createGymDataLoader } from './data/useLayout.ts';
import { createTemplateApi, fetchTrainerId, type TemplateApi } from './data/templates.ts';
import { Planner } from './Planner.tsx';
import { supabase as defaultClient } from './lib/supabase.ts';

function SetupNotice() {
  return (
    <div className="wrap">
      <p className="eyebrow">PT Planner</p>
      <h1>Connect your database</h1>
      <p className="lede">
        Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and{' '}
        <code>VITE_SUPABASE_ANON_KEY</code>, then restart. Steps are in docs/06-supabase-setup.md.
      </p>
    </div>
  );
}

function Status({ children }: { children: string }) {
  return (
    <div className="wrap">
      <p className="hint" role="status">
        {children}
      </p>
    </div>
  );
}

function SignedIn() {
  const { client, signOut } = useAuth();
  const state = useGyms(client);
  const loadGym = useMemo(() => createGymDataLoader(client), [client]);
  const [templates, setTemplates] = useState<TemplateApi | null>(null);
  useEffect(() => {
    let active = true;
    fetchTrainerId(client).then(
      (id) => active && setTemplates(createTemplateApi(client, id)),
      () => active && setTemplates(null),
    );
    return () => {
      active = false;
    };
  }, [client]);
  if (state.status === 'loading') return <Status>Loading your gyms…</Status>;
  if (state.status === 'error') return <Status>{`Could not load your gyms: ${state.message}`}</Status>;
  return (
    <Planner gyms={state.gyms} loadGym={loadGym} templates={templates} onSignOut={() => void signOut()} />
  );
}

function Gate() {
  const { session } = useAuth();
  if (session === undefined) return <Status>Loading…</Status>;
  return session ? <SignedIn /> : <AuthScreen />;
}

export function App({ client = defaultClient }: { client?: SupabaseClient | null }) {
  if (!client) return <SetupNotice />;
  return (
    <AuthProvider client={client}>
      <Gate />
    </AuthProvider>
  );
}
