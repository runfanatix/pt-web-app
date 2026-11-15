# 07 Privacy and POPIA

A privacy notice and consent flow are required at launch (owner's decision). This file records what is built, what is
not, and what the owner must supply. It is engineering guidance, not legal advice: have the notice and the operator
terms reviewed by someone qualified in South African data-protection law before real clients use the app.

## What personal information the app holds

- Trainer: name, email.
- Client: name, contact details, emergency contact, goals, subscription details, private trainer notes.
- Health-related details written into goals or notes (injuries, conditions) are **special personal information**
  under POPIA and need explicit consent. Treat `goals` and `private_notes` as health data.
- Run history and programmes (what the client trains).

## Built in Phase 1

| Item | Where |
| --- | --- |
| Trainer cannot create an account without ticking the privacy notice | `apps/web/src/auth/AuthScreen.tsx` |
| Acceptance stored as a consent record with the notice version | trigger `handle_new_user`, table `consents` |
| Consent records cannot be deleted by trainers (kept as evidence), only withdrawn | RLS and grants in the RLS migration |
| A trainer sees only their own clients; a client record never reaches another trainer | RLS, tested in `packages/db/src/rls.test.ts` |
| Anonymous visitors can read nothing | RLS and revoked grants, tested |
| Private notes and contact details are excluded from the public client view | `publicClientView` in `packages/core/src/schemas.ts`, tested |
| Erasing a client or trainer removes their rows | `ON DELETE CASCADE` down the ownership chain |
| Notice version constant | `PRIVACY_NOTICE_VERSION` (currently `v0-draft`) in `packages/core/src/index.ts` |

## Still to build

1. **Client consent flow (Phase 5)**: when a trainer adds a client, record the client's consent (`consents` row with
   `subject = 'client'`), including explicit consent for health information, and show it on the client record.
2. **Withdrawal and erasure tools**: a trainer action to withdraw consent and to delete a client and all their data;
   a way to export a client's data on request (access right).
3. **Privacy notice page**: a route that renders the notice and is linked from the sign-up form. Bump
   `PRIVACY_NOTICE_VERSION` whenever the text changes, and ask existing users to accept the new version.
4. **Retention**: decide how long run history and ended clients are kept.

## Hosting outside South Africa

Supabase offers no African region, so client data will be stored in the EU (London or Frankfurt). This is allowed, but POPIA
section 72 conditions it. The usual routes, to be confirmed by your adviser:

1. The recipient is subject to a law, binding rules or an agreement that gives substantially similar protection. EU data
   protection law (GDPR) is the argument usually made, backed by the data processing agreement and standard contractual
   clauses that Supabase and Vercel offer; sign and keep them.
2. The data subject consents to the transfer. The sign-up and client consent wording should name the hosting country.
3. The transfer is necessary to perform the contract with the client.

Build choices that reduce the exposure: collect only what the product needs (no ID numbers, no medical records, keep health
detail to what the trainer needs), keep private notes free text the trainer controls, and keep the privacy notice honest
about where data is held. If a South African region is ever a hard requirement, the alternatives are self-hosting Supabase
on a South African server (AWS Cape Town, or a local host) at the cost of running it yourself, or asking Supabase whether a
region is planned.

## The owner must supply or decide

1. The privacy notice text and, for the trainer's clients, the client-facing consent wording. The checkbox text in
   `AuthScreen.tsx` is a placeholder.
2. Who is the responsible party for client data (normally the trainer or their business) and who is the operator
   (the app provider). This decides whose Information Officer registration and agreements apply.
3. Written operator agreements with Supabase and Vercel, and where data is stored. Supabase has no South African region, so name the EU region and the section 72 basis (see "Hosting outside South Africa").
4. Security safeguards and a breach procedure (notify the Information Regulator and affected people).
5. Do not store real client data in the free-tier project until the backup and hosting terms are acceptable.
