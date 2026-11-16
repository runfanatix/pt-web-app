import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export interface PortalInvite {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  emailedAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
}
export interface PortalAccount {
  id: string;
  createdAt: string;
  revokedAt: string | null;
}

/** The trainer's side of the client portal: invite a client, see their access, switch it off. */
export interface InviteApi {
  status(clientId: string): Promise<{ invites: PortalInvite[]; accounts: PortalAccount[] }>;
  /** Makes an invite for this email. Returns its id. */
  create(clientId: string, email: string): Promise<string>;
  /** Emails the invitation (Resend, through an Edge Function). False when email is not set up or failed. */
  send(inviteId: string): Promise<boolean>;
  cancel(inviteId: string): Promise<void>;
  /** Switches a client's access off at once. */
  switchOff(accountId: string): Promise<void>;
}

const InviteRow = z.object({
  id: z.string(),
  email: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  emailed_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
const AccountRow = z.object({ id: z.string(), created_at: z.string(), revoked_at: z.string().nullable() });

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

export function createInviteApi(client: SupabaseClient, trainerId: string): InviteApi {
  return {
    async status(clientId) {
      const [inv, acc] = await Promise.all([
        client
          .from('client_invites')
          .select('id, email, created_at, expires_at, emailed_at, accepted_at, revoked_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false }),
        client
          .from('client_accounts')
          .select('id, created_at, revoked_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false }),
      ]);
      fail(inv.error);
      fail(acc.error);
      return {
        invites: InviteRow.array()
          .parse(inv.data ?? [])
          .map((r) => ({
            id: r.id,
            email: r.email,
            createdAt: r.created_at,
            expiresAt: r.expires_at,
            emailedAt: r.emailed_at,
            acceptedAt: r.accepted_at,
            revokedAt: r.revoked_at,
          })),
        accounts: AccountRow.array()
          .parse(acc.data ?? [])
          .map((r) => ({ id: r.id, createdAt: r.created_at, revokedAt: r.revoked_at })),
      };
    },
    async create(clientId, email) {
      const clean = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email address.');
      const { data, error } = await client
        .from('client_invites')
        .insert({ trainer_id: trainerId, client_id: clientId, email: clean })
        .select('id')
        .single();
      fail(error);
      return String((data as { id: string }).id);
    },
    async send(inviteId) {
      try {
        const { data, error } = await client.functions.invoke('send-portal-invite', { body: { inviteId } });
        return !error && (data as { sent?: boolean } | null)?.sent === true;
      } catch {
        return false;
      }
    },
    async cancel(inviteId) {
      const { error } = await client
        .from('client_invites')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', inviteId);
      fail(error);
    },
    async switchOff(accountId) {
      const { error } = await client
        .from('client_accounts')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', accountId);
      fail(error);
    },
  };
}
