import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the Supabase project URL and anon (public) key are set in `.env`. */
export const isConfigured = Boolean(url && anonKey);

/** Browser client. Uses only the anon key; row-level security is what protects the data. */
export const supabase: SupabaseClient | null = isConfigured ? createClient(url!, anonKey!) : null;
