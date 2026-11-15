# PT Planner: project context for Claude Code

Read this file first in every session. The detailed documents are in `docs/`.

## What we are building

A web app for personal trainers (PTs) that replaces handwritten programme notes. It is one module of a larger
"personal trainer operating system" (onboarding, bookings, training and diet plans, invoicing, payments) that a
trainer and their clients both use. This repository starts with the **Programme and Zone Planner** module.

The first real user is a PT at Virgin Active Bedfordview (Johannesburg). The trainer works from a phone or laptop
on the gym floor. The gym's main equipment is Technogym and Eleiko. Time zone: Africa/Johannesburg.

## The prototype is the specification

`prototype/zone-planner-v11.html` is a finished, single-file demo (about 4,500 lines of vanilla JS, SVG and CSS).
Open it in a browser to see every behaviour. It runs standalone; saving does not work outside Claude, so state
resets on refresh. It is the source of truth for **what the product does**. It is NOT the architecture to copy:
rebuild it properly (see `docs/03-build-plan.md`) and keep the behaviour.

When the docs and the prototype disagree, the prototype wins; then update the docs.

Useful prototype function names to search for when porting logic: `zoneLoops` (union outline of joined zones),
`joinZones`, `splitPart`, `duplicateZone`, `fitEquipment`, `normLayout`, `layoutSnap` / `layoutFromSnap`,
`remapEid` / `planSwitch` / `doSwitch` (switching gyms), `snapObj` / `applySnap` (client link), `itemsFromSnap`,
`buildPdf`, `runTab`.

## Documents

- `docs/01-product-spec.md`: every feature, screen by screen, with the exact behaviours and rules.
- `docs/02-data-model.md`: entities, fields, relationships, the compact client-link format, suggested SQL tables.
- `docs/03-build-plan.md`: recommended stack, repo layout, phased build order with acceptance checks.
- `docs/04-decision-log.md`: the owner's requests in order, design decisions and why, known gaps and open questions.
- `docs/05-import-script.md`: how to import a gym from the prototype's Data-tab JSON (code in `packages/core/src/import-prototype.ts`, CLI in `scripts/import-prototype.ts`, sample file in `exports/`). Move these into the new repo as they are.
- `prototype/tests/`: the Playwright scenarios used to check the prototype. Reference for acceptance criteria only;
  they point at old file paths and a mocked storage API, so they will not run unchanged.

## Working rules

1. Plan before large changes. For each phase in `docs/03-build-plan.md`: restate the goal, list the files you will
   touch, build, run the tests, then summarise. Keep commits small and named by feature.
2. Behaviour parity first, redesign later. Match the prototype's behaviour and rules before improving them.
3. TypeScript strict mode. Validate everything that comes from the database, a share link or a JSON import
   (the prototype's `norm*` functions show the rules; use a schema library such as Zod).
4. Mobile first. The trainer uses this on a phone between sets: tap targets at least 44 px, no horizontal page scroll
   at 390 px wide, works in light and dark mode.
5. Every feature gets a test. Pure logic (geometry, remapping, route order, snapshot encode/decode) gets unit tests;
   screens get Playwright tests that mirror the scenarios in `prototype/tests/`.
6. Privacy: client records (contact details, notes, goals, emergency contact) are personal data under POPIA.
   Row-level security so a trainer sees only their own clients; a client sees only their own programmes.
   Trainer-private notes must never reach a client link or PDF.
7. No secrets in the repo. Use environment variables and a `.env.example`.
8. Ask the owner before deciding anything marked "Open question" in `docs/04-decision-log.md`.

## Glossary

- **Gym**: one location (name, branch, address) with its own saved layout and machine-to-exercise links.
- **Floor**: one level of a gym (ground floor, first floor), each with its own canvas size.
- **Zone**: a named area on a floor (Cardio, Free Weights). Can be a single rectangle or several joined rectangles.
- **Struct**: architectural item (stairs, lift, door, wall, column, toilets, balustrade, glass facade).
- **Equipment**: a machine or station placed in a zone. Types: cardio, machine, free weights, rig, open space.
- **Exercise**: library item (muscles, level, default sets/reps/rest, cue) linked to the machines that can do it.
- **Session**: the routine being built; ordered items, each tied to one machine.
- **Run**: a live workout from a session, timed per exercise, saved to history.
- **Programme**: a session snapshot assigned to a client. **Template**: a reusable snapshot.

## Repository layout

```
CLAUDE.md                     this file
README.md                     handoff package overview
docs/                         01 spec, 02 data model, 03 build plan, 04 decision log, 05 import script
prototype/                    FROZEN reference (zone-planner-v11.html + Playwright scenarios). Never edit.
apps/web/                     React + Vite + TypeScript app (shell only so far)
packages/core/                pure TypeScript: geometry, remap, route order, snapshot, Zod schemas, importer
scripts/                      CLI scripts (import-prototype.ts)
supabase/migrations/          SQL migrations (Phase 1)
e2e/                          Playwright tests
exports/                      gym JSON exported from the prototype (bedfordview-v11.json)
.claude/                      project agents and skills (see below)
Nicks tools/                  library of Nick Saraev's skills/templates; copy from here when a phase needs one
design-reference/             external DESIGN.md collection (gitignored, read-only)
```

Current status: **Phase 0 (scaffold) is done.** pnpm workspace, ESLint, Prettier, Vitest, Playwright (390 px and 1280 px projects) and CI are in place, and `apps/web` renders the app shell (header, mode switch, gym bar, seven tabs) using the prototype's tokens. Next is **Phase 1** (domain, Zod schemas, SQL migrations, Supabase auth and RLS). Phase 1 depends on the owner's answers to open questions 1 and 7 in `docs/04-decision-log.md` (hosting, POPIA); ask before building it.

## Commands (run from the repo root; needs Node 20+ and pnpm 12, `npm i -g pnpm`)

- `pnpm install` then `pnpm dev` (http://localhost:5173); `pnpm build`; `pnpm lint`; `pnpm format:check` (`pnpm format` to fix); `pnpm typecheck`
- `pnpm test` Vitest (core: 14 importer tests; web: shell tests); `pnpm e2e` Playwright (builds and previews the app on :4173; first time run `pnpm exec playwright install chromium`)
- Handoff files `packages/core/src/import-prototype*.ts` and `scripts/import-prototype.ts` are deliberately excluded from Prettier; ESLint ignores unused caught errors for them. The tsconfig does not use `noUncheckedIndexedAccess` because the tested importer predates it.
- `npx tsx scripts/import-prototype.ts --file exports/bedfordview-v11.json --trainer <id> --dry-run` (expect 14 zones, 41 machines)

## Claude Code tooling in this repo

Active in `.claude/`:

| Item | Use |
|---|---|
| agent `qa` | write and run tests for new logic before a phase is called done |
| agent `code-reviewer` | unbiased review of a diff; run before each PR |
| agent `research` | open-ended investigation (library choices, Supabase RLS patterns) without bloating context |
| skill `pt-ui-build` | build a screen, screenshot at 390 and 1280 px, compare with the prototype, fix, repeat |
| skill `literature-research` | PubMed search, for the exercise library and evidence-based programme content |

Nick's architecture rule: Claude decides, deterministic code executes. Put repeatable work in scripts or `packages/core`, and record lessons in the relevant SKILL.md.

### Which Nick tools to pull in per phase (copy from `Nicks tools/02-skills` or `03-backend-modal`)

| Phase | Tools |
|---|---|
| 0-4 | none needed beyond the active set |
| 5 Clients, programmes, sharing | `welcome-email` and `create-proposal` as patterns for client emails and documents; `generate-report` pattern for PDFs |
| 6-7 Layout editor, multi-gym | `pt-ui-build` loop; `qa` agent heavily |
| 8 Equipment catalogue | `scrape-leads` / Apify pattern only if catalogue data must be scraped; owner supplies content |
| 9 Platform modules | `03-backend-modal` (webhooks, cron) for reminders and payments; `gmail-inbox`, `gmail-label`, `onboarding-kickoff`, `modal-deploy`, `add-webhook` |

Not relevant here (do not activate): lead-gen, cold-email, Skool, YouTube and thumbnail skills. Each active skill's description loads into context, so only add one when its phase starts.

## Git
Work on short-lived branches named `phase-N-feature`, small commits named by feature. Ask the owner before force-pushing or deploying.
