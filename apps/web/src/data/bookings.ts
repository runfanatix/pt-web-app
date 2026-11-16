import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BOOKINGS_SELECT,
  parseBookings,
  parsePortalBookings,
  type Booking,
  type BookingRowInput,
  type BookingStatus,
  type PortalBooking,
} from '@pt/core';

export interface BookingPatch {
  client_id?: string | null;
  gym_id?: string | null;
  title?: string;
  starts_at?: string;
  ends_at?: string;
  notes?: string;
  status?: BookingStatus;
  cancelled_by?: 'trainer' | 'client' | null;
  /** Resetting the client's answer when the time changes. */
  client_response?: 'pending' | 'confirmed' | 'declined';
}

/** What the Calendar tab needs from the database; a seam so the UI can be tested without Supabase. */
export interface BookingsApi {
  /** Sessions starting between two moments (inclusive start, exclusive end), soonest first. */
  list(fromIso: string, toIso: string): Promise<Booking[]>;
  create(rows: BookingRowInput[]): Promise<void>;
  update(id: string, patch: BookingPatch): Promise<void>;
  /** Cancels a repeating series from a moment on (the session at that moment included). */
  cancelSeriesFrom(seriesId: string, fromIso: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

export function createBookingsApi(client: SupabaseClient, trainerId: string): BookingsApi {
  return {
    async list(fromIso, toIso) {
      const { data, error } = await client
        .from('bookings')
        .select(BOOKINGS_SELECT)
        .gte('starts_at', fromIso)
        .lt('starts_at', toIso)
        .order('starts_at', { ascending: true });
      fail(error);
      return parseBookings(data ?? []);
    },
    async create(rows) {
      const { error } = await client
        .from('bookings')
        .insert(rows.map((r) => ({ ...r, trainer_id: trainerId })));
      fail(error);
    },
    async update(id, patch) {
      const { error } = await client.from('bookings').update(patch).eq('id', id);
      fail(error);
    },
    async cancelSeriesFrom(seriesId, fromIso) {
      const { error } = await client
        .from('bookings')
        .update({ status: 'cancelled', cancelled_by: 'trainer' })
        .eq('series_id', seriesId)
        .gte('starts_at', fromIso)
        .eq('status', 'scheduled');
      fail(error);
    },
    async remove(id) {
      const { error } = await client.from('bookings').delete().eq('id', id);
      fail(error);
    },
  };
}

/** The client's side: their own sessions, and their answer to each. */
export interface PortalBookingsApi {
  list(): Promise<PortalBooking[]>;
  respond(id: string, response: 'confirmed' | 'declined'): Promise<boolean>;
}

export function createPortalBookingsApi(client: SupabaseClient): PortalBookingsApi {
  return {
    async list() {
      const { data, error } = await client.rpc('portal_bookings');
      if (error) throw new Error(error.message);
      return parsePortalBookings(data);
    },
    async respond(id, response) {
      const { data, error } = await client.rpc('portal_respond_booking', {
        p_booking_id: id,
        p_response: response,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
  };
}

/** Saves text as a file in the browser (used for calendar files). */
export function downloadText(filename: string, text: string, type = 'text/calendar'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
