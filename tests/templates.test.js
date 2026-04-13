const { test } = require('node:test');
const assert = require('node:assert');
const { detectLanguage, detectRegion, selectTemplate } = require('../src/templates.js');

test('detectLanguage returns fr for French text', () => {
  assert.strictEqual(detectLanguage('Nous recherchons un ingénieur data pour rejoindre notre équipe'), 'fr');
});

test('detectLanguage returns en for English text', () => {
  assert.strictEqual(detectLanguage('We are looking for a data engineer to join our team'), 'en');
});

test('detectLanguage defaults to en for ambiguous text', () => {
  assert.strictEqual(detectLanguage('AI ML Python'), 'en');
});

test('detectRegion returns france for Paris', () => {
  assert.strictEqual(detectRegion('Paris, France'), 'france');
});

test('detectRegion returns usa-canada for New York', () => {
  assert.strictEqual(detectRegion('New York, USA'), 'usa-canada');
});

test('detectRegion returns usa-canada for Toronto', () => {
  assert.strictEqual(detectRegion('Toronto, Canada'), 'usa-canada');
});

test('detectRegion returns asia for Singapore', () => {
  assert.strictEqual(detectRegion('Singapore'), 'asia');
});

test('detectRegion returns asia for Seoul', () => {
  assert.strictEqual(detectRegion('Seoul, South Korea'), 'asia');
});

test('detectRegion returns japan for Tokyo', () => {
  assert.strictEqual(detectRegion('Tokyo, Japan'), 'japan');
});

test('detectRegion returns other for unknown', () => {
  assert.strictEqual(detectRegion('Berlin, Germany'), 'other');
});

test('selectTemplate france+fr returns CV_France.md', () => {
  assert.strictEqual(selectTemplate('france', 'fr'), 'CV_France.md');
});

test('selectTemplate france+en returns Resume_USA_Canada.md', () => {
  assert.strictEqual(selectTemplate('france', 'en'), 'Resume_USA_Canada.md');
});

test('selectTemplate usa-canada returns Resume_USA_Canada.md', () => {
  assert.strictEqual(selectTemplate('usa-canada', 'en'), 'Resume_USA_Canada.md');
});

test('selectTemplate asia returns Resume_Singapore_SouthKorea.md', () => {
  assert.strictEqual(selectTemplate('asia', 'en'), 'Resume_Singapore_SouthKorea.md');
});

test('selectTemplate japan returns Resume_Japan.md', () => {
  assert.strictEqual(selectTemplate('japan', 'en'), 'Resume_Japan.md');
});

test('selectTemplate other defaults to Resume_USA_Canada.md', () => {
  assert.strictEqual(selectTemplate('other', 'en'), 'Resume_USA_Canada.md');
});
