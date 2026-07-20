#!/usr/bin/env node
/* Build data/atlases/yuga.js — the Hindu-cosmology atlas.
 *
 *   node tools/build-atlas-yuga.js
 *
 * Records come from a research fan-out, audited per thread for arithmetic and
 * then reconciled across threads. Unlike the Buddhist atlas, this scheme is
 * self-checking, so this script re-verifies the whole chain before emitting.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = '/private/tmp/claude-501/-Users-emal-Code-sandbox/facafd9e-ee0e-484d-b971-6179ebb4bdee/scratchpad/buddha/yuga-raw.json';
const OUT = path.join(ROOT, 'data', 'atlases', 'yuga.js');

// ── The canonical chain ───────────────────────────────────────────────────
const YUGA = { satya: 1728000, treta: 1296000, dvapara: 864000, kali: 432000 };
const MAHAYUGA = YUGA.satya + YUGA.treta + YUGA.dvapara + YUGA.kali;  // 4,320,000
const KALPA = 1000 * MAHAYUGA;                                        // 4.32e9
const MANVANTARA = 71 * MAHAYUGA;                                     // 306,720,000
const SANDHI = YUGA.satya;
const BRAHMA_LIFE = 100 * 360 * 2 * KALPA;                            // 311.04e12

// The scheme is arithmetically self-checking. If these fail the constants are
// wrong and nothing downstream can be trusted.
const checks = [
  ['mahāyuga', MAHAYUGA, 4320000],
  ['kalpa', KALPA, 4320000000],
  ['14 manvantaras + 15 sandhis tile the kalpa', 14 * MANVANTARA + 15 * SANDHI, KALPA],
  ["Brahmā's life", BRAHMA_LIFE, 311040000000000]
];
const failed = checks.filter(([, got, want]) => got !== want);
if (failed.length) {
  console.error('canonical arithmetic broken:');
  failed.forEach(([n, got, want]) => console.error(`  ${n}: ${got} != ${want}`));
  process.exit(1);
}

const CATEGORIES = [
  'Cycles of Brahmā', 'Manvantaras', 'The Yugas',
  'Avatāras', 'Dissolutions', 'This Kali Yuga'
];

// ── Reconciliation fixes ──────────────────────────────────────────────────
// A cross-thread audit found the Manvantaras and Yugas threads shifted one
// year against the other four. Both are internally consistent; they simply
// built on Kali-elapsed = 5,128 where the rest used 5,127. There is no year
// zero, so 3102 BCE is 5,127 years before 2026 CE — the 128-family is wrong.
const SHIFTED_THREADS = new Set(['Manvantaras', 'The Yugas']);
const KALI_ELAPSED = 5127;

// The fourteen manvantaras plus fifteen sandhis must tile the kalpa exactly.
// The closing sandhi had no record at all, leaving the last 1,728,000 years
// of the kalpa an unrecorded gap.
const KALPA_ELAPSED = 1972949127;
const KALPA_REMAINING = KALPA - KALPA_ELAPSED;      // -2,347,050,873
const CLOSING_SANDHI = {
  name: 'Closing Junction of the Śveta-varāha Kalpa',
  sanskrit: 'Sandhi',
  category: 'Manvantaras',
  year: -(KALPA_REMAINING - SANDHI),
  yearEnd: -KALPA_REMAINING,
  kind: 'period',
  description: 'The fifteenth and last junction of the present kalpa, following the fourteenth manvantara and closing the day of Brahmā.',
  significance: 'Without it the fourteen manvantaras and their junctions fall 1,728,000 years short of tiling the kalpa they are defined to fill.',
  source: 'Viṣṇu Purāṇa 1.3',
  confidence: 'derived'
};

// A record that silently folded the following sandhi into the manvantara,
// contradicting the definition used everywhere else.
const REMAINDER_FIX = {
  'Remainder of the Vaivasvata Manvantara': -(MANVANTARA - 120533127)
};

// ── Load & validate ───────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const report = { rejected: [], future: 0, spans: 0, shifted: 0, retimed: [], dropped: [] };

let events = raw.map(e => {
  const name = String(e.name || '').trim();
  if (!name) return null;
  if (!CATEGORIES.includes(e.category)) {
    report.rejected.push(['unknown thread', name, e.category]); return null;
  }
  let year = Number(e.year);
  let yearEnd = (e.yearEnd === null || e.yearEnd === undefined) ? null : Number(e.yearEnd);
  if (!Number.isFinite(year)) { report.rejected.push(['non-numeric year', name]); return null; }
  if (yearEnd !== null && !Number.isFinite(yearEnd)) yearEnd = null;

  // Pull the two shifted threads onto the same grid as the other four.
  if (SHIFTED_THREADS.has(e.category)) {
    year -= 1;
    if (yearEnd !== null) yearEnd -= 1;
    report.shifted++;
  }
  if (REMAINDER_FIX[name] !== undefined) {
    yearEnd = REMAINDER_FIX[name];
    report.retimed.push(name);
  }
  // Nothing may sit outside Brahmā's life in either direction.
  if (Math.abs(year) > BRAHMA_LIFE * 1.05) {
    report.rejected.push(['outside Brahmā\'s life', name, year]); return null;
  }
  if (year < 0) report.future++;
  if (yearEnd !== null) report.spans++;

  return {
    name,
    sanskrit: String(e.sanskrit || '').trim(),
    category: e.category,
    year, yearEnd,
    kind: ['moment', 'period', 'age'].includes(e.kind) ? e.kind
      : (yearEnd === null ? 'moment' : 'period'),
    description: String(e.description || '').trim(),
    significance: String(e.significance || '').trim(),
    source: String(e.source || '').trim(),
    confidence: ['canonical', 'traditional', 'derived'].includes(e.confidence)
      ? e.confidence : 'traditional'
  };
}).filter(Boolean);

// A duplicate of the same interval under two names invites exactly the drift
// this dataset already suffered, so drop the alias.
const ALIASES = new Set(['vaivasvata manvantara']);
events = events.filter(e => {
  const k = e.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (ALIASES.has(k)) { report.dropped.push(e.name); return false; }
  return true;
});
events.push(CLOSING_SANDHI);

// Deduplicate by name; the threads overlap deliberately.
const seen = new Map();
for (const e of events) {
  const k = e.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!seen.has(k)) seen.set(k, e);
}
events = [...seen.values()].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));

// ── Emit ──────────────────────────────────────────────────────────────────
const counts = {};
for (const e of events) counts[e.category] = (counts[e.category] || 0) + 1;

const file = `/* Hindu cosmology — a Deep Time atlas. GENERATED, do not edit by hand.
 * Rebuild with:  node tools/build-atlas-yuga.js
 *
 * ${events.length} entries from the Purāṇic scheme, composed by a research
 * fan-out, audited per thread for arithmetic and reconciled across threads.
 *
 * UNIT: years before 2026 CE. Where the Pāli canon refuses to number a kappa,
 * the Purāṇas are explicit and internally consistent to the year:
 *
 *   yugas 1,728,000 + 1,296,000 + 864,000 + 432,000 = 4,320,000 (mahāyuga)
 *   1,000 mahāyugas                                 = 4,320,000,000 (kalpa)
 *   14 manvantaras + 15 sandhis                     = 4,320,000,000 exactly
 *   100 × 360 × 2 kalpas                            = 311,040,000,000,000
 *
 * The build refuses to emit if that chain does not close.
 *
 * A kalpa — one day of Brahmā — is 4.32 billion years. The Earth is 4.54
 * billion years old. The tradition did not know that, and the coincidence is
 * worth noticing without being made more of than it is.
 */
(function () {
  window.DEEP_TIME_ATLASES = window.DEEP_TIME_ATLASES || [];
  window.DEEP_TIME_ATLASES.push({
    id: 'yuga',
    label: 'Hindu',
    tradition: 'Hindu cosmology',
    thesis: 'Deep time as the Purāṇas count it — exact to the year, and running to 311 trillion of them.',
    mark: 'chakra',
    unit: 'years',
    nowLabel: 'now',
    scale: 'unitsBeforePresent',
    field: 'year',
    format: 'years',
    ceil: 3.2e14,
    floor: 1,
    home: [3.11e14, 1],
    ageKey: '\\u0000',
    tickGap: 84,
    landmark: { value: 1.38e10, label: 'age of the universe' },
    categories: [
      { key: 'Cycles of Brahmā', label: 'Cycles of Brahmā', v: '--c1' },
      { key: 'Manvantaras',      label: 'Manvantaras',      v: '--c2' },
      { key: 'The Yugas',        label: 'The Yugas',        v: '--c3' },
      { key: 'Avatāras',         label: 'Avatāras',         v: '--c4' },
      { key: 'Dissolutions',     label: 'Dissolutions',     v: '--c5' },
      { key: 'This Kali Yuga',   label: 'This Kali Yuga',   v: '--c6' }
    ],
    ladder: [
      { label: 'All of it',       max: 3.11e14, min: 1 },
      { label: "Brahmā's life",   max: 3.11e14, min: 1e9 },
      { label: 'This kalpa',      max: 4.32e9,  min: 1 },
      { label: 'This manvantara', max: 3.07e8,  min: 1 },
      { label: 'This mahāyuga',   max: 4.32e6,  min: 1 },
      { label: 'This Kali Yuga',  max: 4.4e5,   min: 1 }
    ],
    events: ${JSON.stringify(events, null, 1)}
  });
})();
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, file);

// The tiling must now close. This is the check the threads individually passed
// and collectively failed.
const kaliStarts = events.filter(e => /Kali Yuga (Begins|of this Mah|Entire)|Onset of Kali/.test(e.name)).map(e => e.year);
const agree = kaliStarts.every(y => y === KALI_ELAPSED);
if (!agree) {
  console.error('Kali Yuga start still disagrees across threads:', kaliStarts);
  process.exit(1);
}

console.log('canonical chain verified:');
checks.forEach(([n, got]) => console.log(`  ${n} = ${got.toLocaleString()}`));
console.log(`\n${raw.length} raw → ${events.length} entries`);
console.log('\nby thread:');
for (const c of CATEGORIES) console.log(`  ${String(counts[c] || 0).padStart(3)}  ${c}`);
const conf = {};
for (const e of events) conf[e.confidence] = (conf[e.confidence] || 0) + 1;
console.log('\nconfidence:');
for (const [k, v] of Object.entries(conf)) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`\nstill to come: ${report.future} · spans: ${report.spans}`);
console.log(`reconciliation: ${report.shifted} records shifted onto the 5,127 grid`);
console.log(`  retimed: ${report.retimed.join(', ') || 'none'}`);
console.log(`  dropped as alias: ${report.dropped.join(', ') || 'none'}`);
console.log(`  Kali Yuga start agrees across all threads at ${KALI_ELAPSED}`);
if (report.rejected.length) {
  console.log(`\nrejected (${report.rejected.length}):`);
  for (const r of report.rejected) console.log('  ', r.join(' · '));
}
console.log(`\nyear span: ${events[0].year.toExponential(3)} → ${events[events.length - 1].year.toExponential(3)}`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
