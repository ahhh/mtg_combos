/**
 * The client computes a shard number from an oracle id with no index lookup,
 * which only works while its hash matches the baker's byte for byte. These
 * live in two different files, so a test pins them together.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { loadEngine, ROOT } from './harness.mjs';
import { shardOf as bakerShardOf } from '../tools/bake-combos.mjs';

let MTG;
before(async () => { MTG = await loadEngine(); });

const hasData = await access(path.join(ROOT, 'data/meta.json')).then(() => true, () => false);

describe('shard hashing', () => {
  test('client and baker agree on every shard number', () => {
    for (let i = 0; i < 500; i++) {
      const oid = `${i}-6b8cf2a0-b045-4d91-9d91-c602d40c${String(i).padStart(4, '0')}`;
      assert.equal(MTG.shardOf(oid, 128), bakerShardOf(oid, 128), `mismatch for ${oid}`);
    }
  });

  test('shard numbers stay inside range', () => {
    for (const n of [1, 8, 128, 256]) {
      assert.ok(MTG.shardOf('abc-def', n) < n);
      assert.ok(MTG.shardOf('abc-def', n) >= 0);
    }
  });
});

describe('baked index', { skip: hasData ? false : 'no data/ built — run npm run bake' }, () => {
  let meta;
  before(async () => { meta = JSON.parse(await readFile(path.join(ROOT, 'data/meta.json'), 'utf8')); });

  test('meta describes a plausible bake', () => {
    assert.ok(meta.shards > 0);
    assert.ok(meta.combosKept > 1000);
    assert.ok(meta.cardsIndexed > 1000);
    assert.ok(meta.maxPerCard > 0);
  });

  test('a known card resolves to the shard its oracle id hashes to', async () => {
    const oid = '6b8cf2a0-b045-4d91-9d91-c602d40c6237';           // Basalt Monolith
    const n = MTG.shardOf(oid, meta.shards);
    const shard = JSON.parse(await readFile(path.join(ROOT, `data/shards/${n}.json`), 'utf8'));
    const entry = shard.entries[oid];
    assert.ok(entry, `Basalt Monolith missing from shard ${n}`);
    assert.equal(shard.cards[entry[0]][1], 'Basalt Monolith');
    assert.ok(entry[1] >= entry[2].length, 'stored total must be >= the capped page');
    assert.ok(entry[2].length <= meta.maxPerCard);
  });

  test('every combo row decodes to real card names and feature labels', async () => {
    const shard = JSON.parse(await readFile(path.join(ROOT, 'data/shards/0.json'), 'utf8'));
    let checked = 0;
    for (const [, total, rows] of Object.values(shard.entries)) {
      assert.equal(typeof total, 'number');
      for (const [id, cardIxs, featIxs] of rows.slice(0, 3)) {
        assert.match(id, /^[\d-]+$/);
        assert.ok(cardIxs.length >= 2, 'a combo needs at least two cards');
        for (const i of cardIxs) {
          assert.ok(shard.cards[i], `card index ${i} out of range`);
          assert.equal(typeof shard.cards[i][1], 'string');
        }
        for (const i of featIxs) assert.equal(typeof shard.feats[i], 'string');
        checked++;
      }
      if (checked > 200) break;
    }
    assert.ok(checked > 0);
  });

  test('the prose Commander Spellbook authored is not redistributed', async () => {
    const shard = await readFile(path.join(ROOT, 'data/shards/0.json'), 'utf8');
    const parsed = JSON.parse(shard);
    for (const [, , rows] of Object.values(parsed.entries)) {
      for (const row of rows.slice(0, 5)) {
        assert.equal(row.length, 6, 'combo rows carry facts only, no description or prerequisites');
      }
    }
  });
});
