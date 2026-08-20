#!/usr/bin/env node
/**
 * Offline data bake. Downloads the Commander Spellbook bulk export and emits a
 * compact, FACTS-ONLY shard set for the static site.
 *
 * What we keep: which cards form a combo, what it produces, colour identity,
 * commander legality, popularity, and the upstream combo id.
 * What we deliberately drop: the written steps, prerequisites and notes. Those
 * are Spellbook's authored prose; we deep-link to them instead of copying them.
 * See docs/DATA.md.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

const SRC = 'https://json.commanderspellbook.com/variants.json.gz';
const SHARDS = 128;
// Median card has 9 combos, but the tail reaches 6000+. Capping keeps the
// worst-case shard fetch small; the UI shows the true total and links out.
const MAX_PER_CARD = 60;

/** Stable 32-bit hash so the client can compute a shard id without an index. */
export function shardOf(oracleId, shards = SHARDS) {
  let h = 2166136261;
  for (let i = 0; i < oracleId.length; i++) {
    h ^= oracleId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % shards;
}

/**
 * Incremental object splitter over the `variants` array.
 * Uses a read cursor and periodic compaction; slicing the buffer per object
 * turns this into an O(n^2) copy and takes tens of minutes on a 629MB input.
 */
async function* variants(stream) {
  stream.setEncoding('utf8');
  let buf = '';
  let started = false, depth = 0, start = -1, pos = 0, instr = false, esc = false;

  for await (const chunk of stream) {
    buf += chunk;
    if (!started) {
      const k = buf.indexOf('"variants"');
      if (k < 0) { if (buf.length > 1 << 20) { buf = buf.slice(-4096); } continue; }
      pos = buf.indexOf('[', k) + 1;
      started = true;
    }
    while (pos < buf.length) {
      const ch = buf[pos];
      if (instr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') instr = false;
      } else if (ch === '"') instr = true;
      else if (ch === '{') { if (depth === 0) start = pos; depth++; }
      else if (ch === '}') {
        if (--depth === 0) { yield JSON.parse(buf.slice(start, pos + 1)); start = -1; }
      }
      pos++;
    }
    // Compact only what is provably consumed, once per chunk.
    const keepFrom = start >= 0 ? start : pos;
    if (keepFrom > 0) { buf = buf.slice(keepFrom); pos -= keepFrom; if (start >= 0) start = 0; }
  }
}

async function source(CACHE) {
  if (CACHE && CACHE !== '-') {
    console.error(`[bake] reading cached ${CACHE}`);
    return createReadStream(CACHE).pipe(createGunzip());
  }
  console.error(`[bake] downloading ${SRC}`);
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`bulk fetch failed: ${res.status}`);
  return Readable.fromWeb(res.body).pipe(createGunzip());
}

async function main() {
  const CACHE = process.argv[2] ?? null;
  const OUT = path.resolve(process.argv[3] ?? 'data');
  const shards = Array.from({ length: SHARDS }, () => new Map());
  let total = 0, kept = 0;

  for await (const v of variants(await source(CACHE))) {
    total++;
    if (v.status && v.status !== 'OK') continue;      // drop drafts/needs-review
    const uses = (v.uses ?? []).map((u) => u.card).filter((c) => c?.oracleId);
    if (uses.length < 2 || uses.length > 6) continue;  // 2..6 card combos only
    kept++;

    const produces = (v.produces ?? []).map((p) => p.feature?.name).filter(Boolean);
    const row = {
      i: v.id,
      c: uses.map((c) => [c.oracleId, c.name]),
      p: produces,
      d: v.identity ?? '',
      n: v.popularity ?? 0,
      l: v.legalities?.commander ? 1 : 0,
    };
    for (const c of uses) {
      const s = shards[shardOf(c.oracleId)];
      if (!s.has(c.oracleId)) s.set(c.oracleId, { name: c.name, combos: [] });
      s.get(c.oracleId).combos.push(row);
    }
    if (total % 20000 === 0) console.error(`  ...${total}`);
  }

  await mkdir(path.join(OUT, 'shards'), { recursive: true });

  /**
   * Per-shard string tables. Card identity is interned as one [oracleId, name]
   * pair per distinct card, so a combo row carries only small integers - without
   * this the repeated 36-char oracle ids dominate the payload.
   */
  let cardCount = 0, truncatedCards = 0;
  for (let i = 0; i < SHARDS; i++) {
    const cards = [], cardIx = new Map();
    const feats = [], featIx = new Map();
    const internCard = (oid, name) => {
      let k = cardIx.get(oid);
      if (k === undefined) { k = cards.length; cards.push([oid, name]); cardIx.set(oid, k); }
      return k;
    };
    const internFeat = (s) => {
      let k = featIx.get(s);
      if (k === undefined) { k = feats.length; feats.push(s); featIx.set(s, k); }
      return k;
    };

    const entries = {};
    for (const [oracleId, rec] of shards[i]) {
      cardCount++;
      rec.combos.sort((a, b) => b.n - a.n);
      const total = rec.combos.length;
      const shown = rec.combos.slice(0, MAX_PER_CARD);
      if (total > shown.length) truncatedCards++;
      entries[oracleId] = [
        internCard(oracleId, rec.name),
        total,
        shown.map((r) => [
          r.i,
          r.c.map(([oid, nm]) => internCard(oid, nm)),
          r.p.map(internFeat),
          r.d, r.n, r.l,
        ]),
      ];
    }
    await writeFile(
      path.join(OUT, 'shards', `${i}.json`),
      JSON.stringify({ cards, feats, entries }),
    );
  }

  const meta = {
    version: 1,
    shards: SHARDS,
    generated: new Date().toISOString(),
    source: 'https://commanderspellbook.com/',
    variantsSeen: total,
    combosKept: kept,
    cardsIndexed: cardCount,
    maxPerCard: MAX_PER_CARD,
    cardsTruncated: truncatedCards,
  };
  await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));

  const files = await readdir(path.join(OUT, 'shards'));
  let bytes = 0, max = 0;
  for (const f of files) {
    const { size } = await stat(path.join(OUT, 'shards', f));
    bytes += size; max = Math.max(max, size);
  }
  console.error(`[bake] variants=${total} kept=${kept} cards=${cardCount}`);
  console.error(`[bake] shards=${files.length} total=${(bytes / 1e6).toFixed(1)}MB largest=${(max / 1e3).toFixed(0)}KB`);
}

// Only run when invoked directly, so tests can import shardOf() for a parity
// check without kicking off a 629MB download.
if (import.meta.filename === process.argv[1]) await main();
