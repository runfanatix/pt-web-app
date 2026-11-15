# 06 Supabase setup (free tier, for the working prototype)

The owner pays for hosting and uses free tiers until the app has paying customers. Free-tier limits change, so check
supabase.com/pricing before relying on a number. Known behaviour to plan around: free projects can be paused after a
period of inactivity (restore from the dashboard), and there is no automatic backup you control. Do not put real client
data in the free project until you have upgraded and checked the backup options (see `07-privacy-popia.md`).

> The owner has created the project in **West Europe (London)**. Step 1 is kept for reference.

## 1. Create the project

1. Sign in at supabase.com and create a new project.
2. **Region**: Supabase has no South African region (none in Africa). Pick the closest **EU** region on the list
   (London or Frankfurt; expect roughly 150 to 200 ms per request from Johannesburg). POPIA does not require data to stay
   in South Africa; it regulates transfers abroad (section 72). Record the region you chose and the basis for the transfer
   in the privacy notice; see `07-privacy-popia.md`, "Hosting outside South Africa". The region cannot be changed after the
   project is created (you would migrate to a new project), so decide before loading real data.
3. Save the database password in a password manager.

## 2. Create the tables and security rules

Either paste each file into the dashboard's SQL editor and run them **in this order**:

1. `supabase/migrations/20261115120000_init_schema.sql`
2. `supabase/migrations/20261115120100_rls.sql`

or use the CLI: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.

The migrations are tested against an in-process Postgres (`pnpm --filter @pt/db test`), including the row-level
security rules, but run them once against the real project and repeat the isolation check in step 6.

## 3. Auth settings

Authentication, Providers: keep Email enabled. For quick testing you may turn **Confirm email** off; turn it back on
before real users sign up. Set the Site URL to `http://localhost:5173` for now, and to the Vercel URL when you deploy.

## 4. Connect the app

Copy `.env.example` to `.env` in the repository root and fill in:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>        # Project settings, API
SUPABASE_URL=https://<ref>.supabase.co          # for the scripts
SUPABASE_SERVICE_ROLE_KEY=<service role key>    # scripts only; never prefix with VITE_, never commit
```

Run `pnpm dev`, open http://localhost:5173, and create a trainer account. Accepting the privacy notice is required
and is stored as a consent record.

## 5. Load the exercise library and your gym

1. Find your trainer id: SQL editor, `select id, display_name from trainers;`
2. Load the built-in exercise library (once; safe to re-run):
   `npx tsx scripts/seed-library.ts --file exports/bedfordview-v11.json`
3. Dry-run the import, then run it:
   `npx tsx scripts/import-prototype.ts --file exports/bedfordview-v11.json --trainer <trainer id> --include-session --dry-run`
   (expect 2 floors, 14 zones, 41 machines), then the same command without `--dry-run`.
4. The scripts read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment. In PowerShell:
   `$env:SUPABASE_URL='...'; $env:SUPABASE_SERVICE_ROLE_KEY='...'` before running them.

Reload the app: the header and gym bar now show the gym read from the database.

## 6. Check the isolation by hand

Create a second account (another email), sign in as it, and confirm it sees "No gym yet" and none of the first
trainer's data. The automated version of this check is `packages/db/src/rls.test.ts`.

## 7. Vercel (when you want it online)

Import the GitHub repository in Vercel, set the root directory to `apps/web`, build command `pnpm build`, output
directory `dist`, and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables. Never add the
service role key to Vercel. Add the Vercel URL to Supabase's Site URL and redirect URLs.
