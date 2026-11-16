import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tokenFromPath } from '@pt/core';
import { AuthProvider, useAuth } from './auth/AuthProvider.tsx';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { useGyms } from './data/useGym.ts';
import { createGymsApi, type GymsApi } from './data/gymsApi.ts';
import { createCatalogueApi, type CatalogueApi } from './data/catalogueApi.ts';
import { createLayoutApi } from './data/layoutApi.ts';
import { createGymDataLoader } from './data/useLayout.ts';
import { createTemplateApi, fetchTrainerId, type TemplateApi } from './data/templates.ts';
import { createClientsApi, createProfileApi, type ClientsApi, type ProfileApi } from './data/clients.ts';
import { createHistoryApi, type HistoryApi } from './data/history.ts';
import { createShareApi } from './data/share.ts';
import { PublicProgramme } from './components/PublicProgramme.tsx';
import { Planner } from './Planner.tsx';
import { supabase as defaultClient } from './lib/supabase.ts';
import { currentPath, isPortalPath, portalLink } from './lib/links.ts';
import { PortalApp } from './portal/PortalApp.tsx';
import { createInviteApi, type InviteApi } from './data/invites.ts';

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
  const shareApi = useMemo(() => createShareApi(client), [client]);
  const layoutApi = useMemo(() => createLayoutApi(client), [client]);
  const [templates, setTemplates] = useState<TemplateApi | null>(null);
  const [history, setHistory] = useState<HistoryApi | null>(null);
  const [clientsApi, setClientsApi] = useState<ClientsApi | null>(null);
  const [profileApi, setProfileApi] = useState<ProfileApi | null>(null);
  const [gymsApi, setGymsApi] = useState<GymsApi | null>(null);
  const [catalogueApi, setCatalogueApi] = useState<CatalogueApi | null>(null);
  const [inviteApi, setInviteApi] = useState<InviteApi | null>(null);
  useEffect(() => {
    let active = true;
    fetchTrainerId(client).then(
      (id) => {
        if (!active) return;
        setTemplates(createTemplateApi(client, id));
        setHistory(createHistoryApi(client, id));
        setClientsApi(createClientsApi(client, id));
        setProfileApi(createProfileApi(client, id));
        setGymsApi(createGymsApi(client, id));
        setCatalogueApi(createCatalogueApi(client, id));
        setInviteApi(createInviteApi(client, id));
      },
      (err: unknown) => {
        if (!active) return;
        // A sign-in with no trainer account is a client: send them to their portal.
        if (err instanceof Error && err.message.startsWith('No trainer profile'))
          window.location.replace(portalLink());
        setTemplates(null);
        setHistory(null);
        setClientsApi(null);
        setProfileApi(null);
        setGymsApi(null);
        setCatalogueApi(null);
        setInviteApi(null);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);
  if (state.status === 'loading') return <Status>Loading your gyms…</Status>;
  if (state.status === 'error') return <Status>{`Could not load your gyms: ${state.message}`}</Status>;
  return (
    <Planner
      gyms={state.gyms}
      loadGym={loadGym}
      templates={templates}
      history={history}
      clientsApi={clientsApi}
      profileApi={profileApi}
      shareApi={shareApi}
      layoutApi={layoutApi}
      gymsApi={gymsApi}
      catalogueApi={catalogueApi}
      inviteApi={inviteApi}
      onGymsChanged={state.refresh}
      onSignOut={() => void signOut()}
    />
  );
}

function Gate() {
  const { session } = useAuth();
  if (session === undefined) return <Status>Loading…</Status>;
  return session ? <SignedIn /> : <AuthScreen />;
}

/**
 * /p/<token> is a client's link: it opens the programme with no sign-in. Everything else is the trainer's app.
 */
export function App({
  client = defaultClient,
  pathname = currentPath(),
}: {
  client?: SupabaseClient | null;
  pathname?: string;
}) {
  if (!client) return <SetupNotice />;
  const token = tokenFromPath(pathname);
  if (token) return <PublicProgramme client={client} token={token} />;
  if (isPortalPath(pathname))
    return (
      <AuthProvider client={client}>
        <PortalApp client={client} />
      </AuthProvider>
    );
  return (
    <AuthProvider client={client}>
      <Gate />
    </AuthProvider>
  );
}
