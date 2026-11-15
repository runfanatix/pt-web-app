# Nick's Tools – curated for the PT Operating System app

Source: the four folders from Nick Saraev's Google Drive download (`CLAUDE/drive-download-20261115T094122Z-1-001`). Originals are untouched; this is a copy of only what's useful. Secrets, node_modules, .venv, .git and video-frame assets were left out.

## 01-architecture
- `AGENTS.md` – Nick's 3-layer "Skills" architecture (SKILL.md + scripts, orchestration, shared utilities). Best template for your own project CLAUDE.md.
- `agents/` – reusable sub-agents: code-reviewer, qa (writes and runs tests), research, email-classifier.
- `.env.example`, `requirements.txt` – how he organises API keys and deps.

## 02-skills (each = SKILL.md + scripts)
| Skill | Use in the PT app |
|---|---|
| gmail-inbox, gmail-label | Client email triage (Action Required / Waiting On / Reference) |
| create-proposal | Generate PT package proposals/contracts for new clients |
| welcome-email, onboarding-kickoff | New-client onboarding automation (pattern is the valuable part) |
| generate-report | PDF report pipeline – adapt to weekly/monthly client progress reports |
| literature-research | PubMed search – evidence-based programme design and content |
| design-website | Mockup/landing site generation for your PT brand |
| gmaps-leads, scrape-leads, classify-leads, casualize-names | Local lead gen (gyms, corporate clients) and friendly personalisation |
| instantly-campaigns, instantly-autoreply | Cold outreach + auto replies (optional marketing) |
| video-edit | Cut silences from talking-head videos for social content |
| add-webhook, modal-deploy, local-server | Deploy and test backend endpoints (Modal + Cloudflare tunnel) |

## 03-backend-modal
- `CLAUDE.md` + `modal_app.py` – build Python API endpoints on Modal with Bearer-token auth and cURL output.
- `modal_webhook.py`, `webhooks.json`, `_template.py`, `cron_config.json`, `local_server.py` – webhook + cron scheduling (session reminders, check-in nudges, payment chasers).
- `trigger-dev-tools/` – Trigger.dev tasks and tool wrappers (gmail, sheets, slack, web) for background jobs.

## 04-website-design
- `CLAUDE.md`, `CLAUDE (Rules Based).md`, `rules/` – screenshot -> HTML -> compare -> fix loop with design rules. Great for matching your `design-reference` folder.
- `landing-page-example/` – Nick's agency site (static HTML + Netlify) as a landing page reference.

## 05-prompts
Pipeline-builder prompts (gmaps leads, Upwork, Instantly) – templates for how to prompt Claude to build a whole pipeline.

## Deliberately skipped
Skool monitor/RAG, YouTube outliers/title/thumbnail skills, Upwork apply, weather report data, Remotion 3D effects, shop-amazon, tell-me-the-time – not relevant to a PT app.

## Suggested adoption order
1. Merge `01-architecture/AGENTS.md` ideas into the PT app's CLAUDE.md.
2. Copy `04-website-design/rules` into `.claude/rules` for UI work.
3. Copy needed folders from `02-skills` into `.claude/skills` as you reach each feature.
4. Use `03-backend-modal` when you need server-side automation.
