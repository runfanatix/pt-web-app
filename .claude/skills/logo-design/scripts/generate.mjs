#!/usr/bin/env node
// generate.mjs <workdir> [--only <idx,idx>] [--quality low]
//
// Reads <workdir>/batch.json, builds every prompt from the SKILL.md template word for word,
// and renders each one with OpenAI GPT Image 2.5 directly (no Higgsfield), sending the four
// images in references/ along as style references on every call. Writes <workdir>/up/<idx>.jpg,
// <workdir>/manifest.json (idx -> brand, direction, roll, prompt) and appends cost to
// <workdir>/usage.jsonl. --only re-rolls just those indices.
//
// batch.json:
// { "rolls": 3, "quality": "high",
//   "brands": [ { "name": "Kestrel", "business": "specialty coffee roaster",
//     "directions": [
//       { "logo_type": "symbol stacked above the wordmark", "description": "...",
//         "logo_colours": "flat white (#FFFFFF)",
//         "background_kind": "gradient",
//         "background": "a soft grainy gradient from roasted brown at the bottom to warm amber at the top" },
//       { ..., "background_kind": "photo", "background": "an overhead photo of freshly roasted coffee beans" }
//     ] } ] }
// background_kind must be "flat", "gradient" or "photo" (at most one photo per brand); anything else
// is rejected. An explore run is 12 directions with "rolls": 1.
// A direction may carry "prompt" to bypass the template.
//
// Zero dependencies (Node 20+). Key from OPENAI_API_KEY or reel-thumbnails/.env. Retries 429/5xx.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = path.resolve(SKILL, '..', '..', '..')
const MODEL = 'gpt-image-2.5-sunburst'
const PRICE = { textIn: 5, imageIn: 8, out: 30 } // USD per 1M tokens
const SIZE = '1536x2048' // 3:4; both sides must be multiples of 16
const PARALLEL = 4
const REFS = ['fieldnote', 'lune', 'atlasline', 'courtside'].map(n => path.join(SKILL, 'references', `${n}.png`))

const argv = process.argv.slice(2)
const work = path.resolve(argv[0] || '')
const flag = n => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : undefined }
if (!argv[0] || !fs.existsSync(path.join(work, 'batch.json'))) {
  console.error('usage: node generate.mjs <workdir> [--only 0,3] [--quality low]   (needs <workdir>/batch.json)')
  process.exit(2)
}

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim()
  for (const f of [path.join(PROJECT, 'reel-thumbnails', '.env'), path.join(PROJECT, '.env')]) {
    const m = fs.existsSync(f) && fs.readFileSync(f, 'utf8').match(/^OPENAI_API_KEY=(.*)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  throw new Error('OPENAI_API_KEY not found')
}

// The template from SKILL.md, word for word. Never add the word "card".
function prompt(b, d) {
  if (d.prompt) return d.prompt
  if (!['flat', 'gradient', 'photo'].includes(d.background_kind)) {
    throw new Error(`${b.name}: background_kind must be "flat", "gradient" or "photo", got "${d.background_kind}"`)
  }
  return `Full-bleed portrait brand image for "${b.name}", a ${b.business}. A refined, minimal ${d.logo_type}: ${d.description}. The logo is ${d.logo_colours}, with precise geometry, smooth curves and crisp cuts, nothing blocky. The symbol is modest in size and no wider than the wordmark, the whole logo about half the width of the frame with generous empty space all around it, centred on ${d.background}. Clean modern branding presentation, the background fills the whole frame, no mockup, no other text. The attached images are style references only: match their refined flat logo, modest symbol size, centred layout and how simple the background is, but do not copy their names, symbols, colours or background subjects: the background must be exactly the one described above.`
}

// One photo direction per brand at most; the rest are gradients (SKILL.md, Backgrounds).
function checkPhotos(b) {
  const photos = b.directions.filter(d => d.background_kind === 'photo').length
  if (photos > 1) throw new Error(`${b.name}: ${photos} photo directions, the limit is 1 per brand (make the others gradients)`)
}

const batch = JSON.parse(fs.readFileSync(path.join(work, 'batch.json'), 'utf8'))
const quality = flag('quality') || batch.quality || 'high'
const rolls = batch.rolls || 2
const jobs = []
batch.brands.forEach(checkPhotos)
batch.brands.forEach((b, bi) => b.directions.forEach((d, di) => {
  for (let r = 0; r < rolls; r++) jobs.push({ idx: jobs.length, brand: b.name, bi, di, roll: r, prompt: prompt(b, d) })
}))
const only = flag('only')?.split(',').map(Number)
const todo = only ? jobs.filter(j => only.includes(j.idx)) : jobs

fs.mkdirSync(path.join(work, 'up'), { recursive: true })
fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify({ model: MODEL, size: SIZE, quality, rolls, refs: REFS.map(r => path.basename(r)), jobs }, null, 2))

const key = apiKey()
const refBlobs = REFS.map(r => [new Blob([fs.readFileSync(r)], { type: 'image/png' }), path.basename(r)])
let spent = 0, failed = []
async function run(j) {
  const t0 = Date.now()
  for (let attempt = 1; attempt <= 6; attempt++) {
    const fd = new FormData()
    fd.append('model', MODEL); fd.append('prompt', j.prompt); fd.append('size', SIZE); fd.append('quality', quality)
    fd.append('output_format', 'jpeg'); fd.append('output_compression', '88')
    for (const [blob, name] of refBlobs) fd.append('image[]', blob, name)
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.data?.[0]?.b64_json) {
      fs.writeFileSync(path.join(work, 'up', `${j.idx}.jpg`), Buffer.from(json.data[0].b64_json, 'base64'))
      const u = json.usage || {}, d = u.input_tokens_details || {}
      const cost = ((d.text_tokens ?? 0) * PRICE.textIn + (d.image_tokens ?? 0) * PRICE.imageIn + (u.output_tokens ?? 0) * PRICE.out) / 1e6
      spent += cost
      fs.appendFileSync(path.join(work, 'usage.jsonl'), JSON.stringify({ ts: new Date().toISOString(), idx: j.idx, model: MODEL, size: SIZE, quality, usage: u, costUSD: +cost.toFixed(5), ms: Date.now() - t0 }) + '\n')
      console.log(`${j.idx}  ${j.brand} d${j.di} r${j.roll}  $${cost.toFixed(4)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      return
    }
    const retry = res.status === 429 || res.status >= 500
    console.error(`${j.idx}  HTTP ${res.status} (attempt ${attempt}) ${json?.error?.message || ''}`)
    if (!retry) break
    await new Promise(r => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || Math.min(60000, 4000 * 2 ** (attempt - 1))))
  }
  failed.push(j.idx)
}

const queue = [...todo]
await Promise.all(Array.from({ length: PARALLEL }, async () => { while (queue.length) await run(queue.shift()) }))
console.log(`\n${todo.length - failed.length}/${todo.length} images, $${spent.toFixed(3)} spent${failed.length ? `, failed: ${failed.join(',')} (re-run with --only)` : ''}`)
if (failed.length) process.exitCode = 1
