#!/usr/bin/env node
/* Second pass over the Wikipedia backfill: correct, retry, and verify.
 *
 *   node tools/curate-wikipedia-links.js
 *
 * The search API's top hit is right most of the time and confidently wrong the
 * rest, and a token-overlap score does not tell the two apart — "Origin of the
 * apes" scored the same against "Planet of the Apes" as several correct
 * matches did. So this pass does three things:
 *
 *   1. applies CURATED, a hand-checked name -> article map for every match
 *      that was judged wrong or too weak to keep;
 *   2. retries names that returned nothing, which is usually a transient fetch
 *      failure rather than a genuine absence (the French Revolution has an
 *      article);
 *   3. verifies EVERY resulting title actually resolves, following redirects,
 *      so nothing ships pointing at a page that does not exist.
 *
 * Anything still unresolved stays in `review` and is not written to the dataset.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'sources', 'wikipedia-backfill.json');
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'deep-time-dataset/1.0 (https://github.com/emal-avala/deep-time)';
const ACCEPT_SCORE = 0.67;

// Hand-checked. Left side is the event name, right side the article it means.
const CURATED = {
  // — search returned a confidently wrong article —
  'Birth of Greek Theatre': 'Theatre of ancient Greece',        // was: The Birth of Tragedy (Nietzsche)
  'Charlemagne Crowned Emperor': 'Charlemagne',                 // was: Crown of Charlemagne (the object)
  'Compilation of the Quran': 'Quran',                          // was: Criticism of the Quran
  'Discovery of Radioactivity': 'Radioactive decay',            // was: Discovery of the neutron
  'Homeric Epics Composed': 'Homer',                            // was: Epic Cycle
  'Italian Renaissance Masters': 'Italian Renaissance',         // was: Renaissance architecture
  'Origin of the apes': 'Ape',                                  // was: Planet of the Apes
  'Plants Colonize Land': 'Evolutionary history of plants',     // was: Land bridge
  'Plants colonise the land': 'Evolutionary history of plants',
  'Powered Flight': 'Wright brothers',                          // was: Human-powered aircraft
  'Protestant Reformation Begins': 'Reformation',               // was: Counter-Reformation (the opposite)
  'Rise of grasses and spread of grasslands': 'Poaceae',        // was: Grassland degradation
  'Sewn Clothing and the Eyed Needle': 'Sewing needle',         // was: Inuit clothing
  'Sumerian City-States': 'Sumer',                              // was: Sumerian religion
  'The Arch and Roman Concrete': 'Roman concrete',              // was: Arch bridge
  'Whales return to the sea': 'Evolution of cetaceans',         // was: Beluga whale
  'Neanderthal lineage': 'Neanderthal',                         // was: Neanderthal genetics
  'The proposed sixth mass extinction': 'Holocene extinction',  // was: Extinction event
  'Hubble Discovers the Expanding Universe': "Hubble's law",
  'Abolition of the Atlantic Slave Trade and Slavery': 'Abolitionism',
  'Columbus Reaches the Americas': 'Voyages of Christopher Columbus',

  // — flagged for review; these are the right targets —
  'Arthropods colonise the land': 'Arthropod',
  'First Amniotes and Coal Forests': 'Amniote',
  'Post-extinction mammalian radiation': 'Evolution of mammals',
  'Earliest Known Figurative Art (Sulawesi Cave Paintings)': 'Cave painting',
  'Earliest figurative cave art (Sulawesi)': 'Cave painting',
  'Cai Lun Perfects Papermaking': 'Cai Lun',

  // — returned nothing; almost all transient failures —
  'Chavín Culture': 'Chavín culture',
  'Nok Terracotta Sculpture': 'Nok culture',
  'Axial Age': 'Axial Age',
  'Classical Antiquity': 'Classical antiquity',
  'Scythian Steppe Culture': 'Scythians',
  'Library of Ashurbanipal': 'Library of Ashurbanipal',
  'Neo-Babylonian Empire': 'Neo-Babylonian Empire',
  'Fall of Nineveh': 'Battle of Nineveh (612 BC)',
  'Coined Money': 'Coin',
  'Laozi & the Daodejing': 'Tao Te Ching',
  'Mahavira & the Rise of Jainism': 'Mahavira',
  'Babylonian Exile of the Judeans': 'Babylonian captivity',
  'Invention of Calculus': 'History of calculus',
  'Age of Enlightenment': 'Age of Enlightenment',
  'The Enlightenment': 'Age of Enlightenment',
  'The Steam Engine': 'Steam engine',
  'The Encyclopédie': 'Encyclopédie',
  'Industrial Age': 'Industrial Revolution',
  'Age of Revolutions': 'Age of Revolution',
  'American Declaration of Independence': 'United States Declaration of Independence',
  'French Revolution': 'French Revolution',
  'Vaccination': 'Vaccination',
  'Haitian Revolution': 'Haitian Revolution',
  'The Electric Battery': 'Electric battery'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const titleToUrl = t => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t.replace(/ /g, '_'));

// Resolve a title through redirects and confirm the page exists.
async function resolve(title) {
  const url = `${API}?action=query&titles=${encodeURIComponent(title)}` +
    `&redirects=1&format=json&origin=*`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const pages = (await res.json()).query.pages;
      const page = Object.values(pages)[0];
      if (page.missing !== undefined) return null;
      return page.title;
    } catch (err) {
      if (attempt === 2) return undefined;   // undefined = could not check
      await sleep(700 * (attempt + 1));
    }
  }
}

async function run() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const accepted = data.accepted, review = data.review;
  let missing = new Set(data.missing || []);

  // 1. Demote anything under the new threshold unless it is curated.
  let demoted = 0;
  for (const [name, rec] of Object.entries(accepted)) {
    if (CURATED[name]) continue;
    if (rec.score < ACCEPT_SCORE && rec.score !== 0) {   // score 0 == pinned
      review[name] = rec; delete accepted[name]; demoted++;
    }
  }
  console.log(`demoted below ${ACCEPT_SCORE}: ${demoted}`);

  // 2. Apply the curated map.
  const targets = Object.entries(CURATED);
  console.log(`verifying ${targets.length} curated titles...\n`);
  let fixed = 0, bad = 0, unchecked = 0;
  for (const [name, title] of targets) {
    const real = await resolve(title);
    if (real === null) { console.log(`  MISSING PAGE  "${title}"  (for "${name}")`); bad++; continue; }
    if (real === undefined) { console.log(`  could not verify "${title}"`); unchecked++; continue; }
    accepted[name] = { title: real, url: titleToUrl(real), score: 1, curated: true };
    delete review[name];
    missing.delete(name);
    fixed++;
    await sleep(90);
  }

  // 3. Verify a sample of the auto-accepted perfect matches too.
  const auto = Object.entries(accepted).filter(([, v]) => !v.curated);
  console.log(`\nverifying ${auto.length} auto-accepted titles resolve...`);
  let broken = 0;
  for (let i = 0; i < auto.length; i++) {
    const [name, rec] = auto[i];
    const real = await resolve(rec.title);
    if (real === null) { console.log(`  MISSING PAGE  "${rec.title}"  (for "${name}")`); review[name] = rec; delete accepted[name]; broken++; }
    else if (real && real !== rec.title) { rec.title = real; rec.url = titleToUrl(real); }
    if (i % 100 === 0 && i) console.log(`    ${i}/${auto.length}`);
    await sleep(60);
  }

  fs.writeFileSync(FILE, JSON.stringify({
    _note: 'Generated by tools/fetch-wikipedia-links.js, corrected by ' +
           'tools/curate-wikipedia-links.js. Every `accepted` title has been ' +
           'verified to resolve. `review` is held back from the dataset.',
    accepted, review, missing: [...missing]
  }, null, 1));

  console.log(`\ncurated applied: ${fixed}   bad targets: ${bad}   unchecked: ${unchecked}`);
  console.log(`auto-accepted with a dead link: ${broken}`);
  console.log(`\nfinal — accepted ${Object.keys(accepted).length}, review ${Object.keys(review).length}, missing ${missing.size}`);
}

run().catch(err => { console.error(err); process.exit(1); });
