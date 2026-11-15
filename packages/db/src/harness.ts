/**
 * Test harness: an in-process Postgres (PGlite) with the real migrations applied.
 * It stubs the pieces Supabase provides (auth schema, auth.uid(), anon/authenticated roles) so row-level security
 * can be tested without Docker or a Supabase project.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImportSink } from '@pt/core';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..', '..', '..');
export const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to authenticated, anon;
  grant usage on schema public to authenticated, anon, service_role;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  return db;
}

export interface TestUser {
  userId: string;
  trainerId: string;
  email: string;
}

/** Signs a user up the way Supabase does (row in auth.users); the trigger creates the trainer. */
export async function createUser(
  db: PGlite,
  email: string,
  meta: Record<string, unknown> = {},
): Promise<TestUser> {
  const u = await db.query<{ id: string }>(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
    [email, JSON.stringify(meta)],
  );
  const userId = u.rows[0]!.id;
  const t = await db.query<{ id: string }>('select id from public.trainers where user_id = $1', [userId]);
  return { userId, trainerId: t.rows[0]!.id, email };
}

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Runs `fn` as a signed-in user (role authenticated, auth.uid() = userId). Rolls back if `fn` throws. */
export async function asUser<R>(db: PGlite, userId: string, fn: (q: Query) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const q: Query = async <T>(sql: string, params?: unknown[]) => (await tx.query<T>(sql, params)).rows;
    return fn(q);
  });
}

/** Runs `fn` as an anonymous visitor (role anon, no user). */
export async function asAnon<R>(db: PGlite, fn: (q: Query) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    const q: Query = async <T>(sql: string, params?: unknown[]) => (await tx.query<T>(sql, params)).rows;
    return fn(q);
  });
}

/** Like asUser, but returns the thrown error message instead of throwing (and the transaction is rolled back). */
export async function failsAs(
  db: PGlite,
  userId: string,
  sql: string,
  params?: unknown[],
): Promise<string | null> {
  try {
    await asUser(db, userId, async (q) => {
      await q(sql, params);
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** ImportSink backed by PGlite, acting as the service role (the importer's real runtime identity bypasses RLS). */
export function pgliteSink(db: PGlite): ImportSink {
  return {
    async insert(table, rows) {
      for (const row of rows as Record<string, unknown>[]) {
        const cols = Object.keys(row);
        const sql = `insert into public.${table} (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`;
        await db.query(
          sql,
          cols.map((c) => row[c]),
        );
      }
    },
    async findExerciseIdsByName(trainerId) {
      const r = await db.query<{ id: string; name: string }>(
        'select id, name from public.exercises where trainer_id is null or trainer_id = $1',
        [trainerId],
      );
      const out: Record<string, string> = {};
      for (const row of r.rows) out[row.name.toLowerCase()] ??= row.id;
      return out;
    },
    async createExercises(trainerId, defs) {
      const ids: string[] = [];
      for (const d of defs) {
        const r = await db.query<{ id: string }>(
          'insert into public.exercises (trainer_id, name, muscles, level, sets, reps, rest, cue) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
          [trainerId, d.name, d.muscles, d.level, d.sets, d.reps, d.rest, d.cue],
        );
        ids.push(r.rows[0]!.id);
      }
      return ids;
    },
    async deleteWhere(table, column, value) {
      await db.query(`delete from public.${table} where ${column} = $1`, [value]);
    },
  };
}
