> ## Status: superseded in part — this plan has been built
>
> Reviewed and implemented on 2026-08-20. The working application is `index.html`;
> see `README.md` to run it and **`docs/PLAN_REVISIONS.md` for the full review**.
>
> Four corrections you should read before trusting anything below:
>
> 1. **§5.2 / §7 / §9.4 do not work as written.** Commander Spellbook's REST
>    backend sends no `Access-Control-Allow-Origin` to third-party origins, so a
>    static page cannot call it from the browser. This plan's own P0 go/no-go gate
>    fails. The verified layer is now baked offline by `tools/bake-combos.mjs`
>    into static shards. Evidence in `docs/DATA.md`.
> 2. **The north-star changed to "one `index.html` plus static data assets."**
>    No server, no secrets, no runtime build, free static hosting — all preserved.
>    The single-file rule was a proxy for those, and it was costing the product
>    its entire verified layer.
> 3. **§8.4's per-card query planning is replaced by per-rule role catalogues.**
>    The enabler space is tiny (20–150 cards per role) and identical for every
>    user, so catalogues are fetched once and cached. Analysing a card normally
>    costs zero requests instead of eight.
> 4. **§9.1's numeric confidence bands are replaced by proof obligations.**
>    A 0–99 score implies a calibration this engine does not have. Each template
>    now lists the claims the loop depends on, marked met / unknown / unmet with
>    the Oracle phrase that decided it, rendered verbatim in the UI.
>
> The document's core instincts — two separated trust layers, bounded search,
> precision over recall, never say "new combo" — were right and are unchanged.
>
> (This file is a pandoc export and contains conversion artifacts such as
> `\###` and `{=html}`. Left as-is; it is a historical record now.)

---

MTG COMBO EXPLORER Principal Engineering & Product Design Plan A
single-file HTML + JavaScript application for verified and newly
inferred Magic: The Gathering combos Prepared: August 20, 2026 Status:
Build-ready proposal

Important: "new combo" must be presented as a hypothesis, not a fact.
The product can prove some rule-template loops, but it cannot guarantee
global novelty or rules correctness without human verification.

## Contents

1.  Executive Summary
2.  Product Definition and Success Criteria
3.  User Experience and Interaction Design
4.  System Architecture: One Static HTML File
5.  External Data and API Strategy
6.  Fuzzy Card Search and Suggestions
7.  Verified Combo Retrieval
8.  Novel Combo Discovery Engine
9.  Confidence, Proof, and False-Positive Control
10. Performance, Caching, and Rate Discipline
11. Security, Privacy, Accessibility, and Resilience
12. Deployment and Free Hosting
13. Implementation Structure and Pseudocode
14. Testing Strategy
15. Delivery Roadmap and Acceptance Criteria
16. Risks and Mitigations
17. Recommended MVP Scope Appendix A. Initial Rule Template Catalog
    Appendix B. Source References and Verification Notes

## 1. Executive Summary

This project is feasible as a completely static, zero-cost-to-host web
application. The best architecture is not to attempt general-purpose
natural-language understanding of every Magic card. Instead, the
application should combine a trusted curated source for known combos
with a constrained, explainable rules engine for discovering plausible
loops around a selected card.

## 2. Product Definition and Success Criteria

### 2.1 Primary user job

A player searches for one Magic card and immediately learns: (1) which
established combos use it, (2) which other cards are mechanically
promising partners, and (3) why a proposed loop may work or fail. \###
2.2 Goals - Find a card quickly even when the user types only part of
the name or makes a typo. - Show verified combos involving the selected
card with clear cards, prerequisites, steps, and outcomes. - Generate
plausible two-card combo hypotheses from Oracle text and targeted
candidate searches. - Add three-card "bridge" hypotheses after the
two-card engine is reliable. - Explain every candidate in terms of
resources, triggers, repeatability, and blockers. - Remain useful on
mobile, keyboard-accessible on desktop, and fast on ordinary
connections. - Require no user account, no API key, no server, and no
paid hosting. - Be resilient to transient API failure using caching,
progressive results, and clear degraded states. \### 2.3 Non-goals for
v1 - Proving every possible Magic rules interaction. Comprehensive MTG
rules reasoning is too broad for a small deterministic browser engine. -
Claiming a combo is genuinely unprecedented. The application can only
say it was not found in the sources it checked. - Deck construction,
collection tracking, pricing optimization, or account synchronization. -
Running a large generative AI model in-browser. That would increase
download size, complexity, and unpredictability. - Downloading the
entire Scryfall bulk corpus on first load. Current Oracle-card bulk
exports are far too large for a lightweight single-page experience. \###
2.4 Product-level success metrics

## 3. User Experience and Interaction Design

### 3.1 Primary flow

1.  Landing state focuses a single large search input: "Search a Magic
    card..."
2.  After 2--3 characters, show up to 10 name suggestions. Arrow keys
    move selection; Enter accepts; Escape closes.
3.  If the user presses Enter on free text, use fuzzy named lookup to
    resolve the best card.
4.  Selection creates a persistent card header with image, name, mana
    cost, type line, Oracle text, color identity, and legality summary.
5.  Load "Verified combos" and "Potential combos" concurrently. Known
    combos should usually appear first; novel analysis can progressively
    populate.
6.  Each result can expand to show exact steps/reasoning, prerequisites,
    blockers, source status, and outgoing source links.
7.  Filters remain lightweight: number of cards, result type, commander
    legality, selected card color identity compatibility, and
    confidence. \### 3.2 Screen hierarchy
    ┌──────────────────────────────────────────────────────────────┐ │
    MTG Combo Explorer \[About\] │ │ \[ Search a card... ⌕ \] │ │
    Lightning Greaves │ │ Lightning Bolt │ │ Lightning Crafter │
    ├──────────────────────────────────────────────────────────────┤ │
    SELECTED CARD │ │ \[card image\] Basalt Monolith {3} │ │ Artifact │
    │ Oracle text... │
    ├──────────────────────────────────────────────────────────────┤ │
    \[Verified combos 12\] \[Potential combos 8\] │ │ │ │ VERIFIED │ │
    Rings of Brighthearth + Basalt Monolith │ │ Infinite colorless mana
    \[View steps\] │ │ │ │ POTENTIAL • HIGH CONFIDENCE │ │ Candidate
    Card + Basalt Monolith │ │ Why it may loop: ... │ │ Potential
    blocker: ... \[Verify\] \[Open Scryfall\] │
    └──────────────────────────────────────────────────────────────┘
    \### 3.3 Visual language

-   Use system fonts only so the page remains self-contained and fast.
-   Use one dark neutral surface, one teal interaction accent, and a
    muted gold verification accent. Do not rely on Magic color identity
    colors as the only status cue.
-   "Verified" gets a shield/check icon plus text. "Potential" gets a
    spark/flask icon plus explicit confidence text.
-   Cards should be readable without images; imagery is enhancement, not
    structure.
-   On mobile, stack the card header and result list; keep search pinned
    near the top while typing. \### 3.4 Trust-oriented result design

## 4. System Architecture: One Static HTML File

The production artifact should be exactly one index.html. CSS lives in a
```{=html}
<style>
```
block and JavaScript in a single
```{=html}
<script type="module">
```
block. The JavaScript should still be architected as small
modules/classes inside the file; "one file" must not become "one
unstructured function." index.html ├─
```{=html}
<head>
```
│ ├─ metadata / viewport / CSP (after endpoint validation) │ └─
```{=html}
<style>
```
design tokens + responsive UI ├─
```{=html}
<body>
```
│ └─ #app semantic shell └─
```{=html}
<script type="module">
```
├─ constants + configuration ├─ utilities / escaping / normalization ├─
request scheduler + cache ├─ ScryfallClient ├─ SpellbookClient ├─
SearchController ├─ OracleFeatureExtractor ├─ CandidateQueryPlanner ├─
ComboRuleEngine ├─ ComboScorer ├─ state store ├─ renderer / view
controllers └─ bootstrap + optional self-tests \### 4.1 Logical
components

### 4.2 Internal data model

CardRef = { oracleId, scryfallId, name, manaCost, manaValue, colors,
colorIdentity, typeLine, oracleText, legalities, imageUri, scryfallUri }

KnownCombo = { source: "commander-spellbook", sourceId, cards\[\],
prerequisites\[\], steps\[\], results\[\], verified: true, sourceUri }

FeatureSet = { zones, activations\[\], triggers\[\], staticEffects\[\],
produces\[\], consumes\[\], repeatability\[\], constraints\[\],
keywords\[\], parserWarnings\[\] }

CandidateCombo = { cards\[\], ruleId, confidence, proofSummary,
prerequisites\[\], blockers\[\], outputs\[\], foundInSpellbook:
false\|true\|unknown, parserEvidence\[\], sourceQueries\[\] } \## 5.
External Data and API Strategy \### 5.1 Scryfall --- canonical card
layer Use Scryfall as the canonical card-name and Oracle-text service.
It is a public API with no key. Scryfall asks API consumers to remain
under 10 requests per second and recommends bulk data for large
workloads. This design deliberately avoids bulk download in the normal
path and schedules network calls conservatively.

### 5.2 Commander Spellbook --- verified combo layer

Commander Spellbook describes itself as a combo database/search engine
and exposes a public REST backend consumed by its frontend. Search known
combos by exact quoted card name through the variants endpoint, paginate
carefully, and transform responses into the stable KnownCombo model
before rendering. GET https://backend.commanderspellbook.com/variants/
?q=card:"`<canonical card name>`{=html}" legal:commander
&limit=`<bounded page size>`{=html} &offset=`<pagination>`{=html} -
Cache known-combo searches for 24 hours in IndexedDB. - Always show
visible attribution and a direct link to the source combo/search. - Do
not treat the API schema as immutable; isolate mapping in
SpellbookClient. - Do not bundle a full copy of the combo database into
index.html. - Before commercialization or redistributing cached combo
data, resolve the currently open question about the license of the combo
data separately from the MIT-licensed source code. \### 5.3 Why not use
a paid or AI API? Any service that requires a secret API key is
incompatible with a truly client-only public HTML page because the key
would be visible to every visitor. A deterministic local engine
preserves the free-hosting requirement, makes reasoning inspectable, and
avoids cost/abuse controls. AI can be an optional future mode only if
the architecture later permits a backend or user-supplied key. \## 6.
Fuzzy Card Search and Suggestions \### 6.1 Search algorithm 1. Normalize
input for local comparison: Unicode normalize, trim, collapse
whitespace, lowercase for scoring only. Preserve original text for API
calls. 2. After 2 characters and \~150 ms debounce, request Scryfall
autocomplete. Store prefix results in a small in-memory LRU and
IndexedDB/session cache. 3. Rank returned names locally: exact prefix \>
token prefix \> substring \> edit-distance-like similarity. Do not
replace Scryfall's matching logic; only order its bounded suggestions.
4. When the user navigates with arrow keys, do not make additional
card-detail calls. Fetch details only after selection. 5. On Enter with
no explicit suggestion selected, call /cards/named?fuzzy=. If
successful, replace the input with canonical card.name. 6. Use
AbortController to cancel requests for older prefixes so fast typing
does not produce out-of-order UI updates. \### 6.2 Suggestion design
requirements - Show 8--10 suggestions maximum; this is a decision
surface, not a search result page. - Highlight the matched substring
visually but keep the full accessible name in plain text. - Use
role="combobox", aria-expanded, aria-controls, aria-activedescendant,
and a listbox/option pattern. - Keep recent successful searches locally
and show them when the field is focused but empty. - If autocomplete
fails, preserve Enter-to-fuzzy behavior and show a subtle offline/API
warning instead of blocking the user. \### 6.3 URL/share behavior Use
history.replaceState/pushState with a stable URL parameter such as
?card=`<oracle_id>`{=html} when possible. A shared link can reload the
same card by ID/name. Do not store analysis results in the URL;
recompute or restore from cache. \## 7. Verified Combo Retrieval \###
7.1 Query and normalization 1. Use the canonical Scryfall card name in a
quoted Commander Spellbook card filter. 2. Fetch enough pages to produce
a useful result set, but enforce a hard maximum to prevent accidental
unbounded retrieval. 3. Dedupe variants when the API exposes equivalent
grouped combos; preserve source IDs and original source links. 4.
Normalize outputs into result tags such as infinite mana, infinite
damage, infinite ETB/LTB, infinite draw, win the game, lock, or other.
5. Keep full source prerequisites/steps available in an expandable
detail panel. Never regenerate or "improve" verified steps with the
hypothesis engine. \### 7.2 Sorting verified combos

## 8. Novel Combo Discovery Engine

This is the differentiating feature. It should be built as a bounded
search-and-proof system, not an unconstrained text similarity system.
The selected card is parsed into features. Those features select a small
set of mechanical rule templates. Each rule template emits targeted
Scryfall queries for complementary cards. Returned candidates are parsed
and evaluated against the template. Only candidates that meet a minimum
proof threshold are shown as potential combos. \### 8.1 Pipeline
Selected Card ↓ OracleFeatureExtractor ↓ FeatureSet (costs, outputs,
triggers, repeatability, constraints) ↓ Relevant Rule Templates ↓
CandidateQueryPlanner ↓ 3--8 targeted Scryfall searches (bounded) ↓
Candidate pool (dedupe by oracle_id) ↓ Parse candidate features ↓
RuleEngine pair proof / blocker checks ↓ Exclude or mark combos found in
Commander Spellbook ↓ Score + explain + render progressively \### 8.2
Feature ontology

### 8.3 Parsing strategy

Do not try to implement the entire Comprehensive Rules grammar. Start
with high-value Oracle text patterns and make every extraction
traceable. Each parser rule should return the exact phrase that
triggered it, the normalized feature, and a confidence flag. Example
parser rule (conceptual): pattern: /{T}: Add {C}{C}{C}/ → activation {
costs: \[tap(self)\], produces: \[mana(colorless, 3)\], repeatability:
"activated" }

pattern: /Pay {3}: Untap \~/ → activation { costs: \[mana(any, 3)\],
produces: \[untap(self)\], repeatability: "activated" } \### 8.4
Candidate query planning The engine should never search "all cards that
are vaguely similar." Each rule template declares the partner
capabilities it needs and one or more Scryfall query patterns. Queries
should be broad enough to find wording variations but narrow enough to
keep result sets small.

### 8.5 Two-card proof templates first

Two-card detection should be the first production target because it
gives the highest precision for the smallest search space. Each template
is a small proof function with explicit preconditions, transition
sequence, resource delta, and blockers. - Mana-positive untap loop. -
Cast/bounce/recast loop with net-positive mana or a repeated cast/ETB
payoff intrinsic to the two cards. - Reciprocal life-gain/life-loss
trigger loop. - Self-returning permanent + sacrifice outlet that
restores its own cost while creating an increasing output. -
Copy-ability loop where copying produces additional untap/activation
value and the resource balance is nonnegative. - Repeatable blink/ETB
engine where the ETB produces enough resource to pay for the blink and
creates a positive side effect. \### 8.6 Three-card bridge search ---
phase 2 Avoid naïve O(n³) search. Instead, let a promising pair produce
a structured deficit such as "needs free sacrifice," "needs one
additional mana per cycle," "needs ETB payoff," or "needs counter
reset." Then search specifically for a third card that satisfies that
deficit. pair(A, B) → partial loop { deficit: { capability:
"free_sacrifice_outlet", permanentType: "creature" }, restoredState:
\[A, B\], positiveOutput: \[ETB_count\] }

bridgeSearch(deficit) → top 20 cards evaluate(A, B, C) → candidate proof

## 9. Confidence, Proof, and False-Positive Control

### 9.1 Confidence model

### 9.2 Positive scoring signals

-   All costs and outputs are recognized by the parser.
-   The sequence returns all reusable card objects to the same relevant
    zones/state.
-   The cycle produces a strictly increasing resource/output (mana,
    damage, tokens, ETBs, casts, life, mill, draw) or a terminal win
    state.
-   No "once each turn," sorcery-only, or one-shot exile restriction
    interrupts repetition.
-   Target and "another" constraints are explicitly satisfied.
-   Mana colors and amounts balance without assuming unmodeled external
    resources.
-   Candidate is Commander legal when Commander mode is enabled. \###
    9.3 Mandatory blocker checks

### 9.4 Novelty check

Before displaying a high-confidence pair/triple as "not found," query
Commander Spellbook for the selected card plus candidate card names when
practical. If no exact variant is returned, label the result "Not found
in Commander Spellbook as of this search." Never label it "brand-new" or
"never discovered." \## 10. Performance, Caching, and Rate Discipline
\### 10.1 Request budgets

### 10.2 Cache policy

### 10.3 Progressive rendering

-   Render the selected card immediately from the resolved Scryfall
    object.
-   Start known-combo and novel-analysis promises in parallel.
-   Render known combos as soon as the first page arrives.
-   Render candidate batches after each rule template completes rather
    than waiting for every query.
-   Expose a "Stop analysis" control that aborts outstanding candidate
    searches.
-   Lazy-load card images in result lists; do not fetch alternate
    printings. \## 11. Security, Privacy, Accessibility, and Resilience
    \### 11.1 Security and privacy
-   No API keys, auth tokens, user accounts, cookies, or server-side
    data collection.
-   Render all API-provided text with textContent/createTextNode, not
    innerHTML. This is the most important XSS control in a single
    inline-script app.
-   Validate all external URLs before assigning href/src; allow only
    expected HTTPS hosts.
-   Use rel="noopener noreferrer" on external links opened in new tabs.
-   Keep analytics out of MVP. If analytics are later added, make them
    privacy-conscious and optional.
-   Use IndexedDB only for public card/combo data and local preferences;
    provide a "Clear local cache" action.
-   After P0 endpoint validation, consider a restrictive
    Content-Security-Policy meta tag. A true one-file page requires
    inline CSS/JS, so CSP will be less strict unless inline hashes are
    regenerated. \### 11.2 Accessibility
-   Semantic headings and landmarks; one H1; logical heading order.
-   Combobox/listbox keyboard pattern for autocomplete.
-   Visible focus ring with sufficient contrast; never remove outline
    without replacement.
-   All status chips include words, not color alone.
-   Images have useful alt text such as "Basalt Monolith card image";
    decorative symbols are aria-hidden.
-   Expandable details use native
    ```{=html}
    <details>
    ```
    /
    ```{=html}
    <summary>
    ```
    where practical.
-   Loading messages use aria-live="polite" without announcing every
    incremental candidate.
-   Honor prefers-reduced-motion; animation is optional, short, and
    nonessential. \### 11.3 Resilience states

## 12. Deployment and Free Hosting

### 12.1 Recommended hosting choices

### 12.2 Deployment recipe --- one-file version

1.  Create a repository with index.html at the publishing root.
2.  Paste the complete inline CSS/JavaScript application into that file.
3.  Open index.html locally for basic DOM tests; use a local static
    server when testing APIs because some browser behavior differs from
    file://.
4.  Enable GitHub Pages from the main branch/root, or connect the
    repository to Cloudflare Pages with no build command and root
    output.
5.  After deployment, run the P0 smoke checklist against the production
    origin: Scryfall autocomplete, fuzzy lookup, card images, Spellbook
    search, CORS, caching, mobile layout, and rate handling. \## 13.
    Implementation Structure and Pseudocode \### 13.1 State machine IDLE
    └─ typing → SUGGESTING SUGGESTING ├─ select/Enter → RESOLVING_CARD
    └─ clear → IDLE RESOLVING_CARD ├─ success → CARD_READY └─ failure →
    CARD_ERROR CARD_READY ├─ startKnown → KNOWN_LOADING ├─
    startDiscovery → DISCOVERY_LOADING └─ new search → SUGGESTING
    KNOWN_LOADING → KNOWN_READY \| KNOWN_ERROR DISCOVERY_LOADING →
    DISCOVERY_PARTIAL → DISCOVERY_READY \| DISCOVERY_ERROR \### 13.2
    Search controller pseudocode async function onSearchInput(raw) {
    const q = normalizeQuery(raw); cancelPreviousAutocomplete(); if
    (q.length \< 2) return renderRecentSearches();

await debounce(150); const names = await scryfall.autocomplete(q, {
signal }); renderSuggestions(rankSuggestions(q, names).slice(0, 10)); }

async function resolveCard(rawOrSuggestion) { setState({ phase:
"resolving" }); const card = isSuggestion(rawOrSuggestion) ? await
scryfall.namedExact(rawOrSuggestion) : await
scryfall.namedFuzzy(rawOrSuggestion);

selectCanonicalCard(card); Promise.allSettled(\[ loadKnownCombos(card),
discoverPotentialCombos(card) \]); } \### 13.3 Discovery orchestrator
pseudocode async function discoverPotentialCombos(card) { const
selectedFeatures = featureExtractor.parse(card); const rules =
ruleRegistry.applicableTo(selectedFeatures); const budget = new
AnalysisBudget({ searches: 8, candidates: 150, evals: 300 });

for (const rule of rules) { if (budget.exhausted()) break; const queries
= rule.planQueries(card, selectedFeatures); const pool = await
fetchBoundedCandidates(queries, budget);

for (const candidate of pool) { const candidateFeatures =
featureExtractor.parse(candidate); const proof = rule.evaluate(card,
selectedFeatures, candidate, candidateFeatures);
budget.consumeEvaluation();

if (proof.confidence \>= 75) { emitCandidate(await
enrichWithNoveltyCheck(proof)); } } } } \### 13.4 Engine versioning
Define a constant such as ENGINE_VERSION = "0.1.0" and include it in
cached analysis keys. Whenever parser rules or proof logic change, bump
the version. This prevents stale incorrect candidate results from
surviving an engine update. \## 14. Testing Strategy \### 14.1 Test
pyramid for a one-file product

### 14.2 Golden test cases

Every rule template needs at least three fixture types: a known positive
interaction, a near miss that must be rejected, and a wording variant.
The engine should be judged more harshly on false positives than on
missed combos. Missing a lead is disappointing; confidently presenting a
non-combo damages trust. \### 14.3 P0 browser compatibility spike -
Chrome, Firefox, Safari, and mobile Safari/Chrome: verify Scryfall and
Commander Spellbook requests are readable cross-origin from the deployed
static origin. - Confirm browser Fetch behavior with Accept headers and
Scryfall rate etiquette. - Confirm Commander Spellbook search syntax and
pagination from live schema/Swagger. - Confirm card images load
cross-origin and do not require hotlink workarounds. - Confirm IndexedDB
works under the chosen host and private browsing failure is handled
gracefully. - If either core API blocks browser CORS, stop and revisit
the "strictly no backend" requirement before building the engine. \##
15. Delivery Roadmap and Acceptance Criteria

### 15.1 Rough engineering effort

For one experienced engineer, the search + verified-combo experience is
a small project; the quality of the novel-combo engine is the real work.
A focused MVP with six two-card templates is plausibly about 7--12
concentrated engineering days, while a robust three-card engine can
easily double that depending on the desired Oracle-text coverage. Treat
these as planning ranges, not commitments. \### 15.2 Definition of done
for MVP - Production artifact is one index.html and loads from a free
static host. - Card search supports suggestions, keyboard navigation,
typo-tolerant submit, recent searches, and abortable requests. - Known
combos are fetched from Commander Spellbook and are visually distinct
from inferred candidates. - At least six explainable two-card rule
templates are implemented with positive/negative regression fixtures. -
Every potential combo has a confidence band, proof summary,
prerequisites, blockers, and source/novelty status. - Network
schedulers, hard budgets, retries, and caches prevent abusive traffic
and browser hangs. - Core flows pass mobile + desktop accessibility and
resilience checklists. \## 16. Risks and Mitigations

## 17. Recommended MVP Scope

### 17.1 First six templates

### 17.2 Defer until phase 2/3

-   Persist/undying + counter cancellation + free sacrifice outlet
    (usually three-card).
-   Complex replacement-effect loops.
-   Layer/dependency interactions and copy effects that require
    comprehensive rules ordering.
-   Loops dependent on opponent choices or hidden information.
-   Commander-specific command-zone replacement subtleties.
-   "Any payoff" loops where the core engine is finite without an
    external payoff; show these only when the payoff role is explicit.
    \## Appendix A. Initial Rule Template Catalog Each rule is a named,
    testable unit. The following catalog is intentionally more explicit
    than a generic "synergy score." It gives implementation anchors and
    expansion paths.

### Appendix A.1 Resource-vector concept

For template proofs, model a small resource vector rather than the
entire game state. Example dimensions: generic mana, W/U/B/R/G/C mana,
life, cards in hand, tokens, counters, tap state, and event counters
(cast/ETB/death). A cycle is interesting when all required reusable
state is restored and at least one useful dimension strictly increases.
delta(cycle) = { mana: +1, selectedCardTapped: 0, // restored
candidateTapped: 0, // restored cardsConsumed: 0, castCount: +1 }

If every required state component is restored and a useful output is \>
0, classify the template as a repeatable loop (subject to blockers). \##
Appendix B. Source References and Verification Notes Current external
claims in this plan were checked on August 20, 2026. API behavior,
limits, schemas, and hosting plans can change; the P0 feasibility spike
should re-verify these before implementation. 1. Scryfall API rate
guidance. Scryfall FAQ: asks consumers to keep api.scryfall.com traffic
under 10 requests/second; recommends bulk data for large workloads; also
describes request-header expectations.
https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17
2. Scryfall API shape. Scryfall API overview and ecosystem
documentation; relevant endpoints include cards/autocomplete,
cards/named, cards/search, cards/collection, and bulk-data.
https://scryfall.com/docs/api 3. Commander Spellbook project/API.
Commander Spellbook About page says its website/backend source is open
source and links the Backend REST API; backend repository describes
PostgreSQL + Django REST API + React frontend.
https://commanderspellbook.com/about/ 4. Commander Spellbook backend
source. Open-source Django REST backend repository.
https://github.com/SpaceCowMedia/commander-spellbook-backend 5.
Commander Spellbook API docs. Swagger UI for the backend REST API.
https://backend.commanderspellbook.com/schema/swagger/ 6. Commander
Spellbook data-license issue. Open issue #1211, opened Aug. 11, 2026,
explicitly asks for clarification of the combo data license as distinct
from the MIT-licensed code.
https://github.com/SpaceCowMedia/commander-spellbook-backend/issues/1211
7. GitHub Pages static hosting. GitHub describes Pages as a static
hosting service that publishes HTML/CSS/JavaScript from a repository;
available with GitHub Free for public repos.
https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
8. GitHub Pages limitations. GitHub states Pages is not intended as free
hosting for an online business/e-commerce/commercial SaaS.
https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
9. Cloudflare Pages static HTML. Cloudflare documents deployment of
plain static HTML sites.
https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
10. Cloudflare Pages free limits. Free-plan Pages limits include 500
builds/month and 25 MiB maximum size per single site asset as of July
2026. https://developers.cloudflare.com/pages/platform/limits/ \## Final
engineering recommendation Build the product in two distinct trust
layers: a curated "Verified" layer and a deterministic "Potential"
layer. The static one-file constraint is compatible with excellent card
search and strong two-card discovery as long as the novel engine remains
bounded and template-driven. The biggest technical risk is not hosting
or API cost; it is false confidence in novel combo inference. Design the
engine, UX language, tests, and rollout around precision and
explainability first.

  -----------------------------------------------------------------------
  North-star decision Keep the deployable product to one index.html file
  with inline CSS and JavaScript, no backend, no API keys, and no build
  step. Use Scryfall for card discovery and card metadata, Commander
  Spellbook for verified combo knowledge, and a local deterministic
  hypothesis engine for potential combos that are not found in the
  curated database.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Decision area           Recommendation          Why
  ----------------------- ----------------------- -----------------------
  Runtime                 One index.html with     Works on GitHub Pages
                          inline CSS + ES module  or Cloudflare Pages; no
                          JavaScript              build tooling, server,
                                                  secrets, or database
                                                  required.

  Card search             Scryfall autocomplete + Excellent canonical
                          fuzzy named lookup      naming and typo
                                                  tolerance; no API key.

  Verified combos         Commander Spellbook     Curated combo database
                          /variants search        with prerequisites,
                                                  steps, outputs, and
                                                  public REST backend.

  Potential new combos    Client-side feature     Explainable, free, and
                          extraction + rule       compatible with static
                          templates + targeted    hosting. Avoids
                          Scryfall searches       requiring an LLM or
                                                  private API key.

  Canonical identity      Scryfall oracle_id      Deduplicates printings
                                                  and makes caches
                                                  stable.

  Persistence             IndexedDB +             Caches results locally
                          localStorage            without a backend.

  Hosting                 GitHub Pages for        Both support plain
                          simplest                static HTML; the
                          open/noncommercial      production artifact
                          project; Cloudflare     remains one file.
                          Pages as an equally     
                          static alternative      
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Core product principle The UI must visually separate VERIFIED COMBOS
  from CANDIDATE COMBOS. A candidate should say "Not found in Commander
  Spellbook" rather than "new combo," because absence from a database
  does not prove global novelty.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Metric                              Target for MVP
  ----------------------------------- -----------------------------------
  Search responsiveness               Suggestions begin within \~250 ms
                                      on a warm network; stale requests
                                      are cancelled.

  Card resolution                     Common misspellings resolve through
                                      fuzzy lookup without forcing exact
                                      spelling.

  Known-combo precision               100% of displayed "verified" items
                                      originate from Commander Spellbook.

  Candidate transparency              100% of inferred combos display
                                      rationale, confidence, and
                                      potential blockers.

  Request discipline                  Scryfall request scheduler stays
                                      comfortably below 10 req/s;
                                      candidate analysis has a hard
                                      request budget.

  Static deploy                       Opening index.html from a static
                                      host is sufficient; no environment
                                      configuration required.

  Accessibility                       Search, result cards, filters,
                                      dialogs, and external links usable
                                      by keyboard and screen reader.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Status                  Label shown to user     Allowed claim
  ----------------------- ----------------------- -----------------------
  Verified                Verified in Commander   This combo is present
                          Spellbook               in the curated source;
                                                  show source steps and
                                                  results.

  High-confidence         Potential combo ---     Rule-template engine
  candidate               high confidence         found a closed
                                                  repeatable resource
                                                  loop. Still ask the
                                                  user to verify rules
                                                  details.

  Medium-confidence       Potential combo ---     The interaction pattern
  candidate               needs verification      is promising but
                                                  depends on a
                                                  prerequisite or parser
                                                  assumption.

  Low-confidence          Synergy lead            Do not call it a combo.
  interaction                                     Hide by default or
                                                  place behind an
                                                  "experimental" toggle.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Component                           Responsibility
  ----------------------------------- -----------------------------------
  AppState                            Selected card, loading states,
                                      filters, known combos, candidates,
                                      errors, feature flags.

  RequestScheduler                    Per-host queues, spacing,
                                      retry/backoff, cancellation, and
                                      hard analysis budgets.

  CacheStore                          IndexedDB for card/search/combo
                                      data; localStorage only for
                                      preferences and recent searches.

  ScryfallClient                      Autocomplete, fuzzy card
                                      resolution, card search, canonical
                                      normalization, image/URI access.

  SpellbookClient                     Known-combo search and pagination;
                                      maps API payloads into a stable
                                      internal model.

  FeatureExtractor                    Converts selected/candidate Oracle
                                      text into constrained mechanical
                                      features.

  QueryPlanner                        Chooses targeted Scryfall searches
                                      based on features and missing
                                      capabilities.

  RuleEngine                          Runs named combo templates;
                                      performs pair and later three-card
                                      bridge checks.

  Scorer                              Confidence, novelty status,
                                      color/legality fit, blockers,
                                      complexity, and display ranking.

  Renderer                            DOM updates using safe text nodes,
                                      progressive sections, keyboard
                                      behavior, and responsive cards.
  -----------------------------------------------------------------------

  -------------------------------------------------------------------------------------------
  Use case                Endpoint pattern                            Notes
  ----------------------- ------------------------------------------- -----------------------
  Type-ahead suggestions  GET                                         Names only; cache by
                          /cards/autocomplete?q=`<partial>`{=html}    normalized prefix;
                                                                      cancel stale requests.

  Fuzzy submit            GET /cards/named?fuzzy=`<text>`{=html}      Resolve misspellings or
                                                                      partial names after
                                                                      Enter.

  Targeted candidates     GET                                         Use mechanical query
                          /cards/search?q=`<Scryfall query>`{=html}   templates; dedupe by
                                                                      oracle_id; stop after a
                                                                      bounded result set.

  Selected card details   Use object returned by named/search, or     Do not refetch if a
                          fetch by ID as needed                       canonical object is
                                                                      already cached.
  -------------------------------------------------------------------------------------------

  -----------------------------------------------------------------------
  Browser-specific caveat Scryfall recommends a descriptive User-Agent,
  but browser JavaScript cannot manually set the User-Agent header. The
  browser sends its own UA. Make browser CORS/access behavior a mandatory
  P0 spike and keep request volume conservative. Set an explicit Accept
  header where allowed.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Priority                            Factor
  ----------------------------------- -----------------------------------
  1                                   Fewer total cards (two-card before
                                      three-card before larger).

  2                                   Commander legality and
                                      color-identity compatibility with
                                      selected-card context.

  3                                   Clear deterministic wins/infinite
                                      outputs before softer lock/value
                                      loops.

  4                                   Popularity signal if the API
                                      exposes one; treat this as
                                      tie-breaker, not truth.

  5                                   Stable alphabetical/source-ID
                                      ordering for deterministic display.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Feature family                      Examples to represent
  ----------------------------------- -----------------------------------
  Zones                               battlefield, graveyard, hand,
                                      library, exile, command zone;
                                      enters/leaves/returns/casts from
                                      zone.

  Resources                           colored/colorless mana, life, cards
                                      drawn, tokens, counters, untaps,
                                      land drops, storm/cast count.

  Events                              cast, ETB, LTB, dies, sacrificed,
                                      discarded, milled, targeted,
                                      counter placed/removed, life
                                      gained/lost.

  Actions                             tap, untap, sacrifice, bounce,
                                      blink, copy, cast, return,
                                      reanimate, create token, add mana,
                                      deal damage.

  Modifiers                           cost reduction, additional cost,
                                      replacement effect, "as though,"
                                      permission to cast/play, trigger
                                      doubling.

  Repeatability                       activated, triggered, static; once
                                      each turn; sorcery timing; tap
                                      cost; mana cost; sacrifice cost.

  Constraints                         another, nontoken, nonland,
                                      type/subtype, mana value, color,
                                      "you control," target restrictions.

  Terminal outputs                    win the game, opponent loses,
                                      unbounded damage/life loss,
                                      unbounded mill/draw, deterministic
                                      lock.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Selected-card feature   Needed partner          Candidate search theme
                          capability              
  ----------------------- ----------------------- -----------------------
  Tap ability produces    Untap it cheaper than   Oracle text containing
  multiple mana           its output OR copy      "untap target
                          untap ability           artifact/permanent" or
                                                  activated-ability copy
                                                  effects; type/legality
                                                  filters.

  Repeatable sacrifice    Permanent returns       Oracle text around
  outlet                  itself/another from     "return ... from your
                          graveyard + produces    graveyard," death/ETB
                          replacement resource    token or mana
                                                  generation.

  ETB creates resource    Repeatable blink/bounce Blink/return-to-hand
                          at cost ≤ resource      effects with reusable
                          gained                  activations or cast
                                                  loops.

  Life-gain trigger       Reciprocal life-loss    Search reciprocal
  causes loss/damage      causes gain             trigger wording; check
                                                  whether trigger targets
                                                  opponent/you and
                                                  whether it can repeat.

  Persist/undying body    Counter                 Search +1/+1 or -1/-1
                          cancellation/reset +    counter
                          sacrifice outlet role   placement/removal
                                                  effects; bridge search
                                                  for a free outlet.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Complexity guardrail Cap analysis to a small number of rule templates,
  a bounded number of Scryfall pages, and a bounded number of candidate
  evaluations. The tool should prefer "I found 6 strong leads" over
  attempting exhaustive discovery and freezing the browser.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Band                    Meaning                 Default UI
  ----------------------- ----------------------- -----------------------
  Verified                Present in Commander    Always show under
                          Spellbook               Verified.

  90--99                  Template proof closes a Show as High
                          repeatable loop; no     confidence.
                          parser warnings;        
                          resource delta          
                          positive; no obvious    
                          timing/target blockers  

  75--89                  Loop closes but depends Show as Medium
                          on a prerequisite,      confidence.
                          ambiguous target        
                          constraint, or manually 
                          assumed timing detail   

  60--74                  Strong synergy/partial  Hide behind
                          loop but proof is       Experimental / Synergy
                          incomplete              leads.

  \<60                    Too speculative         Do not show.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Blocker class                       Examples
  ----------------------------------- -----------------------------------
  Rate limit on ability               "Activate only once each turn";
                                      "this ability triggers only once
                                      each turn."

  Timing                              "Activate only as a sorcery";
                                      phase/step-specific restrictions.

  Self-target restriction             "Another target..." prevents an
                                      intended self-loop.

  Token/non-token mismatch            A recursion effect requires
                                      nontoken but the proposed loop
                                      creates tokens.

  Zone mismatch                       A card is exiled as a cost and
                                      never restored, or a bounce effect
                                      returns the wrong permanent.

  Mana mismatch                       Net resource is nonnegative
                                      numerically but produced colors
                                      cannot pay required colored costs.

  Summoning sickness                  A creature tap ability is assumed
                                      immediately without haste and the
                                      loop requires fresh copies.

  Finite counters/cards               A loop consumes counters/cards from
                                      a finite source and does not
                                      replenish them.

  Mandatory draw/mill                 An "infinite" loop actually loses
                                      before winning because draw/mill
                                      cannot be stopped.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Traffic                             Policy
  ----------------------------------- -----------------------------------
  Autocomplete                        \~150 ms debounce; cancel stale
                                      requests; cache prefix results.
                                      Never request on every key event
                                      without debounce.

  Scryfall general                    Single host scheduler with
                                      \~110--125 ms minimum spacing to
                                      remain below the documented 10
                                      req/s ceiling.

  Novel analysis                      Default hard budget: 8 targeted
                                      search requests, max \~150 unique
                                      candidate cards, max 300 pair
                                      evaluations.

  Three-card bridge                   Separate user-triggered "Search
                                      deeper" action; max 5 deficits × 20
                                      bridge candidates.

  Commander Spellbook                 Conservative queue (e.g., 250--400
                                      ms spacing) because no official
                                      rate limit is documented; back off
                                      on 429/5xx.
  -----------------------------------------------------------------------

  --------------------------------------------------------------------------------------------------------
  Cache key                                                Storage                 Suggested TTL
  -------------------------------------------------------- ----------------------- -----------------------
  autocomplete:`<prefix>`{=html}                           memory +                24 hours
                                                           IndexedDB/session       

  card:`<oracle_id>`{=html}                                IndexedDB               7 days

  named:`<normalized input>`{=html}                        IndexedDB               7 days

  spellbook:`<oracle_id>`{=html}                           IndexedDB               24 hours

  scryfallSearch:`<query>`{=html}                          IndexedDB               3--7 days

  analysis:`<oracle_id>`{=html}:`<engineVersion>`{=html}   IndexedDB               24 hours to 7 days

  recentSearches / UI prefs                                localStorage            No expiry; bounded list
  --------------------------------------------------------------------------------------------------------

  -----------------------------------------------------------------------
  Failure                             Behavior
  ----------------------------------- -----------------------------------
  Scryfall autocomplete fails         Keep free-text field active; Enter
                                      still attempts fuzzy lookup; show
                                      retry affordance.

  Scryfall card lookup fails          Do not begin analysis; show concise
                                      error and preserve typed query.

  Commander Spellbook fails           Show "Verified source unavailable"
                                      and continue potential-combo
                                      analysis; do not relabel candidates
                                      as verified.

  Candidate search hits 429           Pause scheduler, exponential
                                      backoff once/twice, then stop
                                      gracefully and show partial
                                      results.

  Offline with cached card            Show cached card and cached results
                                      with a stale badge; disable fresh
                                      verification.

  API schema changes                  Client mapper fails closed with a
                                      visible source error rather than
                                      rendering malformed data.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Host                    Fit                     Important note
  ----------------------- ----------------------- -----------------------
  GitHub Pages            Simplest for an         GitHub states Pages is
                          open-source/personal    not intended as free
                          project. It directly    hosting for a
                          serves static           commercial SaaS/online
                          HTML/CSS/JS and is      business. Use it for an
                          available on GitHub     open/noncommercial
                          Free for public         version.
                          repositories.           

  Cloudflare Pages        Excellent static-host   Pure static requests
                          option; supports plain  are effectively the
                          static HTML. Free plan  right shape for this
                          currently allows 500    app. Slightly more
                          builds/month and a 25   setup than GitHub Pages
                          MiB per-file asset      but friendly to future
                          limit.                  traffic.

  Netlify                 Also easy and free for  Its current free plan
                          experiments.            uses monthly credits;
                                                  not necessary when the
                                                  app needs no server
                                                  functions.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Layer                   What to test            How without a build
                                                  system
  ----------------------- ----------------------- -----------------------
  Pure unit               normalizeQuery,         Embed fixture arrays
                          resource math, parser   and a small assert()
                          patterns, rule proofs,  runner. Execute only
                          scoring                 when ?test=1 or a
                                                  developer flag is set.

  Contract                Map sample              Store small
                          Scryfall/Spellbook      representative JSON
                          payloads into internal  fixtures as JS
                          models                  constants in a
                                                  test-only code block or
                                                  optional dev copy.

  Integration smoke       Autocomplete, fuzzy     Manual test on hosted
                          card, known combo,      origin; optionally a
                          targeted search         lightweight GitHub
                                                  Actions browser test
                                                  later.

  UX                      Keyboard combobox,      Manual checklist plus
                          mobile, loading/error   browser accessibility
                          states, screen reader   audit.
                          labels                  

  Regression              Known tricky cards for  A curated fixture table
                          each rule template      with expected pass/fail
                                                  and blocker
                                                  explanation.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Phase                   Scope                   Exit criteria
  ----------------------- ----------------------- -----------------------
  P0 --- Feasibility      One HTML page; live     Both APIs usable from
  spike                   Scryfall + Spellbook    production static
                          fetches; CORS/rate      origin; known combo
                          check; basic cache.     query works; documented
                                                  fallback behavior.

  P1 --- Search shell     Autocomplete, keyboard  Fast typo-tolerant
                          UX, fuzzy Enter,        search; mobile/keyboard
                          selected-card display,  behavior passes
                          URL state.              checklist.

  P2 --- Verified combos  Spellbook client,       Verified section is
                          pagination,             source-faithful,
                          normalization,          cached, and clearly
                          cards/steps/results UI. attributed.

  P3 --- Feature engine   Feature ontology,       Parser covers the first
  v0                      parser evidence,        six templates and
                          resource vector,        exposes warnings
                          blocker library,        instead of guessing.
                          self-tests.             

  P4 --- Two-card         Query planner,          Useful high-confidence
  discovery               candidate fetch, six    candidates; known
                          rule templates,         near-misses rejected;
                          confidence score,       hard request budget
                          novelty check.          enforced.

  P5 --- Three-card       Structured deficits +   No O(n³) brute force;
  bridges                 targeted third-card     bridge results explain
                          searches; deeper-search the missing role and
                          control.                complete proof.

  P6 --- Hardening        Cache controls, offline Production smoke matrix
                          stale mode,             green; no high-severity
                          accessibility, CSP,     a11y/security issues.
                          performance tuning,     
                          docs/about.             
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Risk                    Impact                  Mitigation
  ----------------------- ----------------------- -----------------------
  Commander Spellbook     Legal/product risk if   Fetch at runtime,
  combo-data licensing    redistributing or       attribute visibly,
  remains unclear         commercializing data    avoid bundling database
                                                  snapshots, and resolve
                                                  data-license terms
                                                  before commercial
                                                  launch.

  Public API CORS/policy  Static client could     P0 live test; isolate
  changes                 lose a data source      clients; cached
                                                  graceful degradation;
                                                  be willing to add a
                                                  tiny proxy only if the
                                                  strict no-backend
                                                  requirement changes.

  Oracle text parser      Trust damage            Template-specific
  false positives                                 proof, blocker checks,
                                                  parser evidence,
                                                  conservative confidence
                                                  threshold, regression
                                                  fixtures.

  Combinatorial explosion Slow browser / too many Feature-directed
                          API calls               queries, bounded
                                                  candidate pools,
                                                  request/evaluation
                                                  budgets, progressive
                                                  output, explicit
                                                  deeper-search action.

  New card wording not    False negatives         Versioned parser,
  recognized                                      phrase-level fallback
                                                  warnings, add templates
                                                  incrementally based on
                                                  real misses.

  Scryfall rate limiting  429s / blocks           Debounce, queue below
                                                  10 req/s, cache, avoid
                                                  redundant lookups, stop
                                                  analysis on repeated
                                                  errors.

  Single-file             Code becomes hard to    Strong internal module
  maintainability         evolve                  boundaries, section
                                                  markers, pure
                                                  functions, engine
                                                  registry, embedded
                                                  tests. Split source
                                                  during development only
                                                  if needed while
                                                  preserving one-file
                                                  build artifact.

  User interprets         Misinformation          Status labels,
  candidate as rules                              confidence, blockers,
  proof                                           "verify" action, never
                                                  use "new/confirmed"
                                                  unless source-backed.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Ship this first Card search + selected-card details + Commander
  Spellbook verified combos + six high-signal two-card hypothesis
  templates. Delay three-card bridging until the false-positive rate is
  acceptable on a curated regression set.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  \#                      Template                Why it belongs in MVP
  ----------------------- ----------------------- -----------------------
  1                       Mana-positive untap     Common, mechanically
                                                  clear, resource math is
                                                  tractable.

  2                       Repeatable blink +      Common archetype; easy
                          resource-positive ETB   to explain
                                                  costs/outputs.

  3                       Cast/bounce/recast loop Captures storm/ETB
                                                  loops; reusable with
                                                  cost reducers.

  4                       Reciprocal              Very recognizable
                          life-gain/life-loss     feedback-loop
                          triggers                structure.

  5                       Sacrifice +             Core combo family;
                          self-recursion +        useful bridge into
                          resource replacement    three-card engines.

  6                       Copy activated          Finds important
                          ability +               artifact/ability loops
                          untap/resource loop     and exercises target
                                                  constraints.
  -----------------------------------------------------------------------

  ------------------------------------------------------------------------------------------------------------------
  ID             Rule               Closure condition               Typical output         Key blockers
  -------------- ------------------ ------------------------------- ---------------------- -------------------------
  R01            Mana-positive      A taps/activates for resource   Infinite mana;         Once/turn; summoning
                 untap              R; A or B can untap/reset A for repeated tap/untap     sickness; wrong permanent
                                    cost C; R \> C after color      triggers.              type; colored cost
                                    constraints.                                           mismatch.

  R02            Blink/ETB          A ETB produces resource; B can  ETB/LTB, tokens, mana, Blink exiles permanently;
                 self-funding       blink/return A repeatably;      draw, damage.          timing limits; target
                                    resource pays B and leaves                             says "another"; ETB
                                    positive output.                                       once/turn.

  R03            Cast/bounce loop   A or B returns a castable       Storm/cast count, ETB, Card returns to wrong
                                    object; recast cost is fully    magecraft, draw.       zone; finite mana; cost
                                    funded/reduced; each cycle                             reducer excludes type.
                                    creates output.                                        

  R04            Reciprocal life    One trigger converts            Unbounded life         Trigger targets only
                 feedback           gain→loss/damage and the other  gain/loss/damage.      self;
                                    converts loss/damage→gain.                             prevention/replacement;
                                                                                           optional trigger that
                                                                                           cannot target opponent as
                                                                                           needed.

  R05            Sacrifice +        Free/cheap sac outlet + object  Death/ETB/sacrifice,   Recursion has once/turn;
                 recursion          returns to usable zone; cycle   tokens, mana.          exiles instead; requires
                                    restores cost and creates                              external card each cycle.
                                    output.                                                

  R06            Copy activation    Copying an activation yields an Mana, activations,     Copy target cannot target
                 feedback           extra untap/resource event that untaps, storm-like     mana ability; copy cost
                                    can pay for copying again.      counters.              too high; target
                                                                                           restrictions.

  R07            Persist/undying    Creature returns with counter;  Deaths/ETBs plus       Usually requires third
                 reset              another effect removes/cancels  outlet payoff.         card; replacement/counter
                                    counter; outlet sacrifices                             rule mismatch.
                                    repeatedly.                                            

  R08            Token recursion    A creates token/resource when B Tokens, deaths, mana.  Nontoken restrictions;
                 engine             dies/sacrifices; resource                              finite cards/counters.
                                    recreates B or more tokens.                            

  R09            Cost-reduction     Cost reducers reduce            Storm, ETB, cast       Minimum-cost wording;
                 zero loop          recast/activation to zero;      triggers.              reducer scope; colored
                                    another effect returns/resets                          symbols not reducible.
                                    object.                                                

  R10            Counter/resource   Adding/removing counters pays   Counters, mana,        Finite initial counters;
                 feedback           for or triggers the inverse     damage, draw.          once/turn; counter type
                                    operation with positive side                           mismatch.
                                    effect.                                                

  R11            Mill/recursion     Self-mill or sacrifice puts     Mill, cast, ETB/death. Deck exhaustion;
                 loop               object in graveyard; recursion                         shuffle/replacement;
                                    returns/casts it and restores                          recursion cost not
                                    cost.                                                  restored.

  R12            Extra action loop  Untap/extra-combat/extra-turn   Infinite               One-shot exile clauses;
                                    effect is recreated by the      combats/turns.         timing; requires combat
                                    action it grants.                                      damage/opponent
                                                                                           cooperation.
  ------------------------------------------------------------------------------------------------------------------

  -----------------------------------------------------------------------
  Go / no-go gate Proceed after a one-hour P0 browser spike proves both
  external APIs can be consumed from the final static origin with
  acceptable CORS and rate behavior. If that gate fails, the product
  requirement must change (for example, allow a tiny free proxy) before
  investing in the combo engine.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
