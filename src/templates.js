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
  { keywords: ['france', 'paris', 'lyon', 'marseille', 'bordeaux', 'toulouse', 'nantes', 'lille', 'strasbourg', 'rennes', 'grenoble', 'montpellier', 'nice'], region: 'france' },
  { keywords: ['usa', 'united states', 'u.s.a', 'new york', 'nyc', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'los angeles', 'denver', 'miami', 'atlanta', 'dallas', 'houston', 'washington', 'portland', 'philadelphia', 'san diego', 'las vegas', 'phoenix', 'minneapolis', 'detroit', 'pittsburgh', 'raleigh', 'salt lake', 'nashville', 'charlotte', 'canada', 'toronto', 'montreal', 'vancouver', 'calgary', 'ottawa', 'edmonton', 'australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'canberra', 'uk', 'united kingdom', 'london', 'manchester', 'birmingham', 'edinburgh', 'ireland', 'dublin', 'new zealand', 'auckland'], region: 'usa-canada' },
  { keywords: ['singapore', 'south korea', 'korea', 'seoul', 'hong kong'], region: 'asia' },
  { keywords: ['japan', 'tokyo', 'osaka', 'kyoto'], region: 'japan' },
];

const LOCATION_HINTS = [
  // France
  { pattern: /\bparis\b/i, label: 'Paris, France' },
  { pattern: /\blyon\b/i, label: 'Lyon, France' },
  { pattern: /\bmarseille\b/i, label: 'Marseille, France' },
  { pattern: /\bbordeaux\b/i, label: 'Bordeaux, France' },
  { pattern: /\btoulouse\b/i, label: 'Toulouse, France' },
  { pattern: /\bnantes\b/i, label: 'Nantes, France' },
  { pattern: /\blille\b/i, label: 'Lille, France' },
  { pattern: /\bstrasbourg\b/i, label: 'Strasbourg, France' },
  { pattern: /\brennes\b/i, label: 'Rennes, France' },
  { pattern: /\bgrenoble\b/i, label: 'Grenoble, France' },
  { pattern: /\bmontpellier\b/i, label: 'Montpellier, France' },
  { pattern: /\bNice\b(?=,?\s*(France|FR|06)|\s*–|\s*\()/i, label: 'Nice, France' },
  { pattern: /\bfrance\b/i, label: 'Paris, France' },
  // USA
  { pattern: /\bnew york\b|\bnyc\b|\bnew york city\b/i, label: 'New York, USA' },
  { pattern: /\bsan francisco\b|\bsilicon valley\b|\bpalo alto\b|\bmenlo park\b|\bmountain view\b|\bsunnyvale\b|\bsan jose\b/i, label: 'San Francisco, USA' },
  { pattern: /\bseattle\b|\bredmond\b|\bbellevue\b/i, label: 'Seattle, USA' },
  { pattern: /\baustin\b/i, label: 'Austin, USA' },
  { pattern: /\bboston\b|\bcambridge,?\s*(ma|massachusetts)\b/i, label: 'Boston, USA' },
  { pattern: /\bchicago\b/i, label: 'Chicago, USA' },
  { pattern: /\blos angeles\b|\bla,?\s*ca\b|\bsanta monica\b|\bculver city\b/i, label: 'Los Angeles, USA' },
  { pattern: /\bdenver\b/i, label: 'Denver, USA' },
  { pattern: /\bmiami\b/i, label: 'Miami, USA' },
  { pattern: /\batlanta\b/i, label: 'Atlanta, USA' },
  { pattern: /\bdallas\b|\bfort worth\b/i, label: 'Dallas, USA' },
  { pattern: /\bhouston\b/i, label: 'Houston, USA' },
  { pattern: /\bwashington\s*d\.?c\.?\b|\bdc\b/i, label: 'Washington DC, USA' },
  { pattern: /\bportland\b/i, label: 'Portland, USA' },
  { pattern: /\bphiladelphia\b/i, label: 'Philadelphia, USA' },
  { pattern: /\bsan diego\b/i, label: 'San Diego, USA' },
  { pattern: /\blas vegas\b/i, label: 'Las Vegas, USA' },
  { pattern: /\bphoenix\b/i, label: 'Phoenix, USA' },
  { pattern: /\bminneapolis\b/i, label: 'Minneapolis, USA' },
  { pattern: /\bnashville\b/i, label: 'Nashville, USA' },
  { pattern: /\braleigh\b/i, label: 'Raleigh, USA' },
  { pattern: /\bcharlotte\b/i, label: 'Charlotte, USA' },
  { pattern: /\bpittsburgh\b/i, label: 'Pittsburgh, USA' },
  { pattern: /\bsalt lake\b/i, label: 'Salt Lake City, USA' },
  { pattern: /\bunited states\b|\busa\b|\bu\.s\.a\.?\b/i, label: 'New York, USA' },
  // Canada
  { pattern: /\btoronto\b/i, label: 'Toronto, Canada' },
  { pattern: /\bmontreal\b|\bmontréal\b/i, label: 'Montreal, Canada' },
  { pattern: /\bvancouver\b/i, label: 'Vancouver, Canada' },
  { pattern: /\bcalgary\b/i, label: 'Calgary, Canada' },
  { pattern: /\bottawa\b/i, label: 'Ottawa, Canada' },
  { pattern: /\bedmonton\b/i, label: 'Edmonton, Canada' },
  { pattern: /\bcanada\b/i, label: 'Toronto, Canada' },
  // Australia
  { pattern: /\bsydney\b/i, label: 'Sydney, Australia' },
  { pattern: /\bmelbourne\b/i, label: 'Melbourne, Australia' },
  { pattern: /\bbrisbane\b/i, label: 'Brisbane, Australia' },
  { pattern: /\bperth\b/i, label: 'Perth, Australia' },
  { pattern: /\bcanberra\b/i, label: 'Canberra, Australia' },
  { pattern: /\baustralia\b/i, label: 'Sydney, Australia' },
  // UK & Ireland
  { pattern: /\blondon\b/i, label: 'London, UK' },
  { pattern: /\bmanchester\b/i, label: 'Manchester, UK' },
  { pattern: /\bbirmingham\b/i, label: 'Birmingham, UK' },
  { pattern: /\bedinburgh\b/i, label: 'Edinburgh, UK' },
  { pattern: /\bunited kingdom\b|\buk\b/i, label: 'London, UK' },
  { pattern: /\bdublin\b/i, label: 'Dublin, Ireland' },
  { pattern: /\bireland\b/i, label: 'Dublin, Ireland' },
  // New Zealand
  { pattern: /\bauckland\b/i, label: 'Auckland, New Zealand' },
  { pattern: /\bnew zealand\b/i, label: 'Auckland, New Zealand' },
  // Asia
  { pattern: /\bsingapore\b/i, label: 'Singapore' },
  { pattern: /\bhong kong\b/i, label: 'Hong Kong' },
  { pattern: /\bseoul\b/i, label: 'Seoul, South Korea' },
  { pattern: /\bsouth korea\b|\bkorea\b/i, label: 'Seoul, South Korea' },
  { pattern: /\btokyo\b/i, label: 'Tokyo, Japan' },
  { pattern: /\bosaka\b/i, label: 'Osaka, Japan' },
  { pattern: /\bkyoto\b/i, label: 'Kyoto, Japan' },
  { pattern: /\bjapan\b/i, label: 'Tokyo, Japan' },
  // Europe — cities
  { pattern: /\bberlin\b/i, label: 'Berlin, Germany' },
  { pattern: /\bmunich\b|\bmuenchen\b/i, label: 'Munich, Germany' },
  { pattern: /\bfrankfurt\b/i, label: 'Frankfurt, Germany' },
  { pattern: /\bhamburg\b/i, label: 'Hamburg, Germany' },
  { pattern: /\bcologne\b|\bköln\b/i, label: 'Cologne, Germany' },
  { pattern: /\bdusseldorf\b|\bdüsseldorf\b/i, label: 'Dusseldorf, Germany' },
  { pattern: /\bamsterdam\b/i, label: 'Amsterdam, Netherlands' },
  { pattern: /\brotterdam\b/i, label: 'Rotterdam, Netherlands' },
  { pattern: /\bbarcelona\b/i, label: 'Barcelona, Spain' },
  { pattern: /\bmadrid\b/i, label: 'Madrid, Spain' },
  { pattern: /\bvalencia\b/i, label: 'Valencia, Spain' },
  { pattern: /\blisbon\b|\blisbonne\b|\blisboa\b/i, label: 'Lisbon, Portugal' },
  { pattern: /\bporto\b/i, label: 'Porto, Portugal' },
  { pattern: /\bstockholm\b/i, label: 'Stockholm, Sweden' },
  { pattern: /\bgothenburg\b|\bgöteborg\b/i, label: 'Gothenburg, Sweden' },
  { pattern: /\bcopenhagen\b|\bcopenhague\b|\bkøbenhavn\b/i, label: 'Copenhagen, Denmark' },
  { pattern: /\bzurich\b|\bzürich\b/i, label: 'Zurich, Switzerland' },
  { pattern: /\bgeneva\b|\bgenève\b/i, label: 'Geneva, Switzerland' },
  { pattern: /\bbrussels\b|\bbruxelles\b/i, label: 'Brussels, Belgium' },
  { pattern: /\bvienna\b|\bvienne\b|\bwien\b/i, label: 'Vienna, Austria' },
  { pattern: /\bwarsaw\b|\bvarsovie\b|\bwarszawa\b/i, label: 'Warsaw, Poland' },
  { pattern: /\bpragué?\b|\bpraha\b/i, label: 'Prague, Czech Republic' },
  { pattern: /\bmilan\b|\bmilano\b/i, label: 'Milan, Italy' },
  { pattern: /\brome\b|\broma\b/i, label: 'Rome, Italy' },
  { pattern: /\bhelsinki\b/i, label: 'Helsinki, Finland' },
  { pattern: /\boslo\b/i, label: 'Oslo, Norway' },
  // Europe — countries (fallback when no city matched)
  { pattern: /\bgermany\b|\ballemagne\b/i, label: 'Berlin, Germany' },
  { pattern: /\bnetherlands\b|\bpays-?bas\b/i, label: 'Amsterdam, Netherlands' },
  { pattern: /\bspain\b|\bespagne\b/i, label: 'Madrid, Spain' },
  { pattern: /\bportugal\b/i, label: 'Lisbon, Portugal' },
  { pattern: /\bsweden\b|\bsuède\b/i, label: 'Stockholm, Sweden' },
  { pattern: /\bdenmark\b|\bdanemark\b/i, label: 'Copenhagen, Denmark' },
  { pattern: /\bswitzerland\b|\bsuisse\b/i, label: 'Zurich, Switzerland' },
  { pattern: /\bbelgium\b|\bbbelgique\b/i, label: 'Brussels, Belgium' },
  { pattern: /\baustria\b|\bautriche\b/i, label: 'Vienna, Austria' },
  { pattern: /\bpoland\b|\bpologne\b/i, label: 'Warsaw, Poland' },
  { pattern: /\bitaly\b|\bitalie\b/i, label: 'Milan, Italy' },
  { pattern: /\bfinland\b|\bfinlande\b/i, label: 'Helsinki, Finland' },
  { pattern: /\bnorway\b|\bnorvège\b/i, label: 'Oslo, Norway' },
  // Middle East
  { pattern: /\bdubai\b/i, label: 'Dubai, UAE' },
  { pattern: /\babu dhabi\b/i, label: 'Abu Dhabi, UAE' },
  { pattern: /\buae\b|\bu\.a\.e\b/i, label: 'Dubai, UAE' },
  { pattern: /\btel aviv\b/i, label: 'Tel Aviv, Israel' },
  // Remote
  { pattern: /\bremote\b|\btélétravail\b|\bdistrib[ué]/i, label: 'Remote' },
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
