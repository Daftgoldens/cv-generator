'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// === Language detection by ratio (not absolute count) ===
//
// The old approach (count FR words, threshold) failed on pages where the UI chrome
// is in one language and the JD content is in another (typical: LinkedIn scraped from
// France serves a French chrome around an English JD posting).
//
// New approach: count occurrences (not just presence) of strong FR markers AND
// strong EN markers, then decide by ratio. If FR >> EN → French; if EN >> FR → English;
// if comparable → fall back to where the markers are densest (the JD content tends
// to be longer and continuous, so we also count total occurrences not unique words).

// Strongly French — verbs, function words rarely appearing in English text.
// Each entry: weight × pattern. Conjugated verbs (recherchons, rejoindre) are higher signal.
const FR_MARKERS = [
  { w: 3, re: /\brecherchons\b/gi },
  { w: 3, re: /\brejoindre\b/gi },
  { w: 3, re: /\bcandidature\b/gi },
  { w: 3, re: /\bcompétences\b/gi },
  { w: 3, re: /\bexpériences?\b/gi },
  { w: 3, re: /\bdéveloppement\b/gi },
  { w: 3, re: /\bnotre\s+équipe\b/gi },
  { w: 2, re: /\bnous\b/gi },
  { w: 2, re: /\bnotre\b/gi },
  { w: 2, re: /\bnos\b/gi },
  { w: 2, re: /\bvotre\b/gi },
  { w: 2, re: /\bvos\b/gi },
  { w: 2, re: /\béquipe\b/gi },
  { w: 2, re: /\bentreprise\b/gi },
  { w: 2, re: /\bmission\b/gi },
  { w: 2, re: /\bprofil\b/gi },
  { w: 2, re: /\bsavoir\b/gi },
  { w: 2, re: /\bavez\b/gi },
  { w: 2, re: /\bêtes\b/gi },
  { w: 2, re: /\bserez\b/gi },
  { w: 2, re: /\bdevez\b/gi },
  { w: 2, re: /\bpourrez\b/gi },
  { w: 2, re: /\bcette\b/gi },
  { w: 2, re: /\bdepuis\b/gi },
  { w: 2, re: /\bpendant\b/gi },
  { w: 2, re: /\bévoluer\b/gi },
  { w: 1, re: /\bplusieurs\b/gi },
  { w: 1, re: /\bainsi\b/gi },
  { w: 1, re: /\baussi\b/gi },
];

// Strongly English — common JD verbs and function words that almost never appear in French JDs.
const EN_MARKERS = [
  { w: 3, re: /\bwe are looking\b/gi },
  { w: 3, re: /\bwe're looking\b/gi },
  { w: 3, re: /\bwe are hiring\b/gi },
  { w: 3, re: /\byou will\b/gi },
  { w: 3, re: /\byou'll\b/gi },
  { w: 3, re: /\brequirements\b/gi },
  { w: 3, re: /\bresponsibilities\b/gi },
  { w: 3, re: /\bexperience with\b/gi },
  { w: 3, re: /\bstrong\s+(experience|background|knowledge)\b/gi },
  { w: 2, re: /\babout\s+(us|the\s+role|the\s+team)\b/gi },
  { w: 2, re: /\bplease\b/gi },
  { w: 2, re: /\boffice\b/gi },
  { w: 2, re: /\bteam\b/gi },
  { w: 2, re: /\bcompany\b/gi },
  { w: 2, re: /\brole\b/gi },
  { w: 2, re: /\bsuch as\b/gi },
  { w: 2, re: /\bability to\b/gi },
  { w: 2, re: /\bproven\b/gi },
  { w: 2, re: /\bnice to have\b/gi },
  { w: 2, re: /\bmust have\b/gi },
  { w: 1, re: /\bwith\b/gi },
  { w: 1, re: /\babout\b/gi },
  { w: 1, re: /\bskills\b/gi },
];

function scoreLanguage(text, markers) {
  let score = 0;
  for (const { w, re } of markers) {
    const matches = text.match(re);
    if (matches) score += w * matches.length;
  }
  return score;
}

function detectLanguage(text) {
  if (!text) return 'en';
  const lower = text.toLowerCase();
  const frScore = scoreLanguage(lower, FR_MARKERS);
  const enScore = scoreLanguage(lower, EN_MARKERS);

  // Default to English when nothing meaningful matches (very short or non-prose text)
  if (frScore < 4 && enScore < 4) return 'en';

  // French only wins if it has a meaningful advantage over English.
  // This handles the LinkedIn case: even if the chrome adds ~5-10 French points,
  // a real English JD will accumulate 20-40 English points.
  return frScore > enScore * 1.3 ? 'fr' : 'en';
}

const REGION_MAP = [
  { keywords: ['france', 'paris', 'lyon', 'marseille', 'bordeaux', 'toulouse', 'nantes', 'lille', 'strasbourg', 'rennes', 'grenoble', 'montpellier', 'nice'], region: 'france' },
  { keywords: ['usa', 'united states', 'u.s.a', 'new york', 'nyc', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'los angeles', 'denver', 'miami', 'atlanta', 'dallas', 'houston', 'washington', 'portland', 'philadelphia', 'san diego', 'las vegas', 'phoenix', 'minneapolis', 'detroit', 'pittsburgh', 'raleigh', 'salt lake', 'nashville', 'charlotte', 'canada', 'toronto', 'montreal', 'vancouver', 'calgary', 'ottawa', 'edmonton', 'australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'canberra', 'uk', 'united kingdom', 'london', 'manchester', 'birmingham', 'edinburgh', 'ireland', 'dublin', 'new zealand', 'auckland'], region: 'usa-canada' },
  { keywords: ['singapore', 'south korea', 'korea', 'seoul', 'hong kong'], region: 'asia' },
  { keywords: ['japan', 'tokyo', 'osaka', 'kyoto'], region: 'japan' },
];

// LOCATION_HINTS — patterns ordonnés : les plus spécifiques (ville + état) AVANT les génériques (pays).
// On a aussi groupé pour éviter qu'une mention secondaire (siège social dans le footer)
// gagne sur la vraie location du poste.
const LOCATION_HINTS = [
  // === USA — villes prioritaires ===
  { pattern: /\bnew york\b|\bnyc\b|\bnew york city\b/i, label: 'New York, USA' },
  { pattern: /\bsan francisco\b|\bsf bay area\b|\bsilicon valley\b|\bpalo alto\b|\bmenlo park\b|\bmountain view\b|\bsunnyvale\b|\bsan jose\b/i, label: 'San Francisco, USA' },
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
  { pattern: /\bwashington\s*d\.?c\.?\b|\bwashington,\s*dc\b/i, label: 'Washington DC, USA' },
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
  // === France — villes ===
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
  // === Canada ===
  { pattern: /\btoronto\b/i, label: 'Toronto, Canada' },
  { pattern: /\bmontreal\b|\bmontréal\b/i, label: 'Montreal, Canada' },
  { pattern: /\bvancouver\b/i, label: 'Vancouver, Canada' },
  { pattern: /\bcalgary\b/i, label: 'Calgary, Canada' },
  { pattern: /\bottawa\b/i, label: 'Ottawa, Canada' },
  { pattern: /\bedmonton\b/i, label: 'Edmonton, Canada' },
  // === Australia ===
  { pattern: /\bsydney\b/i, label: 'Sydney, Australia' },
  { pattern: /\bmelbourne\b/i, label: 'Melbourne, Australia' },
  { pattern: /\bbrisbane\b/i, label: 'Brisbane, Australia' },
  { pattern: /\bperth\b/i, label: 'Perth, Australia' },
  { pattern: /\bcanberra\b/i, label: 'Canberra, Australia' },
  // === UK & Ireland ===
  { pattern: /\blondon\b/i, label: 'London, UK' },
  { pattern: /\bmanchester\b/i, label: 'Manchester, UK' },
  { pattern: /\bbirmingham\b/i, label: 'Birmingham, UK' },
  { pattern: /\bedinburgh\b/i, label: 'Edinburgh, UK' },
  { pattern: /\bdublin\b/i, label: 'Dublin, Ireland' },
  // === New Zealand ===
  { pattern: /\bauckland\b/i, label: 'Auckland, New Zealand' },
  // === Asia ===
  { pattern: /\bsingapore\b/i, label: 'Singapore' },
  { pattern: /\bhong kong\b/i, label: 'Hong Kong' },
  { pattern: /\bseoul\b/i, label: 'Seoul, South Korea' },
  { pattern: /\btokyo\b/i, label: 'Tokyo, Japan' },
  { pattern: /\bosaka\b/i, label: 'Osaka, Japan' },
  { pattern: /\bkyoto\b/i, label: 'Kyoto, Japan' },
  // === Europe — villes ===
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
  { pattern: /\bprague\b|\bpraha\b/i, label: 'Prague, Czech Republic' },
  { pattern: /\bmilan\b|\bmilano\b/i, label: 'Milan, Italy' },
  { pattern: /\brome\b|\broma\b/i, label: 'Rome, Italy' },
  { pattern: /\bhelsinki\b/i, label: 'Helsinki, Finland' },
  { pattern: /\boslo\b/i, label: 'Oslo, Norway' },
  // === Middle East ===
  { pattern: /\bdubai\b/i, label: 'Dubai, UAE' },
  { pattern: /\babu dhabi\b/i, label: 'Abu Dhabi, UAE' },
  { pattern: /\btel aviv\b/i, label: 'Tel Aviv, Israel' },
  // === Remote ===
  { pattern: /\b(fully|100%|completely)?\s*remote\b|\btélétravail\b|\bwork from home\b|\bwfh\b/i, label: 'Remote' },
  // === Pays seuls (fallback en DERNIER, après toutes les villes) ===
  { pattern: /\bunited states\b|\busa\b|\bu\.s\.a\.?\b|\bunited states of america\b/i, label: 'New York, USA' },
  { pattern: /\bunited kingdom\b|\buk\b/i, label: 'London, UK' },
  { pattern: /\bireland\b/i, label: 'Dublin, Ireland' },
  { pattern: /\bnew zealand\b/i, label: 'Auckland, New Zealand' },
  { pattern: /\bcanada\b/i, label: 'Toronto, Canada' },
  { pattern: /\baustralia\b/i, label: 'Sydney, Australia' },
  { pattern: /\bsouth korea\b|\bkorea\b/i, label: 'Seoul, South Korea' },
  { pattern: /\bjapan\b/i, label: 'Tokyo, Japan' },
  { pattern: /\bgermany\b|\ballemagne\b/i, label: 'Berlin, Germany' },
  { pattern: /\bnetherlands\b|\bpays-?bas\b/i, label: 'Amsterdam, Netherlands' },
  { pattern: /\bspain\b|\bespagne\b/i, label: 'Madrid, Spain' },
  { pattern: /\bportugal\b/i, label: 'Lisbon, Portugal' },
  { pattern: /\bsweden\b|\bsuède\b/i, label: 'Stockholm, Sweden' },
  { pattern: /\bdenmark\b|\bdanemark\b/i, label: 'Copenhagen, Denmark' },
  { pattern: /\bswitzerland\b|\bsuisse\b/i, label: 'Zurich, Switzerland' },
  { pattern: /\bbelgium\b|\bbelgique\b/i, label: 'Brussels, Belgium' },
  { pattern: /\baustria\b|\bautriche\b/i, label: 'Vienna, Austria' },
  { pattern: /\bpoland\b|\bpologne\b/i, label: 'Warsaw, Poland' },
  { pattern: /\bitaly\b|\bitalie\b/i, label: 'Milan, Italy' },
  { pattern: /\bfinland\b|\bfinlande\b/i, label: 'Helsinki, Finland' },
  { pattern: /\bnorway\b|\bnorvège\b/i, label: 'Oslo, Norway' },
  { pattern: /\buae\b|\bu\.a\.e\b/i, label: 'Dubai, UAE' },
  { pattern: /\bisrael\b/i, label: 'Tel Aviv, Israel' },
  // Pays France EN DERNIER — seulement si aucune ville française détectée
  { pattern: /\bfrance\b/i, label: 'Paris, France' },
];

// extractLocation : essaie d'identifier la VRAIE location du poste,
// pas une mention secondaire. Stratégie : on score chaque match par sa "centralité"
// dans le texte (proximité de mots-clés type "based in", "location", "office", etc.).
// Si la meilleure correspondance est un "Remote" sans contexte géographique, on essaie
// d'inférer le pays depuis la devise utilisée pour le salaire ($, €, £, ¥, etc.).
function extractLocation(offerText) {
  if (!offerText) return null;

  // Marqueurs forts qui signalent une location réelle (poste/bureau)
  const LOCATION_MARKERS = [
    /\b(location|based in|based at|office in|located in|position based|role based|onsite in|on-site in|hq in|headquartered in)\b/gi,
    /\b(lieu|localisation|basé[e]?\s*à|poste basé|bureau à)\b/gi,
  ];

  // Collect all marker positions in the text
  const markerPositions = [];
  for (const re of LOCATION_MARKERS) {
    let m;
    while ((m = re.exec(offerText)) !== null) {
      markerPositions.push(m.index);
    }
  }

  let best = null;
  let bestScore = -1;

  for (const hint of LOCATION_HINTS) {
    const match = hint.pattern.exec(offerText);
    if (!match) continue;

    // Score = closeness to a location marker. Default = 0 (just a mention).
    let score = 1; // base score (any match beats no match)
    for (const pos of markerPositions) {
      const dist = Math.abs(match.index - pos);
      if (dist < 80) {
        // Within ~80 chars of a "based in" / "location:" → strong signal
        score = 100 - dist;
        break;
      }
    }

    // Bonus: first occurrence in the text (titles/headers usually appear early)
    if (match.index < 300) score += 5;

    if (score > bestScore) {
      bestScore = score;
      best = hint.label;
    }
  }

  // === Currency-based country inference for ambiguous "Remote" ===
  // If we matched "Remote" but no city, sniff the salary currency to guess the country.
  // We only do this for the bare "Remote" label, never to override a more specific result.
  if (best === 'Remote') {
    const inferred = inferRemoteCountryFromCurrency(offerText);
    if (inferred) best = inferred;
  }

  return best;
}

// Detect the salary currency in the offer and map it to a Remote (Country) label.
// Strategy: count currency symbol occurrences, pick the dominant one. Returns null
// if no clear signal (we'd rather keep "Remote" than guess wrong).
function inferRemoteCountryFromCurrency(text) {
  // Each pattern matches the currency in salary contexts (numbers nearby or per-period units)
  const CURRENCY_RULES = [
    {
      label: 'Remote (US)',
      patterns: [
        /\$\s?\d{2,}/g,                                  // "$50", "$100k"
        /\busd\b/gi,                                      // "USD"
        /\bus\s*dollars?\b/gi,
      ],
    },
    {
      label: 'Remote (France)',
      patterns: [
        /€\s?\d{2,}/g,                                    // "€60"
        /\d{2,}\s?€/g,                                    // "60€" / "60 €"
        /\beur\b/gi,                                      // "EUR"
        /\beuros?\b/gi,
      ],
    },
    {
      label: 'Remote (UK)',
      patterns: [
        /£\s?\d{2,}/g,                                    // "£50"
        /\bgbp\b/gi,
      ],
    },
    {
      label: 'Remote (Canada)',
      patterns: [
        /\bcad\b/gi,
        /\bcanadian\s+dollars?\b/gi,
        /\bc\$\s?\d{2,}/gi,
      ],
    },
    {
      label: 'Remote (Japan)',
      patterns: [
        /¥\s?\d{2,}/g,
        /\d{2,}\s?¥/g,
        /\bjpy\b/gi,
        /\d{2,}\s?yen\b/gi,
        /\d{1,2}[\s,.]?\d{3}[\s,.]?\d{3}\s?(yen|jpy)/gi,
      ],
    },
    {
      label: 'Remote (Singapore)',
      patterns: [
        /\bsgd\b/gi,
        /\bsg\$\s?\d{2,}/gi,
      ],
    },
  ];

  let bestLabel = null;
  let bestCount = 0;

  for (const rule of CURRENCY_RULES) {
    let count = 0;
    for (const re of rule.patterns) {
      const matches = text.match(re);
      if (matches) count += matches.length;
    }
    if (count > bestCount) {
      bestCount = count;
      bestLabel = rule.label;
    }
  }

  // Require at least 1 strong match — we don't want to over-infer
  return bestCount > 0 ? bestLabel : null;
}

function detectRegion(location) {
  if (!location) return 'other';
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

// === Visa sponsorship detection ===
//
// Returns one of:
//   'sponsored'    — Sponsorship explicitly offered (H1B, OPT, work visa supported)
//   'not_sponsored'— Sponsorship explicitly NOT offered ("must be authorized to work in X")
//   'locals_only' — Restricted to citizens/permanent residents/local nationals
//   'unspecified'  — No clear signal (default)
//
// Strategy: pattern-match BOTH positive and negative cues, then pick the strongest.
// Negative cues (not_sponsored / locals_only) win over positive in case of conflict,
// because an employer mentioning "we sponsor" but also "must be a US citizen" is
// effectively closed.

const SPONSORSHIP_POSITIVE = [
  // Explicit sponsorship offers
  /\b(visa|h[-\s]?1[-\s]?b|h1[-\s]?b|opt|stem\s*opt|cpt|tn\s*visa|o[-\s]?1|e[-\s]?3)\s+(sponsorship|sponsoring|sponsored|support|will\s+be\s+(provided|offered|considered)|available)\b/i,
  /\b(sponsorship|sponsoring)\s+(is|will\s+be)?\s*(available|provided|offered|supported)\b/i,
  /\bwe\s+(offer|provide|support|sponsor)\s+(visa|work\s+visa|h[-\s]?1[-\s]?b|sponsorship|relocation)\b/i,
  /\bwilling\s+to\s+sponsor\b/i,
  /\bopen\s+to\s+sponsoring\b/i,
  /\bvisa\s+sponsorship\s+(available|offered|provided|supported)\b/i,
  /\b(h[-\s]?1[-\s]?b|opt|stem\s*opt)\s+(transfer|candidates)\s+(welcome|encouraged|accepted)\b/i,
  /\b(work\s+authorization|sponsorship)\s+support\s+(may\s+be|is|will\s+be)\s+(available|provided)\b/i,
  /\bcandidates?\s+who\s+require\s+(u\.?s\.?\s+)?work\s+authorization\s+sponsorship\b/i,
  /\bencourage\s+applications?\s+from\s+candidates?\s+who\s+require\b/i,
];

// Pre-filter patterns that disqualify a positive match — used to detect "negations" that
// might appear right before a positive cue (e.g. "we do NOT provide visa sponsorship"
// would match the "we provide visa sponsorship" pattern without this check).
const NEGATION_PREFIX = /\b(no|not?|don'?t|do\s+not|cannot|can'?t|unable|won'?t|will\s+not|are\s+not)\b/i;

function hasNegationNear(text, matchIndex) {
  // Look at the 60 chars before the match for a negation word
  const window = text.slice(Math.max(0, matchIndex - 60), matchIndex);
  return NEGATION_PREFIX.test(window);
}

const SPONSORSHIP_NEGATIVE = [
  /\b(no|not?)\s+(visa\s+)?sponsorship\b/i,
  /\b(unable|do\s+not|cannot|can'?t|will\s+not|are\s+not\s+able)\s+(to\s+)?(provide|offer|support|sponsor)\s+(visa\s+)?(sponsorship)?\b/i,
  /\bsponsorship\s+(is\s+)?not\s+(available|offered|provided)\b/i,
  /\bnot\s+able\s+to\s+sponsor\b/i,
  /\bvisa\s+sponsorship\s+(is\s+)?(unavailable|not\s+available)\b/i,
  /\bwe\s+(do\s+not|don'?t|are\s+not\s+able\s+to|cannot|are\s+unable\s+to)\s+sponsor\b/i,
  /\bwithout\s+(the\s+)?need\s+for\s+(visa\s+)?sponsorship\b/i,
];

const LOCALS_ONLY = [
  // US-specific
  /\b(must|need|required)\s+(to\s+)?be\s+(a\s+)?(u\.?s\.?\s+|us\s+|american\s+)?(citizen|national)\b/i,
  /\b(u\.?s\.?|us|american)\s+citizens?\s+only\b/i,
  /\b(must|need)\s+(have|hold|possess)\s+(u\.?s\.?\s+|us\s+)?citizenship\b/i,
  /\b(green\s*card|permanent\s+resident)\s+(holders?\s+)?(only|required)\b/i,
  /\bmust\s+be\s+(legally\s+)?authorized\s+to\s+work\s+in\s+the\s+(u\.?s\.?|us|united\s+states)(\s+without\s+(sponsorship|visa))?/i,
  /\bauthorization\s+to\s+work\s+in\s+the\s+(u\.?s\.?|us|united\s+states)\s+(without\s+(restriction|sponsorship))\b/i,
  /\bsecurity\s+clearance\s+(required|needed)\b/i,
  /\b(secret|top\s+secret|ts\/sci)\s+clearance\b/i,
  // EU/UK
  /\bmust\s+have\s+(the\s+)?(right|legal\s+right)\s+to\s+work\s+in\s+(the\s+)?(uk|united\s+kingdom|eu|europe|france)\b/i,
  /\b(uk|eu)\s+(work\s+)?(authorization|authorisation|permit)\s+required\b/i,
  /\bautorisation\s+de\s+travail\s+(en\s+france|européenne)\s+(requise|obligatoire)\b/i,
];

function detectVisaSponsorship(offerText) {
  if (!offerText) return 'unspecified';

  let hasPositive = false;
  let hasNegative = false;
  let hasLocalsOnly = false;

  for (const re of SPONSORSHIP_POSITIVE) {
    const m = re.exec(offerText);
    if (m && !hasNegationNear(offerText, m.index)) {
      hasPositive = true;
      break;
    }
  }
  for (const re of SPONSORSHIP_NEGATIVE) {
    if (re.test(offerText)) { hasNegative = true; break; }
  }
  for (const re of LOCALS_ONLY) {
    if (re.test(offerText)) { hasLocalsOnly = true; break; }
  }

  // Locals-only is the strongest signal (citizen/clearance > sponsorship discussion)
  if (hasLocalsOnly) return 'locals_only';
  // Explicit "no sponsorship" beats implicit "we encourage" mentions
  if (hasNegative) return 'not_sponsored';
  if (hasPositive) return 'sponsored';
  return 'unspecified';
}

module.exports = { detectLanguage, detectRegion, selectTemplate, loadTemplate, extractLocation, detectVisaSponsorship };
