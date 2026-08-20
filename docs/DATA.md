# Data sources

## Scryfall — card layer (live)

Card names, Oracle text, images and legality come from `api.scryfall.com` at
runtime. Scryfall sends `Access-Control-Allow-Origin: *`, so a static page can
call it directly with no proxy.

Two operational notes:

- **Rate discipline.** Scryfall asks consumers to stay under 10 requests/second
  and rate-limits bursts, not just averages. All requests go through one
  `Scheduler` with 150 ms spacing (~6.6/s) plus exponential backoff on 429/5xx.
- **User-Agent.** Scryfall asks tools to send a descriptive `User-Agent` and
  rejects default HTTP-library values. Browsers send their own UA, so the app is
  fine; the Node harness in `tools/` sets one explicitly because Node's default
  is refused.

## Commander Spellbook — verified combo layer (baked offline)

**The REST backend cannot be called from a browser on a third-party origin.**
Verified 2026-08-20:

```
$ curl -sD- -o/dev/null 'https://backend.commanderspellbook.com/variants/?q=x' \
    -H 'Origin: https://example.github.io' | grep -i access-control
(nothing)

$ curl -sD- -o/dev/null 'https://backend.commanderspellbook.com/variants/?q=x' \
    -H 'Origin: https://commanderspellbook.com' | grep -i access-control
access-control-allow-origin: https://commanderspellbook.com
```

The header is echoed only for their own frontend. Any design that calls this
endpoint from a static page fails in the browser regardless of how carefully it
is scheduled, so the verified layer is built offline instead.

The one CORS-open source is the bulk export at
`https://json.commanderspellbook.com/variants.json` (`Access-Control-Allow-Origin: *`),
but it is **629 MB** uncompressed / 27 MB gzipped — far too large to fetch from
a page. `tools/bake-combos.mjs` streams it once, offline, and writes the
compact shard set in `data/`.

### What the bake keeps, and what it deliberately drops

Kept — facts about which cards interact:

| Field | Why |
| --- | --- |
| Upstream combo id | Deep-links back to the source |
| Oracle ids + card names | Identity and display |
| Produced result labels | "Infinite colorless mana" etc. |
| Colour identity, commander legality | Filtering |
| Popularity | Ranking only |

Dropped — Commander Spellbook's authored prose:

- `description` (the written step-by-step, 46 MB across the corpus)
- `easyPrerequisites` / `notablePrerequisites`
- `notes`

Those are the part contributors actually wrote, and the licence covering the
combo data is still an open question upstream
([backend issue #1211](https://github.com/SpaceCowMedia/commander-spellbook-backend/issues/1211),
distinct from the MIT-licensed code). The app therefore shows *that* a combo
exists and *what it does*, then links to Commander Spellbook for the steps.
`tests/data.test.mjs` asserts the prose columns are absent from the shards, so
this cannot regress silently.

If you would rather ship no combo data at all, delete `data/`. The app detects
its absence, says the verified layer is unavailable, and still offers
hypotheses plus a direct Commander Spellbook search link.

### Shard layout

`data/meta.json` holds the bake stamp and shard count. Card lookups go straight
to one file, with no index fetch, because the client recomputes the shard number
from the oracle id using the same FNV-1a hash as the baker:

```
shard = fnv1a(oracleId) % meta.shards        // 128 shards
data/shards/<shard>.json
```

`tests/data.test.mjs` pins the two implementations together — if they drift,
every lookup silently misses.

Each shard interns card identity and feature labels into string tables so combo
rows carry only integers:

```jsonc
{
  "cards":   [["<oracleId>", "Basalt Monolith"], ...],
  "feats":   ["Infinite colorless mana", ...],
  "entries": {
    "<oracleId>": [
      0,      // index into cards[] for this card
      287,    // true number of combos upstream
      [       // up to meta.maxPerCard rows, most popular first
        ["4131-4235", [0, 12], [3], "C", 60865, 1]
        // id, cardIxs, featureIxs, identity, popularity, commanderLegal
      ]
    ]
  }
}
```

Current bake: 105,271 combos over 7,378 cards → 17.5 MB on disk, 6.4 MB gzipped
across 128 shards, largest shard 72 KB gzipped. Capping at 60 combos per card
matters: the median card has 9 but the tail reaches 6,021, and the UI shows the
true total with a link out.

### Refreshing

```
npm run bake                      # downloads the bulk export, rewrites data/
npm run bake -- cached.json.gz    # reuse a local copy
```

Re-run after upstream releases. Nothing else needs regenerating.
