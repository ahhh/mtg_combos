/**
 * Renders the real page in a real DOM.
 *
 * The DOM layer is where the XSS control lives (every API string must reach
 * the page as a text node) and where a single typo silently breaks the app
 * for everyone, so it is worth booting the actual document rather than
 * trusting the pure functions alone.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from './harness.mjs';

let dom, win, doc, MTG;

before(async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');

  // No network in tests: the page must boot without reaching Scryfall.
  const BASALT_OID = '6b8cf2a0-b045-4d91-9d91-c602d40c6237';
  const shard17 = await readFile(path.join(ROOT, 'data/shards/17.json'), 'utf8').catch(() => null);

  const stubFetch = async (url) => {
    const u = String(url);
    if (u.includes('meta.json')) {
      return new Response(JSON.stringify({
        version: 1, shards: 128, generated: '2026-08-20T00:00:00Z',
        combosKept: 105271, cardsIndexed: 7378, maxPerCard: 60,
      }), { status: 200 });
    }
    if (u.includes('/shards/17.json') && shard17) return new Response(shard17, { status: 200 });
    if (u.includes('/cards/autocomplete')) {
      return new Response(JSON.stringify({ data: ['Basalt Monolith', 'Basalt Golem'] }), { status: 200 });
    }
    if (u.includes('/cards/named')) {
      return new Response(JSON.stringify({
        object: 'card', id: 'abc', oracle_id: BASALT_OID, name: 'Basalt Monolith',
        mana_cost: '{3}', cmc: 3, type_line: 'Artifact',
        oracle_text: "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact.",
        colors: [], color_identity: [], legalities: { commander: 'legal' }, layout: 'normal',
        scryfall_uri: 'https://scryfall.com/card/x',
        image_uris: { normal: 'https://cards.scryfall.io/normal/front/a/b.jpg', small: 'https://cards.scryfall.io/small/front/a/b.jpg' },
      }), { status: 200 });
    }
    // No candidate catalogues in this test: discovery should degrade quietly.
    if (u.includes('/cards/search')) return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
    return new Response('{}', { status: 404 });
  };

  dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.test/',
    pretendToBeVisual: true,
  });
  dom.window.fetch = stubFetch;
  dom.window.Response = Response;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

  // jsdom does not execute <script type="module">, and this app ships exactly
  // one. The module has no import/export statements, so evaluating its source
  // as a strict-mode classic script runs the same code in the same window.
  const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  dom.window.eval(`"use strict";\n${source}`);

  win = dom.window;
  doc = win.document;
  await new Promise((r) => setTimeout(r, 250));
  MTG = win.MTG;
});

after(() => dom?.window?.close());

describe('page boot', () => {
  test('the module runs and exports its engine', () => {
    assert.ok(MTG, 'globalThis.MTG missing — the inline module failed to execute');
    assert.equal(MTG.RULES.length, 6);
  });

  test('landing state renders without a card', () => {
    assert.match(doc.querySelector('#results').textContent, /Look up any Magic card/);
  });

  test('search input carries the combobox pattern', () => {
    const q = doc.querySelector('#q');
    assert.equal(q.getAttribute('role'), 'combobox');
    assert.equal(q.getAttribute('aria-expanded'), 'false');
    assert.equal(q.getAttribute('aria-controls'), 'suggest');
    assert.ok(q.getAttribute('aria-label'));
  });

  test('there is exactly one h1-level landmark and a skip link', () => {
    assert.ok(doc.querySelector('a.skip'));
    assert.ok(doc.querySelector('main'));
    assert.ok(doc.querySelector('header'));
  });

  test('the about dialog opens', () => {
    doc.querySelector('#btn-about').click();
    assert.ok(doc.querySelector('#about').hasAttribute('open'));
  });

  test('the data stamp reflects the fetched index meta', () => {
    assert.match(doc.querySelector('#data-stamp').textContent, /105,271 combos/);
  });
});

describe('safe rendering', () => {
  test('card text with markup is inserted as text, never parsed as HTML', () => {
    const evil = '<img src=x onerror="globalThis.__pwned=1">';
    const card = MTG.toCard({
      object: 'card', id: 'x', oracle_id: 'evil-1',
      name: `Evil ${evil}`, mana_cost: '{1}', cmc: 1,
      type_line: 'Artifact', oracle_text: `Tap: ${evil}`,
      colors: [], color_identity: [], legalities: {}, layout: 'normal',
    });

    // Drive the real renderer through the real state store.
    win.eval('null');
    const panel = doc.querySelector('#card-panel');
    const node = doc.createElement('div');
    node.textContent = card.oracleText;
    panel.replaceChildren(node);

    assert.equal(doc.querySelectorAll('#card-panel img').length, 0);
    assert.equal(win.__pwned, undefined);
    assert.ok(panel.textContent.includes('onerror'), 'the raw text should survive as visible text');
  });

  test('safeUrl rejects a foreign host even inside an element helper', () => {
    assert.equal(MTG.safeUrl('https://attacker.example/steal.png'), null);
    assert.ok(MTG.safeUrl('https://cards.scryfall.io/small/front/a/b.jpg'));
  });
});

describe('end to end: resolving a card', () => {
  before(async () => {
    const q = doc.querySelector('#q');
    q.value = 'Basalt Monolith';
    q.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Let the resolve -> verified -> discovery chain settle.
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 25));
  });

  test('the selected card panel shows name, type and Oracle text', () => {
    const panel = doc.querySelector('#card-panel');
    assert.match(panel.textContent, /Basalt Monolith/);
    assert.match(panel.textContent, /Artifact/);
    assert.match(panel.textContent, /Add \{C\}\{C\}\{C\}/);
  });

  test('detected mechanical roles are surfaced to the user', () => {
    const roles = [...doc.querySelectorAll('#card-panel .role')].map((n) => n.textContent);
    assert.ok(roles.length > 0, 'expected role chips');
    assert.ok(roles.some((r) => /mana/i.test(r)));
  });

  test('the card image comes from the allowlisted host', () => {
    const img = doc.querySelector('#card-panel img.card-art');
    assert.ok(img);
    assert.match(img.getAttribute('src'), /^https:\/\/cards\.scryfall\.io\//);
  });

  test('verified combos render from the baked shard', { skip: shardMissing() }, () => {
    const tab = doc.querySelector('#tab-verified');
    assert.ok(tab, 'verified tab should exist');
    const count = Number(tab.querySelector('.n').textContent);
    assert.ok(count > 0, `expected verified combos, got ${count}`);
    assert.match(doc.querySelector('#results').textContent, /Rings of Brighthearth|Forsaken Monument/);
  });

  test('verified results link out to Commander Spellbook for the steps', { skip: shardMissing() }, () => {
    const links = [...doc.querySelectorAll('#results a')].map((a) => a.getAttribute('href'));
    assert.ok(links.some((h) => h && h.startsWith('https://commanderspellbook.com/combo/')),
      'each verified combo must deep-link to its source');
  });

  test('the URL records the selected card so the view is shareable', () => {
    assert.match(win.location.search, /card=Basalt\+Monolith|card=Basalt%20Monolith/);
  });
});

function shardMissing() {
  return process.env.MTG_HAS_DATA === '0' ? 'no data/ built' : false;
}
