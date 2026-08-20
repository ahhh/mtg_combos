# Plan review: what changed and why

Review of `MTG_Combo_Explorer_Build_Plan.md` by way of building it. Everything
below is a change I made to the plan after evidence, not a matter of taste. The
original plan is sound in its instincts — two trust layers, bounded search,
precision over recall — and I kept all three. What follows is where reality
disagreed with the specifics.

Each item is marked with how it was established.

---

## 1. The P0 gate the plan defined actually fails · **verified with curl**

The plan's go/no-go gate was: prove both APIs are usable from a static origin.
Scryfall passes cleanly (`Access-Control-Allow-Origin: *`).

**Commander Spellbook does not.** Its REST backend echoes an ACAO header only
for its own frontend:

```
Origin: https://example.github.io      -> (no access-control header at all)
Origin: https://commanderspellbook.com -> access-control-allow-origin: https://commanderspellbook.com
```

So §5.2's design — `GET https://backend.commanderspellbook.com/variants/?q=card:"…"`
from the browser, cached 24h in IndexedDB — cannot work from a deployed static
page. Nor can §9.4's per-candidate novelty check, which was to hit that same
endpoint once per candidate.

The plan anticipated this ("If either core API blocks browser CORS, stop and
revisit the strictly-no-backend requirement") but treated it as unlikely. It is
not unlikely; it is the actual state of the API.

**Resolution.** Keep the no-backend rule, move the verified layer offline. Their
one CORS-open source is the bulk export, which is 629 MB (27 MB gzipped) — the
plan was right to forbid fetching that at runtime. So `tools/bake-combos.mjs`
streams it once, offline, and emits sharded JSON served from our own origin.

This is a real amendment to the north-star: **one `index.html` plus static data
assets**, not one file alone. The constraint that mattered — no server, no
secrets, no runtime build, free static hosting — is fully preserved, and the app
degrades gracefully when `data/` is absent. The single-file dogma was a proxy
for those goals, and it was costing the product its entire verified layer.

## 2. Bundling combo data needs a licence-shaped answer, not a size-shaped one

§5.2 says "do not bundle a full copy of the combo database" and §16 flags the
open licence question ([backend#1211]). Baking the index means bundling
*something*, so the line has to be drawn deliberately rather than by accident.

**Resolution.** Bake the *facts* — which cards combo, what they produce, colour
identity, legality, popularity, upstream id. Drop the *prose* — `description`
(the written steps, 46 MB across the corpus), `easyPrerequisites`,
`notablePrerequisites`, `notes` — and deep-link to Commander Spellbook for it.
That is also the honest split: the prose is what contributors authored.
`tests/data.test.mjs` asserts the prose columns never reappear in a shard.

## 3. Query planning should be per-rule, not per-card · **measured**

§8.4 plans 3–8 targeted Scryfall searches *per analysed card*, budgeted at 8
requests and ~150 candidates per run. That is 8 requests for every card any user
looks at, forever.

Measuring the actual role queries shows why that is unnecessary:

| Partner role | Cards |
| --- | --- |
| Untaps a permanent | 57 |
| Untaps an artifact | 23 |
| Copies an activated ability | 26 |
| Free sacrifice outlets | 150 |
| Blink effects | 20 |

**The enabler space is tiny and slow-moving.** The card the user searches varies;
the set of cards that can untap a permanent does not. So the query belongs to the
*rule template*, not to the selected card. Catalogues are fetched once, cached
for a week, and shared across every card and every session — analysing a second
card typically costs **zero** requests. This also removes the combinatorial
explosion risk in §16 by construction rather than by budget.

The plan's budgets are kept as a backstop, not as the primary mechanism.

## 4. Numeric confidence bands are false precision · **design change**

§9.1 and the 90–99 / 75–89 / 60–74 table imply a calibrated probability. Nothing
in a regex-based Oracle parser justifies the difference between 91 and 88, and a
number invites users to trust it more than the evidence supports.

**Resolution.** Each template lists explicit **proof obligations** — the claims
the loop depends on — each `met` / `unknown` / `unmet` with the Oracle phrase
that decided it. The band is derived:

- any `unmet` → **rejected** (a broken proof step is a counterexample, not a discount)
- 0 unknowns, no blockers → **strong**
- ≤1 unknown → **unproven**
- otherwise → **lead**, hidden by default

The UI renders the checklist verbatim, so the user audits the reasoning instead
of trusting a score. This is also what makes the templates unit-testable: a test
asserts *which obligation* failed, not that a number crossed a threshold.

Added on top: **a parser warning caps confidence below "strong"**. If we admit we
may have misread a card (transforming faces, modal abilities), the proof rests on
a reading we distrust, and it should not look confident.

## 5. The novelty check is free, not a request per candidate

§9.4 proposes querying Commander Spellbook per high-confidence candidate to check
novelty. Besides being CORS-blocked, it is unnecessary: we already hold every
verified combo for the selected card. Membership is a local `Set` lookup.

Improved slightly on the plan: the index also stores every *pair inside* a larger
combo, so a two-card hypothesis that is a strict subset of a known three-card
line is correctly marked as already known.

## 6. Missing from the plan entirely: split and double-faced cards

Double-faced cards have no top-level `oracle_text`; it lives in `card_faces[]`.
The plan's data model (§4.2 `CardRef`) assumes a flat `oracleText` and never
mentions faces. This is the single most common crash source in any Scryfall
consumer. Faces are now flattened once at the client boundary, and a test covers
it.

## 7. Effort estimate

§15.1's "7–12 concentrated engineering days" for a six-template MVP is about
right for the search and verified layers plus a *first pass* at the engine. It
understates the engine tail: the parser and proof work is not front-loaded, it is
a long stream of specific wording defects, each cheap and each invisible until
you measure. See below.

---

## What building it found that no plan review would have

These are defects in the *implementation*, but each is a lesson about the design.
All were caught by the corpus evaluation (§ below) rather than by unit tests
written from the plan.

1. **One-shot spells were being proposed as loop engines.** Every blink template
   happily suggested Cloudshift and Ephemerate against every creature with an ETB
   trigger. An instant or sorcery resolves once; it can *enable* a loop but never
   *be* one. Adding that single check cut one template's output by 73%.

2. **The cycle must restore every permanent it consumes, not just the headline
   one.** An untapper that taps itself as a cost (Clock of Omens, Aphetto
   Alchemist) is spent after one use. The plan's Appendix A.1 states this
   correctly — "all required reusable state is restored" — and it is exactly the
   check a naive implementation omits, because the mana arithmetic looks fine.

3. **A case-sensitive regex silently demoted most sacrifice outlets.** Costs are
   capitalised at line start, so `Sacrifice a creature: Add {C}{C}` was parsed as
   static text, not an activated ability. Ashnod's Altar had *no roles at all*.

4. **Aura untappers were invisible.** They say "untap enchanted creature", not
   "untap target creature". Requiring the word "target" excluded the single most
   common two-card untap engine family. Fixing it is what made Bloom Tender
   surface Freed from the Real and Pemmin's Aura — the real combos — as its top
   two results.

5. **"Add one mana of that color"** did not parse ("any color" did), so
   Bloom Tender produced zero hypotheses.

6. **The mana maths for copied activations was wrong in both directions.**
   Copying an untap gives *two* untaps per cycle, so the engine taps twice — and
   the copy's `{2}` lives inside a triggered ability's "you may pay" clause, not
   as an activation cost. Getting either wrong misprices Basalt Monolith + Rings
   of Brighthearth, the plan's own worked example. Correct answer: +1 per cycle.
   Grim Monolith + Rings is exactly 0, and must be rejected.

Every one is now a named regression fixture.

## Testing: use the corpus as ground truth

§14.2 asks for three fixtures per template. That is necessary and it is done —
positive, near-miss, wording variant, with the near-misses carrying the weight.

But there are 105,271 curated combos sitting right there. `tools/eval-engine.mjs`
runs real discovery over a set of engine cards and scores against them:

```
hypotheses:          179
corroborated:         17
known-pair recall:   4/111
per rule:  R01 126/12   R02 26/3   R03 24/0   R04 3/2
```

Recall is low by design — six templates cover a slice of combo mechanics. The
number to watch is the per-rule emission count: every defect above showed up
first as a template emitting far more than its siblings. This is a far stronger
regression signal than a hand-written fixture table, and it costs one command.

Also worth stating plainly, as the plan does not: **corroboration is a floor, not
a precision rate.** A pair absent from the corpus may be a perfectly good combo
nobody submitted. That asymmetry is the whole reason the UI says "not found in
the verified index" rather than "new".

## Smaller corrections

- **Scryfall rate limit.** 120 ms spacing (§10.1's "110–125 ms") got us
  rate-limited during evaluation; Scryfall limits bursts, not just averages.
  Raised to 150 ms (~6.6/s).
- **User-Agent.** §5 notes browsers cannot set it. True, and fine — browsers send
  a real one. But Scryfall *rejects* Node's default UA outright, so any offline
  tooling must set one. The plan treats this as a browser caveat only.
- **CSP.** §11.1 defers it. `connect-src` and `img-src` are the controls that
  actually matter here and are fully compatible with inline code, so they ship
  now rather than after "endpoint validation".
- **Ligatures.** `Æther Vial` loses its first letter under NFKD plus punctuation
  stripping. Real card names, real bug.
- **Combos-per-card is heavily skewed.** Median 9, p90 106, max 6,021. Capping at
  60 per card cut the payload 60% while affecting 1,323 of 7,378 cards, all of
  which show a true total and a link out.

## What I did not change

- Two visually separate trust layers. Correct, and the most important decision in
  the document.
- "Not found in Commander Spellbook", never "new combo".
- Bounded analysis with an explicit budget and progressive rendering.
- Judging the engine more harshly on false positives than on misses.
- Deferring three-card bridges until two-card precision is acceptable. It still
  is not — R03 corroborates nothing and R01 emits more than it should.

[backend#1211]: https://github.com/SpaceCowMedia/commander-spellbook-backend/issues/1211
