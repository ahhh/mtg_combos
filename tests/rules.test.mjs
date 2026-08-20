/**
 * One positive, one near-miss and one wording variant per template.
 *
 * The near-miss cases matter more than the positives. Missing a combo is a
 * disappointment; confidently presenting a non-combo is the failure mode that
 * makes the whole tool untrustworthy, so every template is pinned against the
 * specific way it is most likely to over-fire.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, card } from './harness.mjs';

let MTG, f;
before(async () => {
  MTG = await loadEngine();
  f = (name, text, opts) => MTG.extractFeatures(MTG.toCard(card(name, text, opts)));
});

const rule = (id) => MTG.RULES.find((r) => r.id === id);
const bandOf = (p, warn = []) => MTG.bandFor(p.obligations, p.blockers, warn);
const state = (p, id) => p.obligations.find((o) => o.id === id)?.state;

const BASALT = ["Basalt Monolith", "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact."];
const GRIM   = ['Grim Monolith', "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{4}: Untap this artifact."];
const RINGS  = ['Rings of Brighthearth', "Whenever you activate an ability, if it isn't a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy."];

describe('R01 mana-positive untap', () => {
  const r = () => rule('R01');

  test('positive: an untapper that does not tap itself closes the loop', () => {
    const p = r().evaluate(
      f('Bloom Tender', '{T}: Add one mana of any color.', { typeLine: 'Creature — Elf Druid' }),
      f('Freed from the Real', 'Enchant creature\n{U}: Untap enchanted creature.', { typeLine: 'Enchantment — Aura' }),
    );
    assert.equal(state(p, 'untapperReady'), 'met');
    assert.notEqual(bandOf(p), MTG.BAND.REJECT);
  });

  // Clock of Omens taps itself to activate, so after one untap it is spent.
  // Two cards alone do not loop here, however good the mana maths looks.
  test('near miss: an untapper that taps itself is spent after one use', () => {
    const p = r().evaluate(f(...BASALT), f('Clock of Omens', '{T}, Tap two untapped artifacts you control: Untap target artifact.'));
    assert.equal(state(p, 'positive'), 'met');
    assert.equal(state(p, 'untapperReady'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: untap that costs more than the rock produces is rejected', () => {
    const p = r().evaluate(f(...BASALT), f('Overpriced Untapper', '{5}: Untap target artifact.'));
    assert.equal(state(p, 'positive'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: once-each-turn untapper cannot loop', () => {
    const p = r().evaluate(f(...BASALT), f('Limited Untapper', '{1}: Untap target artifact. Activate only once each turn.'));
    assert.equal(state(p, 'repeat'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: an untapper that only hits creatures cannot untap an artifact', () => {
    const p = r().evaluate(f(...BASALT), f('Creature Untapper', '{1}: Untap target creature.', { typeLine: 'Creature — Wizard' }));
    assert.equal(state(p, 'covers'), 'unmet');
  });

  test('near miss: a one-shot instant is not a loop engine', () => {
    const p = r().evaluate(f(...BASALT), f('Twiddle', 'Untap target artifact.', { typeLine: 'Instant' }));
    assert.equal(state(p, 'repeat'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('wording variant: "untap target permanent" also covers an artifact', () => {
    const p = r().evaluate(f(...BASALT), f('Broad Untapper', '{1}: Untap target permanent.'));
    assert.equal(state(p, 'covers'), 'met');
  });
});

describe('R02 copied untap activation', () => {
  const r = () => rule('R02');

  test('positive: Basalt Monolith + Rings of Brighthearth nets +1 per cycle', () => {
    const p = r().evaluate(f(...BASALT), f(...RINGS));
    assert.equal(state(p, 'positive'), 'met');
    assert.equal(bandOf(p), MTG.BAND.HIGH);
    assert.match(p.obligations.find((o) => o.id === 'positive').evidence, /\+?1|copy costs 2/);
  });

  // Grim Monolith's untap costs {4}: two taps for 6 minus 4 minus 2 is exactly
  // zero, so it must NOT be reported as a loop.
  test('near miss: Grim Monolith + Rings is mana-neutral, not positive', () => {
    const p = r().evaluate(f(...GRIM), f(...RINGS));
    assert.equal(state(p, 'positive'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: copying a mana ability is not possible', () => {
    const p = r().evaluate(
      f('Mana Untapper', '{T}: Add {C}{C}{C}.\n{1}: Untap this artifact. Add {C}.'),
      f(...RINGS),
    );
    assert.equal(state(p, 'notmana'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });
});

describe('R03 self-funding blink', () => {
  const r = () => rule('R03');
  const PEREGRINE = ['Peregrine Drake', 'When this creature enters, untap up to five lands.', { typeLine: 'Creature — Drake' }];

  test('positive: free repeatable blink of an ETB permanent', () => {
    const p = r().evaluate(
      f('Mana Elemental', 'When this creature enters, add {C}{C}{C}.', { typeLine: 'Creature — Elemental' }),
      f('Free Blinker', '{T}: Exile target creature you control, then return it to the battlefield.'),
    );
    assert.equal(state(p, 'funds'), 'met');
  });

  test('near miss: a blink that costs mana with no mana payoff is not self-funding', () => {
    const p = r().evaluate(f(...PEREGRINE), f('Costly Blinker', '{3}: Exile target creature you control, then return it to the battlefield.'));
    assert.equal(state(p, 'funds'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: end-step blink repeats once a turn, not without bound', () => {
    const p = r().evaluate(
      f('Mana Elemental', 'When this creature enters, add {C}{C}{C}.', { typeLine: 'Creature — Elemental' }),
      f("Conjurer's Closet", 'At the beginning of your end step, exile target creature you control, then return it to the battlefield.'),
    );
    assert.ok(p.blockers.some((b) => b.fatal));
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: a one-shot blink spell is rejected', () => {
    const p = r().evaluate(
      f('Mana Elemental', 'When this creature enters, add {C}{C}{C}.', { typeLine: 'Creature — Elemental' }),
      f('Cloudshift', 'Exile target creature you control, then return it to the battlefield.', { typeLine: 'Instant' }),
    );
    assert.equal(state(p, 'repeat'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });
});

describe('R04 reciprocal life feedback', () => {
  const r = () => rule('R04');
  const BOND = ['Sanguine Bond', 'Whenever you gain life, target opponent loses that much life.', { typeLine: 'Enchantment' }];
  const BLOOD = ['Exquisite Blood', 'Whenever an opponent loses life, you gain that much life.', { typeLine: 'Enchantment' }];

  test('positive: Sanguine Bond + Exquisite Blood closes the loop', () => {
    const p = r().evaluate(f(...BOND), f(...BLOOD));
    assert.equal(state(p, 'a2b'), 'met');
    assert.equal(state(p, 'b2a'), 'met');
    assert.equal(state(p, 'direction'), 'met');
    assert.notEqual(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: life gain that only pumps a creature does not feed back', () => {
    const p = r().evaluate(
      f("Ajani's Pridemate", 'Whenever you gain life, put a +1/+1 counter on this creature.', { typeLine: 'Creature — Cat Soldier' }),
      f(...BLOOD),
    );
    assert.equal(state(p, 'a2b'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('wording variant: "each opponent loses 1 life" still counts as conversion', () => {
    const p = r().evaluate(
      f('Alt Bond', 'Whenever you gain life, each opponent loses 1 life.', { typeLine: 'Enchantment' }),
      f(...BLOOD),
    );
    assert.equal(state(p, 'a2b'), 'met');
  });
});

describe('R05 sacrifice and self-recursion', () => {
  const r = () => rule('R05');
  const REASSEMBLING = ['Reassembling Skeleton', '{1}{B}: Return this card from your graveyard to the battlefield.', { typeLine: 'Creature — Skeleton Warrior' }];

  test('positive: free sac outlet plus a self-returning body', () => {
    const p = r().evaluate(
      f('Self Returner', 'When this creature dies, return it to the battlefield.', { typeLine: 'Creature — Spirit' }),
      f("Ashnod's Altar", 'Sacrifice a creature: Add {C}{C}.'),
    );
    assert.equal(state(p, 'free'), 'met');
    assert.equal(state(p, 'outlet'), 'met');
  });

  test('near miss: an outlet that costs mana is not free', () => {
    const p = r().evaluate(f(...REASSEMBLING), f('Costly Outlet', '{2}, Sacrifice a creature: Draw a card.'));
    assert.equal(state(p, 'free'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: an outlet limited to once each turn cannot loop', () => {
    const p = r().evaluate(f(...REASSEMBLING), f('Slow Outlet', 'Sacrifice a creature: Draw a card. Activate only once each turn.'));
    assert.equal(state(p, 'repeat'), 'unmet');
  });
});

describe('R06 bounce and recast', () => {
  const r = () => rule('R06');

  test('positive: ETB mana covers recast plus bounce cost', () => {
    const p = r().evaluate(
      f('Big Ritual Creature', 'When this creature enters, add {C}{C}{C}{C}{C}.', { typeLine: 'Creature — Elemental', cmc: 2 }),
      f('Cheap Bouncer', '{T}: Return target permanent you control to its owner’s hand.'),
    );
    assert.equal(state(p, 'funds'), 'met');
  });

  test('near miss: recast cost exceeds the mana the trigger makes', () => {
    const p = r().evaluate(
      f('Small Ritual Creature', 'When this creature enters, add {C}.', { typeLine: 'Creature — Elemental', cmc: 4 }),
      f('Cheap Bouncer', '{T}: Return target permanent you control to its owner’s hand.'),
    );
    assert.equal(state(p, 'funds'), 'unmet');
    assert.equal(bandOf(p), MTG.BAND.REJECT);
  });

  test('near miss: an ETB with no mana at all cannot fund a recast', () => {
    const p = r().evaluate(
      f('Draw Creature', 'When this creature enters, draw a card.', { typeLine: 'Creature — Bird', cmc: 3 }),
      f('Cheap Bouncer', '{T}: Return target permanent you control to its owner’s hand.'),
    );
    assert.equal(state(p, 'funds'), 'unmet');
  });
});

describe('confidence banding', () => {
  const met = (id) => ({ id, label: id, state: 'met', evidence: '' });
  const unk = (id) => ({ id, label: id, state: 'unknown', evidence: '' });
  const unmet = (id) => ({ id, label: id, state: 'unmet', evidence: '' });

  test('all met and no blockers is the strong band', () => {
    assert.equal(MTG.bandFor([met('a'), met('b')], []), MTG.BAND.HIGH);
  });
  test('a single unmet obligation rejects outright', () => {
    assert.equal(MTG.bandFor([met('a'), unmet('b')], []), MTG.BAND.REJECT);
  });
  test('a fatal blocker rejects even when every obligation is met', () => {
    assert.equal(MTG.bandFor([met('a')], [{ text: 'x', fatal: true }]), MTG.BAND.REJECT);
  });
  test('unknowns downgrade rather than reject', () => {
    assert.equal(MTG.bandFor([met('a'), unk('b')], []), MTG.BAND.MEDIUM);
    assert.equal(MTG.bandFor([unk('a'), unk('b')], []), MTG.BAND.LEAD);
  });
  test('a parser warning caps confidence below strong', () => {
    assert.equal(MTG.bandFor([met('a')], [], ['may have misread this card']), MTG.BAND.MEDIUM);
  });
});
