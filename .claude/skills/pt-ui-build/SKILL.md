---
name: pt-ui-build
description: Build or restyle a PT Planner screen and verify it visually against the prototype with screenshots. Use when the user asks to build, port, redesign, or match a UI screen or phase of the web app.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# PT UI build + visual verify loop
Adapted from Nick Saraev's screenshot-compare workflow (Nicks tools/04-website-design).

## Steps
1. **Reference**: open `prototype/zone-planner-v11.html` to the matching screen and screenshot it (390 px and 1280 px, light and dark). Read the matching section of `docs/01-product-spec.md`.
2. **Build** in `apps/web` (React + Vite + TypeScript strict) using the prototype's colour tokens. Put pure logic in `packages/core`, not in components.
3. **Screenshot** the new screen at the same sizes and themes (Playwright or `npx puppeteer screenshot`).
4. **Compare** side by side: spacing, font size and weight, hex colours, alignment, radii, shadows, tap targets (>= 44 px), no horizontal scroll at 390 px. Be specific ("heading 32px, reference ~24px").
5. **Fix, re-screenshot.** At least 2 comparison rounds; stop within ~2-3 px or when the user says so.

## Rules
- Behaviour parity first: match the prototype, don't "improve" it. Changes go through `docs/04-decision-log.md` open questions.
- Never edit `prototype/` or `design-reference/`.
