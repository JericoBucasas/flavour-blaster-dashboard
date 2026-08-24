'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('dashboard has one update lifecycle and loads continuous sections separately', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.equal((source.match(/\bcomponentDidUpdate\s*\(/g) || []).length, 1);
  assert.match(source, /componentDidUpdate\(prevState\)/);
  assert.doesNotMatch(source, /componentDidUpdate\([^)]*,/);
  assert.match(source, /\['overview','products','customers'\]/);
  assert.doesNotMatch(source, /\? 'all' : this\.state\.view/);
});
