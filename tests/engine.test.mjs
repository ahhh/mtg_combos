import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, card } from './harness.mjs';
import { shardOf as bakerShardOf } from '../tools/bake-combos.mjs';

let MTG, f;
before(async () => {
  MTG = await loadEngine();
  f = (name, text, opts) => MTG.extractFeatures(MTG.toCard(card(name, text, opts)));
});

const rule = (id) => MTG.RULES.find((r) => r.id === id);
const band = (p, warnings = []) => MTG.bandFor(p.obligations, p.blockers, warnings);
const states = (p) => Object.fromEntries(p.obligations.map((o) => [o.id, o.state]));

/* ---------------------------------------------------------------- text -- */

describe('text normalisation', () => {
  test('folds accents, curly quotes and punctuation', () => {
    assert.equal(MTG.normalizeName('Æther Vial'), 'aether vial');
    assert.equal(MTG.normalizeName('Thassa’s Oracle'), "thassa's oracle");
    assert.equal(MTG.normalizeName('  Lightning   Bolt '), 'lightning bolt');
  });

  test('oracle folding drops reminder text but keeps rules text', () => {
    const out = MTG.normalizeOracle('Flying (This creature can only be blocked by creatures with flying.) {T}: Add {C}.');
    assert.ok(!out.includes('blocked'));
    assert.ok(out.includes('{t}: add {c}'));
  });

  test('suggestion ranking prefers exact then prefix then substring', () => {
    const out = MTG.rankSuggestions('bolt', ['Lightning Bolt', 'Bolt', 'Bolt Hound', 'Thunderbolt']);
    assert.deepEqual(out.slice(0, 3), ['Bolt', 'Bolt Hound', 'Lightning Bolt']);
  });
});

describe('url allowlist', () => {
  test('accepts known art and source hosts, rejects everything else', () => {
    globalThis.location = { href: 'https://example.com/', origin: 'https://example.com' };
    assert.ok(MTG.safeUrl('https://cards.scryfall.io/normal/front/a/b.jpg'));
    assert.ok(MTG.safeUrl('https://commanderspellbook.com/combo/1-2'));
    assert.equal(MTG.safeUrl('https://evil.example.net/x.png'), null);
    assert.equal(MTG.safeUrl('javascript:alert(1)'), null);
  });
});

/* --------------------------------------------------------------- parser -- */

describe('mana parsing', () => {
  test('counts symbols and generic costs', () => {
    const m = MTG.parseManaSymbols('{3}{G}{G}');
    assert.equal(m.generic, 3);
    assert.equal(m.g, 2);
    assert.equal(MTG.manaTotal(m), 5);
  });

  test('reads "add three mana of any color"', () => {
    assert.equal(MTG.parseManaProduction('add three mana of any color').any, 3);
  });

  test('extracts a pay cost buried in a triggered ability', () => {
    assert.equal(MTG.payCostIn('you may pay {2}. If you do, copy that ability.'), 2);
    assert.equal(MTG.payCostIn('draw a card'), 0);
  });
});

describe('ability splitting', () => {
  test('separates activation cost from effect', () => {
    assert.deepEqual(MTG.splitActivated('{T}: Add {C}{C}{C}.'), { cost: '{T}', effect: 'Add {C}{C}{C}.' });
  });

  // Regression: a case-sensitive cost test demoted every sacrifice outlet
  // whose cost had no mana symbol to plain static text.
  test('recognises a capitalised non-mana cost', () => {
    const split = MTG.splitActivated('Sacrifice a creature: Add {C}{C}.');
    assert.ok(split, 'Sacrifice cost must parse as an activated ability');
    assert.equal(split.cost, 'Sacrifice a creature');
  });

  test('ignores a colon that is only prose', () => {
    assert.equal(MTG.splitActivated('Choose one: draw a card or gain 2 life.'), null);
  });
});

describe('role detection', () => {
  const cases = [
    ['Basalt Monolith', "{T}: Add {C}{C}{C}.\n{3}: Untap this artifact.", {}, ['mana_ability', 'self_untap_payer']],
    ["Ashnod's Altar", 'Sacrifice a creature: Add {C}{C}.', {}, ['sac_outlet']],
    ['Clock of Omens', '{T}, Tap two untapped artifacts you control: Untap target artifact.', {}, ['untapper']],
    ['Sanguine Bond', 'Whenever you gain life, target opponent loses that much life.',
      { typeLine: 'Enchantment' }, ['lifegain_trigger']],
    ['Exquisite Blood', 'Whenever an opponent loses life, you gain that much life.',
      { typeLine: 'Enchantment' }, ['lifeloss_payoff']],
  ];
  for (const [name, text, opts, expected] of cases) {
    test(`${name} -> ${expected.join(', ')}`, () => {
      const roles = [...f(name, text, opts).roles];
      for (const r of expected) assert.ok(roles.includes(r), `expected role ${r}, got [${roles}]`);
    });
  }
});

test('double-faced cards do not crash the parser', () => {
  const raw = card('Test // Back', null, {
    raw: {
      oracle_text: undefined,
      card_faces: [
        { name: 'Test', type_line: 'Creature', oracle_text: '{T}: Add {C}.', mana_cost: '{1}' },
        { name: 'Back', type_line: 'Land', oracle_text: '{T}: Add {G}.', mana_cost: '' },
      ],
    },
  });
  const feats = MTG.extractFeatures(MTG.toCard(raw));
  assert.ok(feats.oracleText.includes('Add {C}'));
  assert.ok(feats.oracleText.includes('Add {G}'));
});
