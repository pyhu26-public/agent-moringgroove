import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWikiLinks, parseWiki, WIKI } from '../src/render.js';

test('parseWiki: target / heading / alias', () => {
  assert.deepEqual(parseWiki('Page'), { target: 'Page', heading: null, alias: null });
  assert.deepEqual(parseWiki('Page#Intro|보기'), { target: 'Page', heading: 'Intro', alias: '보기' });
  assert.deepEqual(parseWiki(' a b | x '), { target: 'a b', heading: null, alias: 'x' });
});
test('extractWikiLinks finds every link, ignores broken ones', () => {
  assert.deepEqual(extractWikiLinks('see [[a]] and [[b|B]] and [[c#h]] but not [[ and [x]'), ['a', 'b', 'c']);
  assert.equal(WIKI.global, true);
});
