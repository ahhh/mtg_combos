# MTG Combo Explorer

Search a Magic: The Gathering card and see two clearly separated things:

1. **Verified combos** it already belongs to, from Commander Spellbook's curated database.
2. **Combo hypotheses** a deterministic rule engine derives from Oracle text, with the
   proof obligations it could and could not confirm shown in full.

The deployed artifact is one `index.html` plus a static `data/` directory.
No backend, no API keys, no build step, no runtime dependencies.

```
npm install          # jsdom, for the DOM tests only
npm run serve        # http://localhost:8080
npm test             # 64 tests, no network
npm run eval         # measure the engine against the verified corpus
npm run bake         # rebuild data/ from the Commander Spellbook bulk export
```

## Why it is built this way

**The verified layer is baked, not fetched.** Commander Spellbook's REST backend
sends `Access-Control-Allow-Origin` only to its own frontend, so a static page
cannot call it — this is verified with `curl` output in [docs/DATA.md](docs/DATA.md).
Their one CORS-open endpoint is a 629 MB bulk export. So `tools/bake-combos.mjs`
streams that offline and emits sharded, facts-only JSON that the page fetches
from its own origin. One card lookup costs one ~50 KB shard.

We keep the *facts* (which cards, what they produce, legality, popularity) and
drop the *prose* (written steps, prerequisites, notes), linking to Commander
Spellbook for those. The combo data's licence is an open question upstream, and
the prose is the part contributors authored. A test asserts the prose stays out.

**Role catalogues are per-rule, not per-card.** The obvious design — run targeted
Scryfall searches for each card the user looks at — costs 8 requests every time.
Instead each rule template owns one query describing the *partner* it needs
("untaps a permanent", "sacrifices a creature for free"). Those catalogues are
small (20–150 cards), identical for every user and every searched card, and
cached for a week. Analysing a second card usually costs **zero** requests.

**Confidence is a checklist, not a number.** A 0–99 score implies a calibration
this engine does not have. Each template instead lists explicit proof
obligations, each marked met / unknown / unmet with the Oracle phrase that
decided it, and the UI shows that list verbatim:

```
✓ Bloom Tender produces mana when tapped        {T}: Add one mana of any color.
✓ Freed from the Real can untap Bloom Tender    Untap enchanted creature.
✓ Each cycle nets more mana than it costs (+1)  Produces 2, untap costs 1
✓ Freed from the Real is untapped again next cycle
```

One unmet obligation rejects the candidate outright — a broken proof step is a
counterexample, not a discount. Unknowns only downgrade. A parser warning caps
confidence below "strong", because a proof resting on a reading we admit we
distrust should not look confident.

**The default view only shows what the engine actually proved.** Fully proven
hypotheses (`Hypothesis · strong`, zero open obligations) show by default.
Hypotheses with an open question mark (`Hypothesis · unproven`) are hidden
behind a "Show unproven leads" toggle in the Hypotheses tab — off by default —
so the app never presents a guess as a suggestion. With the toggle off and no
strong hypothesis for a card, the app says so and points at the verified
combos instead of filling the gap with a lead.

## Layout

```
index.html                 the entire app: markup, styles, engine
data/                      baked verified-combo shards (regenerate with npm run bake)
tools/bake-combos.mjs      offline bulk -> shards
tools/eval-engine.mjs      engine accuracy against the verified corpus
tools/serve.mjs            local static server
tests/harness.mjs          extracts and loads the module from index.html
tests/*.test.mjs           parser, per-rule fixtures, data integrity, DOM
docs/DATA.md               data sources, CORS findings, shard format
```

`index.html` is one file but not one function: it is sectioned (config,
utilities, DOM, scheduler, cache, clients, parser, rules, engine, state,
rendering, controllers) and everything below the DOM layer is pure and exported
on `globalThis.MTG`. The tests load that module **out of `index.html` itself**,
so the tested code and the shipped code cannot drift.

## Rule templates

| ID | Template | Closes when |
| --- | --- | --- |
| R01 | Mana-positive untap | Partner untaps the engine for less than it taps for, and is itself ready next cycle |
| R02 | Copied untap activation | Copying the untap yields two taps per cycle for one untap plus one copy cost |
| R03 | Self-funding blink | The enter trigger pays for the blink, or the blink is free and repeatable |
| R04 | Reciprocal life feedback | One card turns gain into loss, the other turns loss back into gain |
| R05 | Sacrifice + self-recursion | A free outlet plus a permanent that returns itself |
| R06 | Bounce and recast | The enter trigger's mana covers recast plus bounce cost |

Known gaps: token-copy loops (Kiki-Jiki), cost reduction (Power Artifact), storm
and cast-count payoffs, and any three-card bridge. The engine stays silent on
cards it has no template for rather than guessing.

## Accuracy

`npm run eval` runs real discovery over a set of engine cards and scores it
against the baked corpus:

```
hypotheses:          179
corroborated:         17
known-pair recall:   4/111
```

Recall is low by design: the six templates cover a slice of combo mechanics, and
the 111 known pairs span many families we do not model. Corroboration is a floor,
not a precision rate — a pair absent from the corpus may still be perfectly good.
What the numbers are genuinely for is catching a regression that makes a template
start emitting hundreds of pairs, which is exactly how three real defects were
found during development.

## Deploying

Any static host. GitHub Pages: push and enable Pages on the branch root.
Cloudflare Pages: no build command, output directory `/`.

The Content-Security-Policy in `<head>` pins `connect-src` to Scryfall and
`img-src` to `cards.scryfall.io`. Inline script/style is unavoidable in a
single-file artifact, so those egress limits are the control that matters.

## Attribution

Combo data from [Commander Spellbook](https://commanderspellbook.com/).
Card data and images from [Scryfall](https://scryfall.com/).
Not affiliated with or endorsed by either project, or by Wizards of the Coast.
