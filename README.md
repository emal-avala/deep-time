# Deep Time

**→ [emal-avala.github.io/deep-time](https://emal-avala.github.io/deep-time/)**

An interactive timeline of 617 events spanning 13.8 billion years — from the
Big Bang through the dinosaurs, the ice ages, the Buddha and the ancient
empires, to generative AI — readable on **both a linear and a logarithmic time
scale**.

The point of the two scales: on a linear axis, all of recorded human history is
a sliver a few pixels wide at the right edge. On a logarithmic axis that sliver
opens up and the deep past compresses, and you can see the shape of the whole
thing at once. Switching between them is the tool.

## Run

Use the [hosted version](https://emal-avala.github.io/deep-time/), or clone and
open the file directly:

```sh
git clone git@github.com:emal-avala/deep-time.git
cd deep-time && open index.html
```

No server, no build, no dependencies.

## Reading it

**Lanes** run from substrate to superstructure: Cosmos & Earth → Life → Human
Origins → Science & Tech → Culture & Art → Religion & Ideas → Empires. The
physical world first, then life, then humans, then what humans made and
believed, and last how they organised themselves into states. The order isn't
decorative — the staircase of first appearances down the left side is itself
the story, and the things that depend on everything above them sit at the
bottom.

**The strata band** at the top carries the named ages and eras — geological
eons through the Bronze Age, the Middle Ages, the Information Age — stacked so
longer eras sit above the shorter ones nested inside them.

**The density rail** at the bottom counts events per interval. Read it as
attention density, not ground truth: it reflects what this dataset records and
what history preserved, both of which lean heavily toward the recent and the
literate.

### Controls

| | |
|---|---|
| **Scale** | Linear / Logarithmic, plus a slider to scrub continuously between them |
| **Window** | Preset zoom ladder — All time, Dinosaurs, Sapiens, Farming, Century… |
| drag · scroll | pan · zoom |
| `L` · `0` · `Esc` | toggle scale · reset · close panel |
| Search | type to dim everything else; `Enter` jumps to the match |
| Table | every event as sortable text, the accessible path to the same data |

### Deep links

State lives in the URL, so a view can be bookmarked or shared:

```
index.html?scale=linear&window=Sapiens
index.html?from=-3000&to=500&scale=log     # from/to are calendar years
index.html?q=buddha&theme=light
```

### Three things to look for

1. **Switch to linear at "All time."** Everything after the first cell divides
   collapses into the last few pixels. That compression is the honest picture.
2. **Watch the density rail as you switch scales.** Under log time, human
   events spread into a fairly even band — the appearance of steady progress is
   partly an artifact of the scale.
3. **Zoom the Science & Tech lane from "Farming" to "Century."** The gap
   between milestones shortens by orders of magnitude; the lane goes from
   readable to a solid bar of overlapping marks.

## Data

`data/events.js` is generated. Rebuild it with:

```sh
node tools/build-dataset.js
```

It reads `data/sources/` and applies the whole cleaning pipeline: validation,
the adjudicated corrections, de-duplication, sorting.

**How it was compiled.** Twelve domain-historian agents (deep time, human
evolution, the ancient Near East, India and East Asia, classical Mediterranean,
world religions, the medieval world, early modern, industrial and modern, plus
a technology throughline) each produced their era, deliberately overlapping.
Four gap-fill agents then deepened the thinnest lanes. Fifteen auditors
re-derived every date independently and proposed corrections; an adversarial
adjudicator reviewed each proposal with instructions to defend the original
data. Of thirteen proposed corrections, the four date changes were all rejected
as within accepted scholarly range and nine genuine duplicates were removed.
Raw agent output is preserved in `data/sources/raw-events.json`.

**Dates are consensus estimates.** Deep-time and prehistoric figures are
approximate by nature and some are actively debated — the Buddha's dates, the
peopling of the Americas, when hominins controlled fire. Each event carries a
`confidence` field of `exact`, `approximate`, or `debated`. Treat this as a
tool for seeing shape and proportion, not for citing dates.

## Decisions worth remembering

**Time is stored as `bp`** (years before present, present = 2026), not as
calendar years. Both scales map the same `bp` window onto the plot width, so
switching redistributes the interior without moving the endpoints — which is
what makes the morph between them legible rather than disorienting.

**Logarithms can't reach zero**, so "now" is clamped to 1 year ago. The right
edge is the present, and events in the last year pile onto it.

**Canvas, not SVG or DOM.** 617 events with labels re-laid-out on every frame
of a pan, zoom, or scale morph; canvas holds 60fps where a few thousand DOM
nodes would not. The cost is that hit-testing and the accessible view had to be
built by hand — hence the table view.

**Labels are packed per lane on every frame** into three sub-rows, degrading
gracefully: labelled → unlabelled mark → a tick on the lane's density rail.
Every event always leaves a mark, even where no label fits, so the shape of a
dense period stays honest.

**Colour was validated, not chosen by eye.** The seven category hues clear
CVD-separation, contrast, and lightness-band checks against both the light and
dark surfaces. Text drawn on a coloured bar picks black or white by computing
both contrast ratios — a lightness threshold picks white on mid-tone pink,
which measures 2.7:1. There is deliberately no UI accent colour: the data owns
all the colour on the page.

## Reckonings of time

The timeline is not tied to one cosmology. The renderer knows nothing about
years, kappas or baktuns - it only knows *distance from now on a log axis*.
Each tradition supplies its own units, threads and data as a **drop-in atlas**.

Three ship today:

| Atlas | Shown as | Unit | Span |
|---|---|---|---|
| `physical` | Modern | years | 13.8 Ga to now |
| `kappa` | Buddhist | mahakappas | 10^6 to 10^-13 kappas |
| `yuga` | Hindu | years | 311 trillion years to now |

Switch with the **Modern / Buddhist / Hindu** toggle in the header, or with
`?atlas=kappa`. Buttons name the tradition rather than its unit, since the unit
is already on the axis.

### Adding a tradition

Create `data/atlases/<id>.js` and add a `<script>` tag for it in `index.html`.
Nothing else in the app changes.

```js
window.DEEP_TIME_ATLASES = window.DEEP_TIME_ATLASES || [];
window.DEEP_TIME_ATLASES.push({
  id: 'yuga',
  label: 'Yuga',
  tradition: 'Hindu cosmology',
  thesis: 'One sentence shown as the page subtitle.',
  unit: 'years',
  nowLabel: 'now',

  scale: 'unitsBeforePresent',   // or 'signedYears'
  field: 'year',                 // record field holding the position
  format: 'years',               // which formatter labels the axis

  ceil: 3.11e14, floor: 1,       // outer bounds of the axis
  home: [3.11e14, 1],            // the view it opens on
  ageKey: 'Ages',                // category routed to the strata band
  tickGap: 96,                   // px between axis labels

  categories: [ { key: 'Yugas', label: 'Yugas', v: '--c1' } /* up to 7 */ ],
  ladder:     [ { label: 'All of it', max: 3.11e14, min: 1 } ],
  events:     [ /* records */ ]
});
```

**Scale strategies** turn a tradition's own units into distance from now:

- `signedYears` - records carry `start`/`end` as signed calendar years
  (negative BCE). Used by `physical`.
- `unitsBeforePresent` - records already count backwards from now in the
  tradition's unit, named by `field` (`kappa`/`kappaEnd`, `baktun`/`baktunEnd`).
  A negative value means *still to come*: it is plotted by how far ahead it lies
  and flagged, because a logarithm has no negative side.

**Formatters** live in `FORMATS` in `app.js`. `years` and `kappas` exist; a new
unit adds one function. Below one unit the kappa formatter switches to
exponents (`10^-6 kappa`), since the whole point of these axes is that the
numbers stop being readable in decimal.

Each record needs `name`, `category`, the position field, `kind`
(`moment`/`period`/`age`), `description`, `significance` and `confidence`.
Everything else - search, the table, the detail panel, mobile, linear/log - is
inherited.

### On honesty across traditions

These cosmologies do not agree, and the app must not pretend they do. Each
atlas keeps its own confidence vocabulary: the scientific one uses
`exact`/`approximate`/`debated`; the Buddhist one uses
`canonical`/`traditional`/`derived`, because the distinction that matters there
is whether a claim is *in the suttas*, in the commentaries, or a modern
calculation.

The Hindu scheme is the opposite case, and worth stating plainly: where the
Pali canon refuses a number, the Puranas are exact and internally consistent.
The build script for that atlas **refuses to emit** unless the chain closes -
1,728,000 + 1,296,000 + 864,000 + 432,000 = 4,320,000; 1,000 mahayugas = one
kalpa; 14 manvantaras plus 15 junctions tile that kalpa exactly; 100 years of
Brahma = 311,040,000,000,000 years. A tradition that gives you a checkable
number should be checked.

That last category earns its keep. The Pali canon **refuses** to put a number
of years on a kappa - asked directly, the Buddha answered with two similes
instead (SN 15.5, a mountain worn away by a passing silk cloth; SN 15.6, a city
of mustard seeds emptied one seed a century). Every year-figure in the kappa
atlas is therefore a modern derivation and is marked as one. Placing a
tradition on an axis should not quietly convert its refusals into numbers.
