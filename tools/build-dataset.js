#!/usr/bin/env node
/* Build data/events.js from data/sources/.
 *
 *   node tools/build-dataset.js
 *
 * Sources are the raw returns of the research agents (see README). This script
 * is the whole cleaning pipeline: validate, apply the adjudicated corrections,
 * de-duplicate, sort, and emit the browser-loadable dataset. It is safe to
 * re-run — it only ever reads data/sources/ and writes data/events.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'sources');
const OUT = path.join(ROOT, 'data', 'events.js');
const NOW = 2026;

const CATEGORIES = [
  'Cosmos & Earth', 'Life & Extinctions', 'Human Origins', 'Empires & Politics',
  'Religion & Thought', 'Science & Technology', 'Culture & Art', 'Age / Era'
];

// ── Load ──────────────────────────────────────────────────────────────────
// `raw-events.json` is the original agent fan-out; any `*.events.json` is a
// later research batch. Everything is concatenated and then de-duplicated, so
// batches are free to restate events the earlier pass already covered.
const readJson = f => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
const srcFiles = fs.readdirSync(SRC).sort();

const raw = [];
const sourceCounts = {};
for (const f of ['raw-events.json', ...srcFiles.filter(f => f.endsWith('.events.json'))]) {
  const batch = readJson(f);
  sourceCounts[f] = batch.length;
  raw.push(...batch);
}

// Events dated after the present are kept apart. Years-before-present goes
// negative for them, and log(negative) is undefined — mixing them into the
// main series would silently corrupt every log-scale position.
const rawFuture = [];
for (const f of srcFiles.filter(f => f.endsWith('.future.json'))) {
  const batch = readJson(f);
  sourceCounts[f] = batch.length;
  rawFuture.push(...batch);
}

const { removals = [], corrections = [] } = readJson('corrections.json');

const report = {
  rejected: [], merged: 0, removed: 0, corrected: 0,
  fuzzyMerges: [], crossCategory: [], nearMisses: []
};

// Optional enrichment carried straight through from the sources.
const EXTRA = ['start_min', 'start_max', 't_since_bang', 't_since_bang_end',
  'dating_method', 'note', 'wikipedia_url'];

// ── Validate & normalise ──────────────────────────────────────────────────
function normalise(e, allowFuture) {
  const name = String(e.name || '').trim();
  if (!name) return null;
  const start = Number(e.start);
  let end = (e.end === null || e.end === undefined) ? null : Number(e.end);
  if (!Number.isFinite(start)) { report.rejected.push(['non-numeric start', name]); return null; }
  if (end !== null && !Number.isFinite(end)) end = null;
  // An end before a start is a transposition, not a fact — swap rather than drop.
  if (end !== null && end < start) { const t = end; end = start; start = t; }
  if (!allowFuture && start > NOW) {
    report.rejected.push(['starts in the future', name, start]); return null;
  }
  if (allowFuture && start <= NOW) {
    report.rejected.push(['listed as future but already past', name, start]); return null;
  }
  if (start < -14.5e9) { report.rejected.push(['predates the Big Bang', name, start]); return null; }

  let kind = ['moment', 'period', 'age'].includes(e.kind) ? e.kind
    : (end === null ? 'moment' : 'period');
  if (kind === 'age' && end === null) kind = 'moment';

  let category = CATEGORIES.includes(e.category) ? e.category : null;
  if (!category) {
    report.rejected.push(['unknown category → reassigned', name, e.category]);
    category = kind === 'age' ? 'Age / Era' : 'Culture & Art';
  }

  const out = {
    name, category, start, end, kind,
    description: String(e.description || '').trim(),
    significance: String(e.significance || '').trim(),
    region: String(e.region || '').trim() || undefined,
    confidence: ['exact', 'approximate', 'debated'].includes(e.confidence)
      ? e.confidence : 'approximate'
  };
  for (const k of EXTRA) if (e[k] !== undefined && e[k] !== null && e[k] !== '') out[k] = e[k];
  return out;
}

let events = raw.map(e => normalise(e, false)).filter(Boolean);
const future = rawFuture.map(e => normalise(e, true)).filter(Boolean)
  .sort((a, b) => a.start - b.start);

// ── Adjudicated removals ──────────────────────────────────────────────────
const removeSet = new Set(removals.map(n => n.toLowerCase().trim()));
const beforeRemoval = events.length;
events = events.filter(e => !removeSet.has(e.name.toLowerCase().trim()));
report.removed = beforeRemoval - events.length;

// ── Adjudicated field corrections ─────────────────────────────────────────
for (const c of corrections) {
  const target = events.find(e => e.name.toLowerCase().trim() === c.name.toLowerCase().trim());
  if (!target) continue;
  const value = (c.field === 'start' || c.field === 'end') ? Number(c.corrected) : c.corrected;
  if ((c.field === 'start' || c.field === 'end') && !Number.isFinite(value)) continue;
  target[c.field] = value;
  report.corrected++;
}

// ── De-duplicate ──────────────────────────────────────────────────────────
// Twelve domain agents plus four gap-fillers were told to overlap deliberately,
// so the same event arrives under several names ("Oldowan Stone Tools" vs
// "Oldowan Stone Tool Industry"). Exact-name matching misses those, so compare
// stemmed token sets and require the dates to agree as well.
const STOP = new Set(['the', 'and', 'of', 'in', 'to', 'a', 'an', 'first', 'early', 'late', 'great']);

const norm = s => String(s || '')
  .toLowerCase()
  .replace(/[‘’'`]/g, '')
  .replace(/\s*\(.*?\)\s*/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokens = s => new Set(
  norm(s).split(' ')
    .map(t => t.replace(/s$/, ''))            // crude stem: tool/tools
    .filter(t => t.length > 2 && !STOP.has(t))
);

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / (a.size + b.size - hits);
}

// Tolerance scales with an event's AGE, not with its year number. Two percent
// of the year 1914 is 38 years — wide enough to swallow the Second World War
// into the First. Two percent of its age (112 years) is a little over two.
const ageOf = e => Math.abs(NOW - e.start);
const tolFor = e => Math.max(3, ageOf(e) * 0.015);

function datesAgree(a, b) {
  const tol = Math.min(tolFor(a), tolFor(b));
  if (Math.abs(a.start - b.start) > tol) return false;
  if (a.end === null || b.end === null) return true;
  return Math.abs(a.end - b.end) <= Math.max(tol, 3);
}

const richness = e => (e.description || '').length + (e.significance || '').length +
  (e.region ? 12 : 0) + (e.end !== null ? 10 : 0);

// A containment test on its own is far too eager: "buddha" is a substring of
// "enlightenment of the buddha at bodh gaya", but those are two events. Require
// the shorter name to account for most of the longer one.
// Words that mark an act of recording or completion rather than a distinct
// phenomenon: "Structure of DNA" and "Structure of DNA Revealed" are one event.
const QUALIFIERS = new Set(['revealed', 'written', 'completed', 'invented',
  'discovered', 'published', 'launched', 'founded', 'founding', 'built',
  'begins', 'begun', 'established', 'created', 'introduced', 'described',
  'proposed', 'appear', 'appears']);

const isSubset = (a, b) => [...a].every(t => b.has(t));

function namesMatch(a, b) {
  const n1 = norm(a), n2 = norm(b);
  if (n1 === n2) return 1;
  const [short, long] = n1.length <= n2.length ? [n1, n2] : [n2, n1];
  if (long.includes(short) && short.length / long.length >= 0.6) return 0.95;

  const t1 = tokens(a), t2 = tokens(b);
  // One name being the other plus a substantive word usually means a narrower
  // event, not the same one: "Big Bang" vs "Big Bang Nucleosynthesis" are three
  // minutes and one entire epoch apart. Only a qualifier may be the difference.
  const [sub, sup] = t1.size <= t2.size ? [t1, t2] : [t2, t1];
  if (sub.size && sub.size < sup.size && isSubset(sub, sup)) {
    const extra = [...sup].filter(t => !sub.has(t));
    if (extra.some(t => !QUALIFIERS.has(t))) return 0;
  }

  const j = jaccard(t1, t2);
  return j >= 0.6 ? j : 0;
}

events.sort((a, b) => a.start - b.start);
const kept = [];
for (const e of events) {
  let dup = null, dupScore = 0;
  // Only entries near in time can be duplicates, so scan backwards and stop
  // once the dates are too far apart to ever match.
  // Scan a wide window, but only a name that matches outright may use it —
  // two agents citing the Last Glacial Maximum as 26,500 and 26,000 years ago
  // mean the same event, while a merely similar name still needs tight dates.
  const window = ageOf(e) * 0.1 + 3;
  for (let i = kept.length - 1; i >= 0; i--) {
    const k = kept[i];
    const gap = Math.abs(k.start - e.start);
    if (gap > window) break;
    if (k.category !== e.category) continue;
    const score = namesMatch(k.name, e.name);
    if (!score) continue;
    const ok = score === 1 ? gap <= window : datesAgree(k, e);
    if (ok) { dup = k; dupScore = score; break; }
  }
  if (dup) {
    report.merged++;
    // Identical names are unremarkable; anything looser is a judgement call
    // this script made on its own, so surface it for review.
    if (dupScore < 1) report.fuzzyMerges.push(`${dup.name}  ←  ${e.name}  (${dup.start})`);
    // Enrichment is additive rather than winner-take-all: a source link or an
    // uncertainty bound survives even when the other record has the better
    // prose, and the later batch wins where both carry the same field.
    const extras = {};
    for (const k of EXTRA) {
      if (dup[k] !== undefined) extras[k] = dup[k];
      if (e[k] !== undefined) extras[k] = e[k];
    }
    // Keep the richer record but never lose a bounded span or a region.
    if (richness(e) > richness(dup)) {
      const region = e.region || dup.region;
      const end = e.end !== null ? e.end : dup.end;
      Object.assign(dup, e, { region, end });
    } else {
      if (!dup.region && e.region) dup.region = e.region;
      if (dup.end === null && e.end !== null) dup.end = e.end;
    }
    Object.assign(dup, extras);
    continue;
  }
  kept.push(e);
}
events = kept;
events.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));

// The de-duplicator never merges across categories, because doing so would
// silently move an event into another lane. Same event, two lanes is still a
// defect though, so report the collisions rather than acting on them.
const byName = new Map();
for (const e of events) {
  const k = norm(e.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(e);
}
for (const [, group] of byName) {
  if (group.length < 2) continue;
  report.crossCategory.push(
    `${group[0].name} — ${group.map(g => `${g.category} (${g.start})`).join(' | ')}`);
}

// Tightening the merge rule trades false merges for missed ones, so look for
// pairs that landed just under the threshold: same lane, dates close, names
// overlapping. These are candidates for a human to judge, not to auto-merge.
for (let i = 0; i < events.length; i++) {
  for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if (Math.abs(a.start - b.start) > tolFor(b)) break;
    if (a.category !== b.category) continue;
    const sim = jaccard(tokens(a.name), tokens(b.name));
    if (sim >= 0.3 && sim < 0.6) {
      report.nearMisses.push(`${a.name} (${a.start})  ~  ${b.name} (${b.start})  [${sim.toFixed(2)}]`);
    }
  }
}

// ── Emit ──────────────────────────────────────────────────────────────────
const enriched = events.filter(e => e.wikipedia_url).length;
const header = `/* Deep Time — event dataset. GENERATED FILE, do not edit by hand.
 * Rebuild with:  node tools/build-dataset.js
 *
 * ${events.length} entries compiled by a research fan-out of 12 domain
 * historians and 4 gap-fillers, audited chunk-by-chunk and adversarially
 * adjudicated (see data/sources/corrections.json), then extended by a sourced
 * research batch (data/sources/*.events.json); ${enriched} carry a source link.
 *
 * Years are signed: negative = BCE, positive = CE, deep time in years
 * (66 million years ago = -66000000). \`end\` of ${NOW} means still ongoing.
 * Prehistoric dates are inherently approximate — see the \`confidence\` field,
 * and \`start_min\`/\`start_max\` where a record carries explicit bounds.
 *
 * \`future\` is a SEPARATE array. Those events postdate ${NOW}, so their
 * years-before-present is negative and log-scale positioning is undefined for
 * them; a renderer must opt in and handle them deliberately.
 *
 * \`t_since_bang\` (seconds) is present on pre-recombination events, which all
 * round to the same age in years and would otherwise stack on one pixel. The
 * values are order-of-magnitude epoch boundaries for log placement, not
 * measurements.
 */
window.HISTORY_DATA = {
  count: ${events.length},
  futureCount: ${future.length},
  events: `;

fs.writeFileSync(OUT,
  header + JSON.stringify(events, null, 1) +
  ',\n  future: ' + JSON.stringify(future, null, 1) + '\n};\n');

// ── Report ────────────────────────────────────────────────────────────────
const counts = {};
for (const e of events) counts[e.category] = (counts[e.category] || 0) + 1;

console.log('sources:');
for (const [f, n] of Object.entries(sourceCounts)) console.log(`  ${String(n).padStart(4)}  ${f}`);
console.log(`\nraw ${raw.length} → ${events.length} events (+${future.length} future)`);
console.log(`  removed (adjudicated duplicates): ${report.removed}`);
console.log(`  merged (fuzzy duplicates):        ${report.merged}`);
console.log(`  field corrections applied:        ${report.corrected}`);
console.log(`  rejected as invalid:              ${report.rejected.length}`);
console.log(`  carrying a source link:           ${enriched}`);
console.log('\nby category:');
for (const c of CATEGORIES) console.log(`  ${String(counts[c] || 0).padStart(4)}  ${c}`);

const bp = e => NOW - e.start;
const bands = [
  ['> 1 Ga', e => bp(e) > 1e9],
  ['1 Ga – 1 Ma', e => bp(e) <= 1e9 && bp(e) > 1e6],
  ['1 Ma – 100 ka', e => bp(e) <= 1e6 && bp(e) > 1e5],
  ['100 – 10 ka', e => bp(e) <= 1e5 && bp(e) > 1e4],
  ['10 ka – 1 CE', e => bp(e) <= 1e4 && e.start < 1],
  ['1 – 1500 CE', e => e.start >= 1 && e.start < 1500],
  ['1500 – 1900', e => e.start >= 1500 && e.start < 1900],
  ['1900 – now', e => e.start >= 1900]
];
console.log('\nby time band:');
for (const [label, fn] of bands) console.log(`  ${String(events.filter(fn).length).padStart(4)}  ${label}`);

if (report.rejected.length) {
  console.log('\nrejected:');
  for (const r of report.rejected.slice(0, 20)) console.log('  ', r.join(' · '));
}
if (report.fuzzyMerges.length) {
  console.log(`\nfuzzy merges — verify these are genuinely the same event (${report.fuzzyMerges.length}):`);
  for (const m of report.fuzzyMerges) console.log('  ', m);
}
if (report.nearMisses.length) {
  console.log(`\npossible missed duplicates — same lane, close dates, similar names (${report.nearMisses.length}):`);
  for (const m of report.nearMisses) console.log("  ", m);
}
if (report.crossCategory.length) {
  console.log(`\nsame name in more than one lane — NOT merged, decide by hand (${report.crossCategory.length}):`);
  for (const c of report.crossCategory) console.log('  ', c);
}
console.log(`\nwrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
