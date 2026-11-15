import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { parseSharedProgramme, type SharedProgramme } from '@pt/core';

export interface ShareLink {
  token: string;
  /** ISO timestamps. */
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** What the share panel needs from the database; a seam so the UI can be tested without Supabase. */
export interface ShareApi {
  list(programmeId: string): Promise<ShareLink[]>;
  /** Makes a new link for a programme. `days` is how long it works, or null for no expiry. */
  create(programmeId: string, days: number | null): Promise<ShareLink>;
  /** Stops a link working, straight away. */
  revoke(token: string): Promise<void>;
}

const LinkRow = z.object({
  token: z.string(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
const toLink = (r: z.infer<typeof LinkRow>): ShareLink => ({
  token: r.token,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});
const COLUMNS = 'token, created_at, expires_at, revoked_at';

export function createShareApi(client: SupabaseClient): ShareApi {
  return {
    async list(programmeId) {
      const { data, error } = await client
        .from('share_links')
        .select(COLUMNS)
        .eq('programme_id', programmeId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return LinkRow.array()
        .parse(data ?? [])
        .map(toLink);
    },

    async create(programmeId, days) {
      const expires = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
      const { data, error } = await client
        .from('share_links')
        .insert({ programme_id: programmeId, expires_at: expires })
        .select(COLUMNS)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'The link was not created');
      return toLink(LinkRow.parse(data));
    },

    async revoke(token) {
      const { error } = await client
        .from('share_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token', token);
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * What a client's link shows. Calls the one database function a visitor who is not logged in may use; it returns the
 * programme and the gym plan and nothing private. Null means the link is wrong, revoked or expired.
 */
export async function fetchSharedProgramme(
  client: SupabaseClient,
  token: string,
): Promise<SharedProgramme | null> {
  const { data, error } = await client.rpc('get_shared_programme', { p_token: token });
  if (error) throw new Error(error.message);
  return parseSharedProgramme(data);
}

/** Is a link still working right now? */
export function linkStatus(l: ShareLink, now: Date = new Date()): 'active' | 'revoked' | 'expired' {
  if (l.revokedAt) return 'revoked';
  if (l.expiresAt && Date.parse(l.expiresAt) <= now.getTime()) return 'expired';
  return 'active';
}
