-- PT Planner: the exercise library tab (Phase 12). A new migration: earlier ones are already applied.
-- Safe to run more than once.
--
-- An exercise can have a link to a demo video or page (the prototype had this). Only http and https links are allowed.
-- Everything else the Library tab does uses the tables and rules that already exist: a trainer adds, changes and
-- deletes their OWN exercises; the shared ones that came with the app can be read by everyone and linked to the
-- trainer's own machines, but not changed.

alter table public.exercises
  add column if not exists link text not null default '' check (char_length(link) <= 300 and (link = '' or link ~* '^https?://\S+$'));
