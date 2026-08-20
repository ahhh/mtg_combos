/**
 * Loads the module out of index.html and evaluates it in Node.
 *
 * This is what makes a single-file app testable without a build step: the
 * tests import the exact bytes that ship, so there is no second copy of the
 * engine to drift. The script guards its own bootstrap on `document`, so it
 * initialises cleanly with no DOM present.
 */
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadEngine() {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No module script found in index.html');

  const dir = await mkdtemp(path.join(tmpdir(), 'mtg-engine-'));
  const file = path.join(dir, 'engine.mjs');
  await writeFile(file, m[1]);
  await import(file);
  if (!globalThis.MTG) throw new Error('index.html did not export globalThis.MTG');
  return globalThis.MTG;
}

/** Minimal Scryfall-shaped fixture so tests do not need the network. */
export function card(name, oracleText, opts = {}) {
  return {
    object: 'card',
    id: opts.id ?? 'x',
    oracle_id: opts.oracleId ?? name.toLowerCase().replace(/\W+/g, '-'),
    name,
    mana_cost: opts.manaCost ?? '{2}',
    cmc: opts.cmc ?? 2,
    type_line: opts.typeLine ?? 'Artifact',
    oracle_text: oracleText,
    colors: opts.colors ?? [],
    color_identity: opts.colorIdentity ?? [],
    legalities: opts.legalities ?? { commander: 'legal' },
    layout: opts.layout ?? 'normal',
    ...opts.raw,
  };
}
