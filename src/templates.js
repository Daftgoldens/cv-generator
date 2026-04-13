'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

const FR_WORDS = ['nous', 'recherchons', 'pour', 'dans', 'notre', 'une', 'les', 'des', 'qui', 'avec', 'vous', 'poste', 'entreprise', 'rejoindre', 'équipe'];

function detectLanguage(text) {
  const lower = text.toLowerCase();
  // require 3+ French indicator words to reduce false positives
  const frCount = FR_WORDS.filter(w => new RegExp(`\\b${w}\\b`).test(lower)).length;
  return frCount >= 3 ? 'fr' : 'en';
}

const REGION_MAP = [
  { keywords: ['france', 'paris', 'lyon', 'marseille', 'bordeaux', 'toulouse', 'nantes'], region: 'france' },
  { keywords: ['usa', 'united states', 'new york', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'canada', 'toronto', 'montreal', 'vancouver'], region: 'usa-canada' },
  { keywords: ['singapore', 'south korea', 'korea', 'seoul', 'hong kong', 'hk'], region: 'asia' },
  { keywords: ['japan', 'tokyo', 'osaka'], region: 'japan' },
];

function detectRegion(location) {
  const lower = location.toLowerCase();
  for (const entry of REGION_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) {
      return entry.region;
    }
  }
  return 'other';
}

function selectTemplate(region, language) {
  if (region === 'france' && language === 'fr') return 'CV_France.md';
  if (region === 'asia') return 'Resume_Singapore_SouthKorea.md';
  if (region === 'japan') return 'Resume_Japan.md';
  return 'Resume_USA_Canada.md';
}

function loadTemplate(filename) {
  const filePath = path.join(TEMPLATES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${filename}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

module.exports = { detectLanguage, detectRegion, selectTemplate, loadTemplate };
