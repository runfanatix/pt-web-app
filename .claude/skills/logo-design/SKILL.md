---
name: logo-design
description: Brendan's logo process - design restrained, real-looking logos for a brand (made-up showcase brands or a real one) by running one tight brief through OpenAI GPT Image 2.5 directly, guided by four reference logos, as refined white stacked lockups (mostly letter marks) on flat, gradient or relevant photo backgrounds, exploring 12 different directions per run then refining the one Brendan picks, and laying every option out on a Claude Design canvas as brand cards. Use when Brendan asks for logos, a logo batch, "another batch", brand cards, or to add logos to the Logo Lab canvas.
---

# Logo design (GPT Image 2.5, Design canvas)

Built over five rounds on 2026-10-20 to 2026-10-23 across five Higgsfield models, where GPT Image 2.5
was the most consistent winner. Moved to GPT Image 2.5 on Brendan's own OpenAI key, with Higgsfield
dropped, on 2026-11-04. Every rule below exists because breaking it produced logos Brendan called slop.
The earlier five-model rounds live on the **Higgsfield Logo Lab** canvas
(https://claude.ai/artifact/VF7dZb86dyKaNQzBf5rWXD) and in `designs/higgsfield-logo-lab-2026-10-23/`.

## The taste (non-negotiable)

- **Restrained.** One simple symbol with one idea, plus a clean wordmark. Two colours max.
- **Never:** badges, mascots, tattoo flash, neon signs, retro emblems, busy illustration, gradients
  in the logo itself, 3D, mockups.
- **Letters stay readable.** Put the idea *inside* a letter (a soundhole O, a box in the p, a
  ball-seam C). Never ask for a letter to be *replaced* by a shape: "the N becomes a ridge" made
  three models drop the N.
- **No em dashes** anywhere in prompts, boards or replies.

## The look (from the four references)

`references/` holds four logos Brendan picked as the target: **fieldnote** (white F with one corner cut
like a folded page, over a lowercase wordmark, on vivid blue), **lune** (white crescent over a serif
wordmark on a grainy lilac-to-midnight gradient), **atlasline** (white A with one swooping cut, over
spaced capitals, on a navy-to-dusk sky gradient) and **courtside** (white C with a ball-seam curve inside
it, over bold capitals, on a flat clay court). What they share, and what every output must have:

- **Three of the four symbols are the brand's own initial**, refined with ONE subtle cut, fold or curve
  that carries the idea. The fourth is one very simple iconic shape. None is a drawn object.
- The logo is **flat white** (or one light flat colour) so it reads on any background.
- **Symbol stacked above the wordmark**, centred, small enough that there is lots of empty space all
  round. The symbol is never wider than the wordmark.
- Precise geometry: smooth curves, crisp cuts, even stroke weights, nothing blocky.
- The wordmark is clean and set in one weight, mostly regular or medium.

`generate.mjs` sends all four with every call (`/v1/images/edits`, as `image[]`), and the template tells
the model to match their style without copying their names, symbols, colours or backgrounds. They add
about $0.025 per image. Look at them before planning a run.

## Symbols: what never to generate

Tryvale round 2 (2026-11-04) was called "terrible": an hourglass, a dashboard gauge, a maze and a
T made of stacked blocks, each drawn huge over heavy capitals. Every rule here comes from that round or
an earlier rejection.

- **At least 8 of the 12 directions in an explore run are letter marks**: the brand's initial (or a
  two-letter monogram) with one subtle cut, fold, notch, curve or negative-space shape carrying the
  idea, the way fieldnote, atlasline and courtside work. Describe the exact cut: "the top right corner
  of the F cut off at 45 degrees like a folded page".
- The rest are **single abstract shapes** or **one iconic shape at crescent-level simplicity**. A
  symbol you could find in a free icon set is not a logo.
- **Banned symbols** (clip art, or rejected already): gauges, dials, speedometers, hourglasses,
  stopwatches, clocks, balance scales, toggles and switches, mazes, bar charts and signal bars, ticks
  and checkmarks, flags and stakes, pencils, notepads, magnifying glasses, targets, trophies, brains,
  robots, circuit patterns, chat bubbles, sparkles, lightning bolts, shields, gears, rockets, globes,
  lightbulbs, map pins, eyes. Also watch for marks that turn into UI icons by accident: a ring with a
  line through a gap becomes a power button, a ring with a notch becomes refresh or sync, a half-filled
  circle is the contrast icon (Ondra, 2026-11-04).
- **Never blocky**: no letters or shapes built from stacked rectangles, steps or pixels (the stacked
  T looked like a game piece). No overlapping-squares marks: too common to own.
- **Never oversized**: the symbol stays narrower than the wordmark. Never pair a heavy symbol with a
  heavy black-weight wordmark.
- **One idea per mark.** If the description needs "and", cut it down.

## Backgrounds: flat colour, gradient or relevant photo

Every direction sets `background_kind` to `"flat"`, `"gradient"` or `"photo"`; `generate.mjs` rejects
anything else. Use all three across a run. **No plain textures** (kraft, wood grain, concrete, paper,
dot grid).

- **Flat:** one solid colour with a hex, like fieldnote's blue. Pick colours that suit the brand and
  are not the default tech blue every time: deep green, burnt orange, plum, ink, mustard, oxblood.
- **Gradient: from the edges, never from the middle.** A straight gradient that runs from one side or
  edge of the frame to the opposite one: top to bottom, bottom to top, left to right, or corner to
  corner, like atlasline's sky and lune's lilac-to-midnight. Name the colours and the direction ("from
  deep navy at the top to warm orange at the bottom"). **Never** a radial glow, a spotlight, a bright
  centre, a vignette or anything "brighter in the middle": the glow sits right behind the logo and fights
  it (Mettlework's electric green, 2026-11-04, rejected for exactly this). No aurora or light-streak
  effects either.
- **Photo: simple enough to work as a background colour.** The courtside clay court is the model: one
  dominant colour fills most of the frame, a few simple lines or shapes, flat even light, shot straight
  down so there is no depth. The photo frames the logo; it is never the subject. **Never** a realistic
  scene with depth, perspective, detail, light sources or strong contrast (Mettlework's wind tunnel,
  2026-11-04, rejected as too realistic and distracting). Write it as "a simple, flat, top-down photo of
  [a surface] where [one colour] fills most of the frame, a few [simple lines or shapes], even soft light,
  no depth, low detail". Exclude real landmarks by name.
- **At most ONE photo direction per brand per run.** `generate.mjs` rejects a brand with two or more
  (Brendan, 2026-11-04).
- **The photo's subject comes from the brand's own world, never from the references.** Copy courtside's
  *flatness*, not its subject. Ask: what does this business make, handle or look at, and where do its
  customers work? Pick a flat surface from there: a matte circuit board for AI or hardware software,
  roasted beans for a coffee roaster, a still pool for a swim school, a field of crops for a farm tool,
  fresh concrete for a builder. **No sports courts, pitches, tracks or gym floors unless the brand is
  about sport**, and no generic painted floors standing in for a theme (Tryvale round 1, 2026-11-04).

## The template (word for word)

> Full-bleed portrait brand image for "[Name]", a [business]. A refined, minimal [logo type]:
> [description]. The logo is [colour], with precise geometry, smooth curves and crisp cuts, nothing
> blocky. The symbol is modest in size and no wider than the wordmark, the whole logo about half the
> width of the frame with generous empty space all around it, centred on [background]. Clean modern
> branding presentation, the background fills the whole frame, no mockup, no other text. The attached
> images are style references only: match their refined flat logo, modest symbol size, centred layout
> and how simple the background is, but do not copy their names, symbols, colours or background
> subjects: the background must be exactly the one described above.

Size `1536x2048` (3:4). **Never use the word "card"** in the prompt: image models draw a physical
card on a grey table when they see it.

## Planning a run

Everything runs on **OpenAI GPT Image 2.5** (`gpt-image-2.5-sunburst`) on Brendan's own key, called
directly. No Higgsfield. Two kinds of run:

- **Explore (the default for a new brand): 12 completely different directions, 1 image each**
  (`"rolls": 1`). Brendan's call, 2026-11-04: rolls of the same idea waste slots before he has seen
  enough ideas. Twelve directions means twelve different symbols, not one symbol twelve ways.
- **Refine (after he picks one):** variations of that one direction only, e.g. 6 to 12 images that
  vary the cut, the wordmark style, the colour or the background, or rolls of the same prompt.
  Inverted versions (a dark or coloured logo on a light or bright background) are welcome here.
  **Pin every shape that must not drift** in each description, e.g. "the o stays a perfectly round
  circle": in the Ondra on-monogram run, 5 of 12 flattened the o and the mark read as an (2026-11-04).

Write `<workdir>/batch.json` (format in the header of `scripts/generate.mjs`). Each direction is a logo
type, the description, logo colour, `background_kind` and background. In an explore run:

- **Symbols:** at least 8 letter marks, the rest single abstract or iconic shapes (see Symbols above).
- **Wordmarks:** spread the four reference styles evenly, about 3 each: clean lowercase geometric sans
  (fieldnote), elegant high-contrast serif (lune), widely spaced thin capitals (atlasline), bold
  capitals in a medium-bold weight (courtside). Same-font runs look like one logo (Stakeline, 2026-11-04).
- **Backgrounds:** about 5 flat, 6 gradients, 1 photo, each in a different colour family.
- **Fresh names only.** Check the used list at the bottom, pick names that are not obviously real
  companies, and for anything going in a sponsored video, web-search the name before using it.

## Model (exact params)

`gpt-image-2.5-sunburst` through `/v1/images/edits` with the four references, `quality: "high"`,
`output_format: "jpeg"`, `1536x2048` (3:4). Any size works up to 3840x2160 but **both sides must be
multiples of 16**. About $0.09 and 25 to 35 s per high-quality image (about $0.067 of output plus the
references); `--quality low` (~$0.034) is for testing prompts only. `generate.mjs` logs the real cost
from the API's token usage to `usage.jsonl`.

## Running it

1. Write `<workdir>/batch.json`. Work in `designs/logo-lab-<date>/<slug>/`.
2. `node <skill-dir>/scripts/generate.mjs <workdir>` renders everything, 4 at a time, into
   `up/<idx>.jpg` with `manifest.json` (idx order: brand, then direction, then roll).
   Re-roll single images with `--only 3,7`.
3. Review grid: `node <skill-dir>/scripts/contact-sheet.mjs <workdir>` then Read `<workdir>/sheet.png`
   (six to a row, labelled `idx dN rN`).
4. Check every image against the Symbols rules before showing it: banned symbol, blocky, oversized,
   heavy-on-heavy, misspelled. Re-roll offenders with `--only` instead of putting them on the board.
   Then pick one. Judge in this order: spelling and every letter present; the idea reads at a glance;
   restraint and refinement; background serves the logo.
5. Upload `up/*.jpg` as canvas assets, at most 25 per `publish` call with `asset: true`.
6. Canvas (follow the Design type rules; never verify by rendering unless asked):
   - `read` `project/canvas.json` first, keep everything Brendan changed, append only.
   - One board per run, 2600 px wide: a header (brand, product, what this run changed), then the
     cards in a grid, four per row for an explore run of 12 (about 3600 px tall). Each card: the
     image, a number and short direction name, one honest caption. The pick gets
     `outline: 3px solid #141414; outline-offset: 5px` and " · pick". New runs go to the right of the
     last board (x + 2680).
7. Report: what changed this run, the pick and a few runners-up, real cost from `usage.jsonl`, folder
   link. Add any new lesson to this file.
8. **Once Brendan picks THE logo, vectorize it** so it can be reused anywhere at full quality:
   `python <skill-dir>/scripts/vectorize.py <workdir>/up/<idx>.jpg <workdir>/final --brand "#HEX" --ink "#HEX" --name <slug>`
   It samples the background from the image border (use that sampled hex as the brand colour, it is
   what he saw), traces the logo at 2x with vtracer into smooth paths, splits it at the widest empty
   band into the full logo, the mark and the wordmark, and writes each as black, white and brand-colour
   SVGs with tight viewBoxes and no background, plus `preview.html`. Screenshot the preview and look
   at it before using the files (counters of o, a, d must be real holes). The SVGs are the masters for
   the brand kit, the website and everything after: never place the JPEG again once they exist. The
   trace is faithful, so it keeps any flaw in the picked image; fix a flaw by re-rolling the image,
   not by editing paths. Needs `pip install vtracer` (installed on the PC 2026-11-04).

## Known quirks

- The images endpoint sends no rate-limit headers; `generate.mjs` backs off on 429/5xx itself.
- GPT Image tends to drop real landmarks into generic place prompts; exclude them by name.
- To recolour a chosen logo without changing its shape, edit the picked image (`/v1/images/edits`
  with "keep this exact logo, change ONLY the colours to X") instead of regenerating it.

## Names already used (do not reuse)

Fernlight, Hearthly, Pebblepath, Brightloaf, Kitebird, Quillstone, Lumacart, Rootwise, Northbeam,
Honeyhaus, Echofield, Sprintly, Yonder, Ironclad, Grubtown, Marlowe, Orbit Analytics, Saltmarsh,
Kiln Coffee, Peakform, Bloomwell, Nomad Ridge, Quanta, Pip & Pour, Fieldnote, Atlasline, Thicket,
Tonewood, Kindred, Voltra, Lune, Halden, Brinewell, Pixelpost, Marigold, Overlap, Courtside,
Cinder, Glasshouse, Parcel, Nightjar. Also the 45 slop-round brands (Voltaic, Northpaw, Tidewell,
Hexforge, Moss Lane, Brightfin, Quarry & Co, Juniper Post, Velora, Ember & Oak, Starlite, Grit &
Gild, Solenne, Pixel Pantry, Arcwave, Orbital Fern, Ledgerly, Bramble Books, Cobalt Crag, Saltbox,
Kiko Ramen, Halcyon, Rustbelt, Atlas Freight, Wildroot, Monarch Motors, Polar Byte, Sable Studio,
Lotus & Lime, Gridline, Peak Pass, Honeycomb Dental, Riot, Thunderhead, Neon Koi, Blacksmith,
Sprout, Copperline, Drift, Maple & Moon). Also Ferrowick, Hushloom, Swimlet, Orchardine (with vs
without test, 2026-10-27). Also Stakeline (Claude Design course brand, 2026-11-04; Fieldnote, Joistly and SiteJot were checked and rejected as real or used). Also Mettlework (AI agent testing software, 2026-11-04; Assaya, Vettly, Benchwright, Trialhouse, Gauntly and Provlo were all taken). Also Tryvale (same product, renamed 2026-11-04; Keelson, Gradewell, Anvilry, Tessel, Truelap, Proofwell, Pacemark, Kilnworth, Proctorly, TrialBy and Ordela were all taken). Also Ondra (same product, renamed again 2026-11-04 for the first 12-direction explore run with the letter-mark rules, which came out far more refined; Provane, Vettra and Calvio were taken or unclear). Append new names here after each batch.
