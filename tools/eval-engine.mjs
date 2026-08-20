#!/usr/bin/env node
/**
 * Measures the rule engine against the baked verified index.
 *
 * The 105k curated combos are the only ground truth available, so they are the
 * regression corpus: for a set of engine cards we run real discovery and ask
 *   - recall:    which verified 2-card pairs did the engine recover?
 *   - precision: of everything it proposed, how much is corroborated?
 *
 * Precision here is a floor, not a rate. A pair absent from the corpus may
 * still be a fine combo nobody has submitted, which is exactly why the UI
 * calls these hypotheses. What the number is genuinely good for is catching a
 * regression that makes some template start emitting hundreds of pairs.
 *
 *   node tools/eval-engine.mjs                     # default card set
 *   node tools/eval-engine.mjs "Grim Monolith" ... # explicit cards
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadEngine, ROOT } from '../tests/harness.mjs';

/**
 * Scryfall rejects requests carrying a default HTTP-library User-Agent and
 * asks tools to identify themselves. Browsers send their own UA so the app
 * itself is unaffected; only this offline harness needs the header.
 */
const realFetch = globalThis.fetch;
const CACHE_DIR = path.join(process.env.TMPDIR ?? '/tmp', 'mtg-eval-cache');
await mkdir(CACHE_DIR, { recursive: true });

globalThis.fetch = async (url, init = {}) => {
  const key = createHash('sha256').update(String(url)).digest('hex').slice(0, 32);
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    return new Response(await readFile(file), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch { /* miss */ }

  const res = await realFetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'User-Agent': 'MTGComboExplorer-EvalHarness/1.0 (+https://github.com/; offline regression run)',
    },
  });
  const body = await res.text();
  if (res.ok) await writeFile(file, body);
  return new Response(body, { status: res.status, headers: { 'content-type': 'application/json' } });
};

const MTG = await loadEngine();
const { discover, Scryfall, VerifiedSource, extractFeatures, BAND } = MTG;

// The app caps how many hypotheses one template may contribute, and ranks
// already-known pairs last. Both are right for the UI and both hide exactly
// the corroboration this harness is trying to measure, so lift the cap here.
MTG.CFG.maxPerRule = Number.POSITIVE_INFINITY;

const meta = JSON.parse(await readFile(path.join(ROOT, 'data/meta.json'), 'utf8'));

async function verifiedFor(oracleId) {
  const n = MTG.shardOf(oracleId, meta.shards);
  const shard = JSON.parse(await readFile(path.join(ROOT, `data/shards/${n}.json`), 'utf8'));
  const entry = shard.entries[oracleId];
  if (!entry) return { combos: [], total: 0 };
  const [, total, rows] = entry;
  return {
    total,
    combos: rows.map(([id, cards, feats]) => ({
      id,
      cards: cards.map((i) => ({ oracleId: shard.cards[i][0], name: shard.cards[i][1] })),
      produces: feats.map((i) => shard.feats[i]),
    })),
  };
}

const CARDS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'Basalt Monolith', 'Grim Monolith', 'Dockside Extortionist', 'Peregrine Drake',
  'Palinchron', 'Priest of Titania', 'Kiki-Jiki, Mirror Breaker', 'Deceiver Exarch',
  'Archaeomancer', 'Cloud of Faeries', 'Bloodchief Ascension', 'Sanguine Bond',
  'Karmic Guide', 'Gray Merchant of Asphodel', 'Krark-Clan Ironworks', 'Sensei\'s Divining Top',
];

let totalHyp = 0, totalCorroborated = 0, totalRecall = 0, totalKnownPairs = 0;
const perRule = new Map();

for (const name of CARDS) {
  let card;
  try { card = await Scryfall.named(name, { fuzzy: true }); }
  catch (e) { console.log(`  ${name}: lookup failed (${e.message})`); continue; }

  const { combos } = await verifiedFor(card.oracleId);
  const novelty = VerifiedSource.noveltyIndex(combos);
  const knownPairs = new Set(
    combos.filter((c) => c.cards.length === 2)
      .map((c) => c.cards.map((x) => x.oracleId).sort().join('|')),
  );

  const { candidates } = await discover(card, { novelty });
  const found = new Set(
    candidates.map((c) => [c.cards[0].oracleId, c.cards[1].oracleId].sort().join('|')),
  );
  const recovered = [...knownPairs].filter((k) => found.has(k));
  const corroborated = candidates.filter((c) => c.knownAlready).length;

  for (const c of candidates) {
    const r = perRule.get(c.ruleId) ?? { n: 0, known: 0 };
    r.n++; if (c.knownAlready) r.known++;
    perRule.set(c.ruleId, r);
  }

  totalHyp += candidates.length;
  totalCorroborated += corroborated;
  totalRecall += recovered.length;
  totalKnownPairs += knownPairs.size;

  const roles = [...extractFeatures(card).roles].join(', ') || 'none';
  console.log(
    `${card.name.padEnd(30)} roles=[${roles}]\n` +
    `   hypotheses ${String(candidates.length).padStart(4)} ` +
    `| corroborated ${String(corroborated).padStart(4)} ` +
    `| recovered ${recovered.length}/${knownPairs.size} known 2-card pairs`,
  );
  const top = candidates.filter((c) => c.band === BAND.HIGH && !c.knownAlready).slice(0, 3);
  for (const t of top) console.log(`      new: ${t.cards[1].name} (${t.ruleId})`);
}

console.log('\n--- totals ---');
console.log(`hypotheses:          ${totalHyp}`);
console.log(`corroborated:        ${totalCorroborated}`);
console.log(`known-pair recall:   ${totalRecall}/${totalKnownPairs}`);
console.log('per rule:');
for (const [id, r] of [...perRule].sort()) {
  console.log(`  ${id}  emitted ${String(r.n).padStart(4)}  corroborated ${String(r.known).padStart(4)}`);
}
