#!/usr/bin/env node
/* Build data/atlases/kappa.js — the Buddhist-cosmology atlas.
 *
 *   node tools/build-atlas-kappa.js
 *
 * Input is data/sources/kappa.json (committed, read-only): records drawn from
 * the Buddhavaṃsa and the Great Chronicle of Buddhas, composed and
 * adversarially verified by a research fan-out. This script fixes the
 * placements the raw records could not, validates, and emits the atlas file.
 *
 * The fixes below are grounded in the primary source. Page references are to
 * the Great Chronicles PDF (Tipiṭaka Nikāya Sāsana translation).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'sources', 'kappa.json');
const OUT = path.join(ROOT, 'data', 'atlases', 'kappa.js');

// A kappa (mahākappa) has NO year-count in the canon. Asked how long one is,
// the Buddha answered with similes, not a number (SN 15.5, a mountain worn away
// by a silk cloth; SN 15.6, a city of mustard seeds emptied a seed a century).
// Taking the mountain simile literally yields a lower bound of ~1e15 years; we
// use it ONLY to place events inside the present aeon that would otherwise
// collapse onto zero. It is a floor, never a measurement.
const YEARS_PER_KAPPA = 1e15;

// The nested aeon-structure, from the primary source (GC "Miscellaneous
// Topics", ~p.2411): "one immeasurable aeon (asaṅkhyeyya-kappa) is equal to
// 64 inclusive periods (antara-kappa) of human beings." A mahākappa is four
// asaṅkhyeyya-kappas, so it spans 4 × 64 = 256 antara-kappa-durations. One
// antara-kappa is therefore 1/256 of a mahākappa. (The often-quoted "20" is
// the Avīci-hell reckoning, not the human one.)
const ANTARA = 1 / 256;

const CATEGORIES = [
  'Aeons & Cycles', 'The Buddhas', 'The Path',
  'Planes & Lifespans', 'This Aeon', 'The Ten to Come'
];

// ── The present-aeon Buddhas ──────────────────────────────────────────────
// The raw records placed the four past Buddhas of this aeon at ~1e-9 kappas,
// derived by interpolating the human lifespan at one year per century. The
// primary source does NOT measure their separation in years — it measures it
// in antara-kappas: "Buddha Kakusandha appeared in the aeon of 40,000 years
// lifespan; after him, passed one inclusive period (antara-kappa), and Buddha
// Koṇāgamana appeared … after him, passed one inclusive period; and Buddha
// Kassapa appeared" (GC p.428–429). The interval Kassapa→Gotama is longer
// still — "more than one inclusive period," the lifespan rising to an
// incalculable and falling again to a hundred (GC ~p.204, p.428). Each gap is
// a full down-and-up lifespan swing, not a couple of million years.
//
// So they are placed on the antara-kappa ladder, one intervening period apart,
// Gotama at the present. Their lifespan-era (40k/30k/20k/100 years) is a
// property OF each Buddha's age, shown in prose, not a coordinate.
const PRESENT_BUDDHAS = {
  'Kakusandha': { antaraAgo: 4, era: '40,000-year lifespan' },
  'Koṇāgamana': { antaraAgo: 3, era: '30,000-year lifespan' },
  'Kassapa':    { antaraAgo: 2, era: '20,000-year lifespan' },
  // Gotama keeps his literal remove: 2,600 years ago is 2.6e-12 kappas, far
  // below one antara-kappa, so on this axis he sits essentially at the present.
  'Gotama':     { yearsAgo: 2600, era: '100-year lifespan' }
};
const ANTARA_NOTE = 'Separation from the neighbouring Buddhas is given in the Chronicles as whole antara-kappas (intermediate aeons), not in years; each gap is one full swing of the human lifespan down to ten years and back up to an incalculable.';

// ── Gotama's own life, and the disappearance of his teaching ──────────────
// Three events sat at ±0.0001 kappas — 1e11 years — for things that are 2,600
// years old. They are anchored to history and belong at the present line.
const GOTAMA_AGO = 2600;                      // rounded years before 2026 CE
const DHAMMA_LASTS = 5000;                    // traditional life of the Sāsana
const GOTAMA_LIFE_EVENTS = {
  'The Turning of the Wheel': { kappa: GOTAMA_AGO / YEARS_PER_KAPPA, kappaEnd: null },
  'The Great Passing':        { kappa: 2545 / YEARS_PER_KAPPA,       kappaEnd: null },
  // The Sāsana fades ~5,000 years after Gotama, i.e. ~2,400 years hence.
  'The Vanishing of the Dhamma': {
    kappa: -(DHAMMA_LASTS - GOTAMA_AGO) / YEARS_PER_KAPPA, kappaEnd: null
  },
  "Gotama's Dispensation": {
    kappa: GOTAMA_AGO / YEARS_PER_KAPPA,
    kappaEnd: -(DHAMMA_LASTS - GOTAMA_AGO) / YEARS_PER_KAPPA
  }
};

// ── The path to Metteyya, and the Ten to Come ─────────────────────────────
// The raw records placed Metteyya by the same year-interpolation (8,008,000
// years ahead). The source is explicit that the distance is not countable in
// years: "after the human lifespan decreases to ten years, there will be seven
// intervening aeons (sattantara-kappa), then the lifespan will increase to an
// incalculable, and when it has decreased again to 80,000 years, the next
// Buddha will arise" (Dvp 125/132, quoted GC p.1670). Seven antara-kappas is
// the only countable part; the rise "to an incalculable" is, by name, not a
// number — so Metteyya's true remove is formally uncountable. He is placed at
// the far edge of that countable span.
const METTEYYA_ANTARA = 8;                    // 7 intervening aeons + the final rise
const METTEYYA_NOTE = 'Distance from the present is only partly countable: seven intervening aeons after the human lifespan next falls to ten years, then a rise "to an incalculable" — a length the texts decline to number — before the lifespan settles at 80,000 and Metteyya arises.';

// The nine Buddhas after Metteyya are given by the Anāgatavaṃsa and the
// Dasabodhisatta texts in ORDER only, with no fixed intervals. They arise in
// successive future aeons; the one-mahākappa spacing is a display convention,
// disclosed on every record, not scripture.
const TEN_TO_COME_ORDER = [
  'Rāma', 'Pasenadi of Kosala', 'Abhibhū', 'Dīghasoṇī', 'Caṇḍanī',
  'Subha', 'Todeyya', 'Nāḷāgiri the Elephant', 'Pālaleyya the Elephant'
];
const FUTURE_NOTE = 'Given in the Anāgatavaṃsa and Dasabodhisatta texts in order only; the spacing shown (one aeon apart) is a display convention, not a counted interval.';

// The near-future nadir and the swing back up, made consistent with Metteyya.
const PATH_EVENTS = {
  'The Fall to Ten Years': { kappa: -(1 * ANTARA), kappaEnd: null },
  'The Rise to Eighty Thousand Years': { kappa: -(METTEYYA_ANTARA * ANTARA), kappaEnd: null }
};

// ── The sensuous heavens ──────────────────────────────────────────────────
// Six deva lifespans were converted from celestial years using 1e12 yr/kappa,
// not the atlas's 1e15 — every one landed a thousandfold too long. They are
// recomputed from the canonical human-year figures (the celestial-day scheme,
// GC/Abhidhamma; see The-Lineage-of-the-Buddhas.html). Placing a celestial-
// year lifespan on a kappa axis assumes a year-length for a kappa the canon
// declines to give, so each is disclosed as indicative.
const SENSUOUS_YEARS = {
  'Devas of the Four Great Kings': 9e6,
  'The Thirty-Three Gods': 3.6e7,
  'The Yāma Devas': 1.44e8,
  'The Contented Devas': 5.76e8,
  'Devas Delighting in Creation': 2.304e9,
  "Devas Wielding Power over Others' Creations": 9.216e9
};
const SENSUOUS_NOTE = 'Given in the texts as celestial years; converted here to human years and then to kappas. That second step assumes a year-length for a kappa the canon does not supply, so read its width as indicative only.';

// ── Load & correct ────────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const report = { placed: [], rejected: [], note: 0 };

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

  let note = e.note ? String(e.note) : undefined;

  // Present-aeon Buddhas → antara-kappa placement.
  const pb = PRESENT_BUDDHAS[name];
  if (pb && e.category === 'The Buddhas') {
    const to = pb.yearsAgo != null ? pb.yearsAgo / YEARS_PER_KAPPA : pb.antaraAgo * ANTARA;
    report.placed.push(`${name}: ${kappa} → ${to} (${pb.era})`);
    kappa = to; kappaEnd = null;
    if (pb.antaraAgo != null) note = ANTARA_NOTE;
  }

  // Gotama's life and the fading of his teaching.
  if (GOTAMA_LIFE_EVENTS[name]) {
    const g = GOTAMA_LIFE_EVENTS[name];
    report.placed.push(`${name}: ${kappa} → ${g.kappa}`);
    kappa = g.kappa; kappaEnd = g.kappaEnd;
  }

  // The path to Metteyya's era.
  if (PATH_EVENTS[name]) {
    const p = PATH_EVENTS[name];
    report.placed.push(`${name}: ${kappa} → ${p.kappa}`);
    kappa = p.kappa; kappaEnd = p.kappaEnd;
  }

  // The Ten to Come: Metteyya at the countable edge of his approach; the rest
  // in order, one future aeon apart, spacing disclosed as convention.
  if (e.category === 'The Ten to Come') {
    if (/Metteyya/.test(name)) {
      kappa = -(METTEYYA_ANTARA * ANTARA); kappaEnd = null; note = METTEYYA_NOTE;
      report.placed.push(`${name}: → ${kappa} (seven antara-kappas + an incalculable rise)`);
    } else {
      const idx = TEN_TO_COME_ORDER.findIndex(n => n === name);
      if (idx < 0) { report.rejected.push(['not in the ten-to-come order', name]); return null; }
      kappa = -(idx + 1); kappaEnd = null; note = FUTURE_NOTE;
      report.placed.push(`${name}: → ${kappa} (order ${idx + 1})`);
    }
  }

  // Sensuous-heaven lifespans, recomputed from human years.
  if (SENSUOUS_YEARS[name] != null && e.category === 'Planes & Lifespans') {
    const end = SENSUOUS_YEARS[name] / YEARS_PER_KAPPA;
    report.placed.push(`${name}: end ${kappaEnd} → ${end}`);
    kappaEnd = end; note = SENSUOUS_NOTE;
  }

  if (note) report.note++;

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
      ? e.confidence : 'traditional',
    note
  };
}).filter(Boolean);

// Deduplicate by name — the fan-out overlapped deliberately.
const seen = new Map();
for (const e of events) {
  const k = e.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!seen.has(k)) seen.set(k, e);
}
events = [...seen.values()].sort((a, b) => b.kappa - a.kappa || a.name.localeCompare(b.name));

// ── Validate ──────────────────────────────────────────────────────────────
// The plane hierarchy must ascend: no sensuous heaven may outlast the Brahmā
// world above it. This is the check that killed the "borrow the Hindu kalpa"
// and "1.28-billion-year" proposals — verify it holds under 1e15.
const RETINUE = 1 / 3;                        // Retinue of Brahmā, in kappas
const topSensuous = Math.max(...Object.values(SENSUOUS_YEARS)) / YEARS_PER_KAPPA;
if (topSensuous >= RETINUE) {
  console.error(`FAIL: highest sensuous heaven (${topSensuous} kappa) outlasts the ` +
    `Brahmā retinue (${RETINUE} kappa). YEARS_PER_KAPPA is too small.`);
  process.exit(1);
}

// ── Emit ──────────────────────────────────────────────────────────────────
const counts = {};
for (const e of events) counts[e.category] = (counts[e.category] || 0) + 1;

const file = `/* Buddhist cosmology — a Deep Time atlas. GENERATED, do not edit by hand.
 * Rebuild with:  node tools/build-atlas-kappa.js
 * Source:        data/sources/kappa.json
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
 * The nested structure IS canonical, and is used for placement: a mahākappa is
 * four asaṅkhyeyya-kappas, each of 64 antara-kappas (GC ~p.2411), so 256
 * antara-kappas in all. The four past Buddhas of this aeon are placed one
 * antara-kappa apart, as the Chronicles count them (GC p.428); Metteyya at the
 * countable edge of a seven-antara-kappa approach whose final rise the texts
 * call incalculable (Dvp, GC p.1670). See tools/build-atlas-kappa.js.
 */
(function () {
  window.DEEP_TIME_ATLASES = window.DEEP_TIME_ATLASES || [];
  window.DEEP_TIME_ATLASES.push({
    id: 'kappa',
    label: 'Buddhist',
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
    ageKey: ' ',
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
console.log(`plane-hierarchy check passed (top sensuous ${topSensuous.toExponential(2)} < retinue ${RETINUE.toFixed(3)} kappa)`);
console.log('\nby thread:');
for (const c of CATEGORIES) console.log(`  ${String(counts[c] || 0).padStart(3)}  ${c}`);
console.log(`\nplacements applied (${report.placed.length}):`);
for (const p of report.placed) console.log('  ' + p);
if (report.rejected.length) {
  console.log(`\nrejected (${report.rejected.length}):`);
  for (const r of report.rejected) console.log('  ' + r.join('  '));
}
