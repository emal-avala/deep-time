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
