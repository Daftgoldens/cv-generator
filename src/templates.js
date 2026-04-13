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

const LOCATION_HINTS = [
  { pattern: /\bparis\b/i, label: 'Paris, France' },
  { pattern: /\blyon\b/i, label: 'Lyon, France' },
  { pattern: /\bmarseille\b/i, label: 'Marseille, France' },
  { pattern: /\bborderaux\b/i, label: 'Bordeaux, France' },
  { pattern: /\btoulouse\b/i, label: 'Toulouse, France' },
  { pattern: /\bnantes\b/i, label: 'Nantes, France' },
  { pattern: /\bfrance\b/i, label: 'Paris, France' },
  { pattern: /\bnew york\b/i, label: 'New York, USA' },
  { pattern: /\bsan francisco\b/i, label: 'San Francisco, USA' },
  { pattern: /\bseattle\b/i, label: 'Seattle, USA' },
  { pattern: /\baustin\b/i, label: 'Austin, USA' },
  { pattern: /\bboston\b/i, label: 'Boston, USA' },
  { pattern: /\bchicago\b/i, label: 'Chicago, USA' },
  { pattern: /\blos angeles\b/i, label: 'Los Angeles, USA' },
  { pattern: /\bdenver\b/i, label: 'Denver, USA' },
  { pattern: /\bunited states\b|\busa\b|\bu\.s\.a\b/i, label: 'New York, USA' },
  { pattern: /\btoronto\b/i, label: 'Toronto, Canada' },
  { pattern: /\bmontreal\b|\bmontréal\b/i, label: 'Montreal, Canada' },
  { pattern: /\bvancouver\b/i, label: 'Vancouver, Canada' },
  { pattern: /\bcanada\b/i, label: 'Toronto, Canada' },
  { pattern: /\bsingapore\b/i, label: 'Singapore' },
  { pattern: /\bhong kong\b/i, label: 'Hong Kong' },
  { pattern: /\bseoul\b/i, label: 'Seoul, South Korea' },
  { pattern: /\bsouth korea\b|\bkorea\b/i, label: 'Seoul, South Korea' },
  { pattern: /\btokyo\b/i, label: 'Tokyo, Japan' },
  { pattern: /\bosaka\b/i, label: 'Osaka, Japan' },
  { pattern: /\bjapan\b/i, label: 'Tokyo, Japan' },
  { pattern: /\blondon\b/i, label: 'London, UK' },
  { pattern: /\bunited kingdom\b|\buk\b/i, label: 'London, UK' },
  { pattern: /\bberlin\b/i, label: 'Berlin, Germany' },
  { pattern: /\bamsterdam\b/i, label: 'Amsterdam, Netherlands' },
  { pattern: /\bdubai\b/i, label: 'Dubai, UAE' },
  { pattern: /\bremote\b/i, label: 'Remote' },
];

function extractLocation(offerText) {
  for (const hint of LOCATION_HINTS) {
    if (hint.pattern.test(offerText)) return hint.label;
  }
  return null;
}

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

module.exports = { detectLanguage, detectRegion, selectTemplate, loadTemplate, extractLocation };
