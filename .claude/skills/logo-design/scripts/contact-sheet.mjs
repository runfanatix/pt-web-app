#!/usr/bin/env node
// contact-sheet.mjs <workdir>
//
// Renders <workdir>/up/<idx>.jpg into one review grid from manifest.json: a row per brand,
// its directions and rolls left to right, each cell labelled with its idx (and d<direction>
// r<roll>). Writes <workdir>/sheet.png, sized to stay under 2000 px so it can be Read.
// Headless Chrome or Edge, Windows or macOS.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const work = path.resolve(process.argv[2] || '')
const man = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8'))
const [aw, ah] = man.mode === 'white' ? [1, 1] : [3, 4]

// One row per brand, wrapped at six so a 12-direction explore run stays readable.
const rows = []
const byBrand = []
for (const j of man.jobs) (byBrand[j.bi] ||= []).push(j)
for (const list of byBrand) for (let i = 0; i < list.length; i += 6) rows.push(list.slice(i, i + 6))
const cols = Math.max(...rows.map(r => r.length))
const w = Math.min(260, Math.floor(1950 / cols) - 6, Math.floor(((1950 / rows.length) - 6) * aw / ah))
const h = Math.round(w * ah / aw)

const cell = j => {
  const f = path.join(work, 'up', `${j.idx}.jpg`)
  const img = fs.existsSync(f) ? `<img src="${pathToFileURL(f)}" style="width:100%;height:100%;object-fit:cover">` : ''
  return `<div style="position:relative;width:${w}px;height:${h}px;background:#fff">${img}<b style="position:absolute;left:3px;top:1px;font:bold 15px sans-serif;color:#f0f;background:#fff">${j.idx} d${j.di} r${j.roll}</b></div>`
}
const html = path.join(work, 'sheet.html')
fs.writeFileSync(html, `<body style="margin:0;background:#888;padding:6px">${rows.map(r => `<div style="display:flex;gap:6px;margin-bottom:6px">${r.map(cell).join('')}</div>`).join('')}</body>`)

const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const chrome = browsers.find(b => fs.existsSync(b))
if (!chrome) throw new Error('no Chrome or Edge found')
const out = path.join(work, 'sheet.png')
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  `--screenshot=${out}`, `--window-size=${cols * (w + 6) + 12},${rows.length * (h + 6) + 12}`,
  '--virtual-time-budget=6000', pathToFileURL(html).href], { stdio: 'ignore', timeout: 120000 })
console.log(out)
