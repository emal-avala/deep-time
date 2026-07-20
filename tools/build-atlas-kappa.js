#!/usr/bin/env node
/* Build data/atlases/kappa.js — the Buddhist-cosmology atlas.
 *
 *   node tools/build-atlas-kappa.js
 *
 * Source records come from a research fan-out over a companion to the Great
 * Chronicle of Buddhas, composed and adversarially verified (see README).
 * This script fixes positions the source could not, validates, and emits the
 * drop-in atlas file.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = '/private/tmp/claude-501/-Users-emal-Code-sandbox/facafd9e-ee0e-484d-b971-6179ebb4bdee/scratchpad/buddha/kappa-raw.json';
const OUT = path.join(ROOT, 'data', 'atlases', 'kappa.js');

// A kappa has no year-count in the canon. This lower bound comes from the
// similes (SN 15.5, SN 15.6) and is used ONLY to place events inside the
// present aeon, which would otherwise all collapse onto zero.
const YEARS_PER_KAPPA = 1e15;

const CATEGORIES = [
  'Aeons & Cycles', 'The Buddhas', 'The Path',
  'Planes & Lifespans', 'This Aeon', 'The Ten to Come'
];

// ── The present-aeon correction ───────────────────────────────────────────
// The source placed the five Buddhas of this aeon at 4, 3, 2 and 0.0001
// kappas. Those are display coordinates from its own chart, not measures: all
// five arise inside the SAME mahākappa, so every one of them belongs far below
// one kappa. Their separation is given by the traditional scheme in which the
// human lifespan falls by one year each century, so the interval back to a
// Buddha whose contemporaries lived N years is (N - 100) * 100 years.
const LIFESPAN_AT = { 'Kakusandha': 40000, 'Koṇāgamana': 30000, 'Kassapa': 20000 };
const GOTAMA_YEARS_AGO = 2600;

function presentAeonKappa(name) {
  if (/^Gotama/.test(name)) return GOTAMA_YEARS_AGO / YEARS_PER_KAPPA;
  for (const key of Object.keys(LIFESPAN_AT)) {
    if (name.indexOf(key) === 0) {
      const years = (LIFESPAN_AT[key] - 100) * 100 + GOTAMA_YEARS_AGO;
      return years / YEARS_PER_KAPPA;
    }
  }
  return null;
}

// ── Load & correct ────────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const report = { corrected: [], rejected: [], clamped: 0 };

let events = raw.map(e => {
  const name = String(e.name || '').trim();
  if (!name) return null;
  if (!CATEGORIES.includes(e.category)) {
    report.rejected.push(['unknown category', name, e.category]);
    return null;
  }

  let kappa = Number(e.kappa);
  let kappaEnd = (e.kappaEnd === null || e.kappaEnd === undefined) ? null : Number(e.kappaEnd);
  if (!Number.isFinite(kappa)) { report.rejected.push(['non-numeric kappa', name]); return null; }
  if (kappaEnd !== null && !Number.isFinite(kappaEnd)) kappaEnd = null;

  // Always override these four: the source's value for Gotama (0.0001 kappas)
  // is 10^11 years, which is still wrong by eight orders of magnitude.
  const fixed = presentAeonKappa(name);
  if (fixed !== null && e.category === 'The Buddhas') {
    report.corrected.push(`${name}: ${kappa} → ${fixed.toExponential(2)} kappas`);
    kappa = fixed;
  }

  return {
    name,
    pali: String(e.pali || '').trim(),
    category: e.category,
    kappa,
    kappaEnd,
    kind: ['moment', 'period', 'age'].includes(e.kind) ? e.kind
      : (kappaEnd === null ? 'moment' : 'period'),
    description: String(e.description || '').trim(),
    significance: String(e.significance || '').trim(),
    source: String(e.source || '').trim(),
    confidence: ['canonical', 'traditional', 'derived'].includes(e.confidence)
      ? e.confidence : 'traditional'
  };
}).filter(Boolean);

// Deduplicate by name — the fan-out overlapped deliberately.
const seen = new Map();
for (const e of events) {
  const k = e.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!seen.has(k)) seen.set(k, e);
}
events = [...seen.values()].sort((a, b) => b.kappa - a.kappa || a.name.localeCompare(b.name));

// ── Emit ──────────────────────────────────────────────────────────────────
const counts = {};
for (const e of events) counts[e.category] = (counts[e.category] || 0) + 1;

const file = `/* Buddhist cosmology — a Deep Time atlas. GENERATED, do not edit by hand.
 * Rebuild with:  node tools/build-atlas-kappa.js
 *
 * ${events.length} entries drawn from the Buddhavaṃsa and the Great Chronicle of
 * Buddhas, composed and adversarially verified by a research fan-out.
 *
 * UNIT: mahākappas before the present. The canon gives NO year-count for a
 * kappa — asked how long one is, the Buddha answered with two similes instead
 * (SN 15.5, a mountain worn away by a silk cloth; SN 15.6, a city of mustard
 * seeds emptied one seed a century). Every year-figure here is therefore a
 * modern derivation, marked \`derived\`, never scripture.
 *
 * The five Buddhas of this aeon are placed by the traditional scheme in which
 * the human lifespan falls one year per century; their intervals are not fixed
 * in the texts. See tools/build-atlas-kappa.js.
 */
(function () {
  window.DEEP_TIME_ATLASES = window.DEEP_TIME_ATLASES || [];
  window.DEEP_TIME_ATLASES.push({
    id: 'kappa',
    label: 'Kappa',
    tradition: 'Buddhist cosmology',
    thesis: 'Deep time as the Buddhavaṃsa counts it — where the age of the universe is a rounding error inside one aeon.',
    mark: 'dharmachakra',
    unit: 'kappas',
    nowLabel: 'now',
    scale: 'unitsBeforePresent',
    field: 'kappa',
    format: 'kappas',
    ceil: 1.2e6,
    floor: 1e-13,
    home: [1e6, 1e-13],
    ageKey: '\u0000',
    tickGap: 96,
    // A reference mark: the entire physical universe, in this unit.
    landmark: { value: 1.38e10 / ${YEARS_PER_KAPPA}, label: 'age of the universe' },
    categories: [
      { key: 'Aeons & Cycles',     label: 'Aeons & Cycles',  v: '--c1' },
      { key: 'The Buddhas',        label: 'The Buddhas',     v: '--c2' },
      { key: 'The Path',           label: 'The Path',        v: '--c3' },
      { key: 'Planes & Lifespans', label: 'Planes',          v: '--c4' },
      { key: 'This Aeon',          label: 'This Aeon',       v: '--c5' },
      { key: 'The Ten to Come',    label: 'The Ten to Come', v: '--c6' }
    ],
    ladder: [
      { label: 'All of it',    max: 1e6,   min: 1e-13 },
      { label: 'The 28',       max: 9e5,   min: 1 },
      { label: 'Recent aeons', max: 200,   min: 1e-13 },
      { label: 'This aeon',    max: 1,     min: 1e-13 },
      { label: 'Since Gotama', max: 1e-11, min: 1e-13 }
    ],
    events: ${JSON.stringify(events, null, 1)}
  });
})();
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, file);

console.log(`${raw.length} raw → ${events.length} entries`);
console.log('\nby thread:');
for (const c of CATEGORIES) console.log(`  ${String(counts[c] || 0).padStart(3)}  ${c}`);
console.log('\nconfidence:');
const conf = {};
for (const e of events) conf[e.confidence] = (conf[e.confidence] || 0) + 1;
for (const [k, v] of Object.entries(conf)) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`\npresent-aeon corrections (${report.corrected.length}):`);
for (const c of report.corrected) console.log('  ', c);
if (report.rejected.length) {
  console.log(`\nrejected (${report.rejected.length}):`);
  for (const r of report.rejected) console.log('  ', r.join(' · '));
}
console.log(`\nkappa span: ${events[0].kappa} → ${events[events.length - 1].kappa}`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
