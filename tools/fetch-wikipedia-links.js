#!/usr/bin/env node
/* Resolve a Wikipedia article for every event that lacks one.
 *
 *   node tools/fetch-wikipedia-links.js
 *
 * Queries the MediaWiki search API, so every URL written here is a page that
 * provably exists. The top hit is still only a guess, so each match is scored
 * on how much of the event's name it actually shares: strong matches are
 * accepted, weak ones are written to a `review` list and left out of the
 * dataset until a human confirms them. Better a missing link than a wrong one.
 *
 * Output: data/sources/wikipedia-backfill.json  (accepted + review + missing)
 * Re-runnable: existing results are reused, only unresolved names are fetched.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'sources', 'wikipedia-backfill.json');
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'deep-time-dataset/1.0 (https://github.com/emal-avala/deep-time)';

const CONCURRENCY = 4;
const ACCEPT_SCORE = 0.5;

// ── Load events ───────────────────────────────────────────────────────────
global.window = {};
require(path.join(ROOT, 'data', 'events.js'));
const events = global.window.HISTORY_DATA.events;

const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const accepted = prior.accepted || {};
const review = prior.review || {};
const missing = new Set(prior.missing || []);

// ── Name matching ─────────────────────────────────────────────────────────
const STOP = new Set(['the', 'and', 'of', 'in', 'to', 'a', 'an', 'first', 'its']);
const tokens = s => new Set(
  String(s).toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(' ')
    .map(t => t.replace(/s$/, ''))
    .filter(t => t.length > 2 && !STOP.has(t))
);

function score(eventName, articleTitle) {
  const a = tokens(eventName), b = tokens(articleTitle);
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  // Asymmetric on purpose: an article title that covers most of the event's
  // distinctive words is a good match even if the article name is longer
  // ("Toba supereruption" -> "Youngest Toba eruption").
  return hits / Math.min(a.size, b.size);
}

// A handful of names the search API reliably gets wrong, pinned by hand.
const PINNED = {
  'The Big Bang': 'Big Bang',
  'Origin of Life (First Life)': 'Abiogenesis',
  'Control of Fire': 'Control of fire by early humans',
  'Cuneiform Writing Invented': 'Cuneiform',
  'The Wheel': 'Wheel',
  'Agriculture (Neolithic Revolution)': 'Neolithic Revolution',
  'The Printing Press': 'Printing press',
  'The Transistor': 'Transistor',
  'The World Wide Web': 'World Wide Web',
  'Generative AI': 'Generative artificial intelligence',
  'The Personal Computer': 'Personal computer'
};

// ── Fetch ─────────────────────────────────────────────────────────────────
async function search(name) {
  const q = PINNED[name] || name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const url = `${API}?action=query&list=search&srsearch=${encodeURIComponent(q)}` +
    `&srlimit=3&format=json&origin=*`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      return (json.query && json.query.search) || [];
    } catch (err) {
      if (attempt === 2) { console.warn(`  ! ${name}: ${err.message}`); return null; }
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const titleToUrl = t => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t.replace(/ /g, '_'));

async function run() {
  const todo = events
    .filter(e => !e.wikipedia_url)
    .map(e => e.name)
    .filter(n => !accepted[n] && !review[n] && !missing.has(n));

  console.log(`${events.length} events · ${events.filter(e => e.wikipedia_url).length} already linked`);
  console.log(`${todo.length} to resolve (concurrency ${CONCURRENCY})\n`);

  let done = 0;
  const queue = todo.slice();

  async function worker() {
    while (queue.length) {
      const name = queue.shift();
      const hits = await search(name);
      done++;
      if (done % 25 === 0) {
        console.log(`  ${done}/${todo.length}  accepted ${Object.keys(accepted).length}  review ${Object.keys(review).length}`);
        save();
      }
      if (!hits || !hits.length) { missing.add(name); continue; }

      // Score all three hits and keep the best, not merely the first.
      let best = null;
      for (const h of hits) {
        const s = score(name, h.title);
        if (!best || s > best.s) best = { s, title: h.title };
      }
      const rec = { title: best.title, url: titleToUrl(best.title), score: Number(best.s.toFixed(2)) };
      if (best.s >= ACCEPT_SCORE || PINNED[name]) accepted[name] = rec;
      else review[name] = rec;
      await sleep(120);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();

  console.log(`\naccepted (score >= ${ACCEPT_SCORE}): ${Object.keys(accepted).length}`);
  console.log(`needs review (weak match):  ${Object.keys(review).length}`);
  console.log(`no result at all:           ${missing.size}`);
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
  console.log('Review the `review` block, promote good ones into `accepted`,');
  console.log('then run: node tools/build-dataset.js');
}

function save() {
  fs.writeFileSync(OUT, JSON.stringify({
    _note: 'Generated by tools/fetch-wikipedia-links.js. `accepted` is applied by ' +
           'build-dataset.js; `review` is held back until a human promotes it.',
    accepted, review, missing: [...missing]
  }, null, 1));
}

run().catch(err => { console.error(err); process.exit(1); });
