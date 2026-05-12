const { test } = require('node:test');
const assert = require('node:assert');
const { detectLanguage, detectRegion, extractLocation, selectTemplate, detectVisaSponsorship } = require('../src/templates.js');

// === EXISTING TESTS (preserved) ===
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

// === NEW TESTS — detectLanguage false-positive regression ===

test('detectLanguage: English JD mentioning "June" does not trigger French', () => {
  // Old bug: "June" matched "une", inflating French count
  const text = 'We are hiring a senior data engineer starting in June 2026. Strong Python and SQL skills required.';
  assert.strictEqual(detectLanguage(text), 'en');
});

test('detectLanguage: English JD with city name "Paris" stays English', () => {
  // A San Francisco company with Paris office mentioned shouldn't trigger FR
  const text = 'Senior ML engineer at our San Francisco HQ. We have offices in Paris and London.';
  assert.strictEqual(detectLanguage(text), 'en');
});

test('detectLanguage: English JD with "pour" verb stays English', () => {
  // "pour" as English verb (pour the foundation) shouldn't trigger FR
  const text = 'Help us pour the foundation of our next-gen ML platform. We need engineers who can build at scale.';
  assert.strictEqual(detectLanguage(text), 'en');
});

test('detectLanguage: French JD with technical English terms still detected as fr', () => {
  const text = 'Nous recherchons un développeur Python pour rejoindre notre équipe. Vous travaillerez sur Kubernetes et Docker.';
  assert.strictEqual(detectLanguage(text), 'fr');
});

test('detectLanguage: handles empty or null input', () => {
  assert.strictEqual(detectLanguage(''), 'en');
  assert.strictEqual(detectLanguage(null), 'en');
  assert.strictEqual(detectLanguage(undefined), 'en');
});

// === NEW TESTS — extractLocation ===

test('extractLocation: prefers "Based in Boston" over secondary "Paris office" mention', () => {
  const text = `Senior AI Engineer
Based in Boston, MA. Hybrid 3 days a week.
We also have offices in Paris and Singapore for our European and APAC presence.`;
  assert.strictEqual(extractLocation(text), 'Boston, USA');
});

test('extractLocation: detects "Location: San Francisco"', () => {
  const text = 'Location: San Francisco, CA. Onsite required.';
  assert.strictEqual(extractLocation(text), 'San Francisco, USA');
});

test('extractLocation: detects French "Lieu: Lyon"', () => {
  const text = 'Lieu: Lyon, France. Télétravail partiel possible.';
  assert.strictEqual(extractLocation(text), 'Lyon, France');
});

test('extractLocation: returns null for empty text', () => {
  assert.strictEqual(extractLocation(''), null);
  assert.strictEqual(extractLocation(null), null);
});

test('extractLocation: detects Remote', () => {
  const text = 'This is a fully remote position. Work from anywhere.';
  assert.strictEqual(extractLocation(text), 'Remote');
});

test('extractLocation: prioritises city over country fallback', () => {
  // If both "Boston" and "United States" appear, city wins because it's earlier in the array
  const text = 'Role based in Boston, located in the United States.';
  assert.strictEqual(extractLocation(text), 'Boston, USA');
});

test('extractLocation: prioritises French city over country fallback', () => {
  const text = 'Poste basé à Bordeaux, en France.';
  assert.strictEqual(extractLocation(text), 'Bordeaux, France');
});

test('extractLocation: handles ambiguous text with no clear location', () => {
  const text = 'Great opportunity. Competitive salary. Stock options.';
  assert.strictEqual(extractLocation(text), null);
});

// === NEW TESTS — detectRegion robustness ===

test('detectRegion: returns other for null/empty location', () => {
  assert.strictEqual(detectRegion(null), 'other');
  assert.strictEqual(detectRegion(''), 'other');
});

test('detectRegion: case-insensitive', () => {
  assert.strictEqual(detectRegion('PARIS, FRANCE'), 'france');
  assert.strictEqual(detectRegion('boston, usa'), 'usa-canada');
});

// === NEW TESTS — mixed FR/EN pages (the LinkedIn scenario) ===

test('detectLanguage: LinkedIn-style page with FR chrome + EN job posting → en', () => {
  // Simulates a LinkedIn job page scraped from France:
  // ~10 lines of French UI chrome + a real English job description
  const text = `
    Voir le profil LinkedIn Postuler maintenant
    Recommandations Notifications Messages Mon réseau
    Emplois similaires Personnes que vous pourriez connaître
    Voir plus de résultats Charger plus
    À propos Carrières Centre d'aide

    Senior AI Engineer · Boston, MA

    About the role
    We are looking for a Senior AI Engineer to join our growing team in Boston.
    You will work with a team of world-class researchers and engineers to build
    production AI systems. You'll be responsible for designing scalable ML pipelines,
    deploying models, and collaborating with cross-functional teams.

    Requirements
    - Strong experience with Python, PyTorch, and distributed systems
    - Proven ability to ship production ML systems
    - Experience with cloud infrastructure (AWS or GCP)
    - Nice to have: experience with LLMs

    What we offer
    - Competitive salary and equity
    - Office in downtown Boston with hybrid flexibility
    - Strong engineering culture and ownership
  `;
  assert.strictEqual(detectLanguage(text), 'en');
});

test('detectLanguage: LinkedIn page with FR chrome + FR job posting → fr', () => {
  const text = `
    Voir le profil LinkedIn Postuler maintenant
    Recommandations Notifications Messages

    Ingénieur Data Senior · Paris, France

    À propos du poste
    Nous recherchons un ingénieur data senior pour rejoindre notre équipe à Paris.
    Vous travaillerez sur la conception de pipelines de données à grande échelle.
    Vous aurez l'opportunité d'évoluer dans un environnement technique stimulant.

    Profil recherché
    - Vous avez de solides compétences en Python et SQL
    - Vous êtes à l'aise avec les architectures cloud
    - Vous savez collaborer avec des équipes pluridisciplinaires
    - Plusieurs années d'expérience sont requises

    Notre entreprise
    Notre équipe est en pleine croissance. Rejoignez-nous pour développer
    des produits innovants.
  `;
  assert.strictEqual(detectLanguage(text), 'fr');
});

test('detectLanguage: WTTJ-style bilingual page → wins by content language', () => {
  // WTTJ often has FR navigation + EN job posting from international companies
  const text = `
    Découvrez les entreprises Emplois Sauvegardé
    Connexion Inscription Aide

    Backend Engineer at Mistral AI

    About Mistral AI
    Mistral AI is at the forefront of open-source LLM research. We are looking
    for a Backend Engineer to join our team and help us scale our inference platform.

    You will build distributed systems, optimize Python services, and work closely
    with our research team on production deployments.

    Requirements: strong experience with Python and distributed systems.
  `;
  assert.strictEqual(detectLanguage(text), 'en');
});

test('detectLanguage: short ambiguous text with no markers → en (safe default)', () => {
  assert.strictEqual(detectLanguage('Data Engineer Position'), 'en');
});

// === NEW TESTS — EN offer based outside English-speaking countries ===

test('extractLocation: detects Paris when offer is in English (e.g. Mistral AI)', () => {
  const text = `Senior Machine Learning Engineer
Mistral AI
Location: Paris, France

About the role
We are looking for a Senior ML Engineer to join our Paris team. You will work on training and deploying large language models at scale.

Requirements: Strong experience with PyTorch, distributed systems, and production ML systems.`;
  assert.strictEqual(extractLocation(text), 'Paris, France');
  // Language should still be English even though location is in France
  assert.strictEqual(detectLanguage(text), 'en');
});

test('selectTemplate: en + france → Resume_USA_Canada (English template)', () => {
  // This is the correct behavior: French location + English offer → English Resume
  // (the only English template available is Resume_USA_Canada)
  assert.strictEqual(selectTemplate('france', 'en'), 'Resume_USA_Canada.md');
});

test('selectTemplate: fr + usa-canada → Resume_USA_Canada (no French US template)', () => {
  // Rare case: French offer for a US-based position. No fr+usa template, fall back to EN.
  assert.strictEqual(selectTemplate('usa-canada', 'fr'), 'Resume_USA_Canada.md');
});

test('extractLocation: handles JSON-LD-formatted offer with "Location:" prefix', () => {
  // Output of the new fetch-offer extractor starts with structured fields
  const text = `Data Analyst (Remote)
Schepmont Group, LLC
Location: Boston, MA, US
Work mode: Remote

Overview: We are seeking a Data Analyst to support business operations...`;
  assert.strictEqual(extractLocation(text), 'Boston, USA');
});

// === NEW TESTS — visa sponsorship detection ===

test('detectVisaSponsorship: Schepmont-style explicit sponsorship → sponsored', () => {
  const text = 'We actively encourage applications from candidates who require U.S. work authorization sponsorship, including individuals on H1B, OPT, and STEM OPT. Sponsorship support may be available for qualified candidates.';
  assert.strictEqual(detectVisaSponsorship(text), 'sponsored');
});

test('detectVisaSponsorship: "willing to sponsor" → sponsored', () => {
  assert.strictEqual(detectVisaSponsorship('We are willing to sponsor exceptional candidates.'), 'sponsored');
});

test('detectVisaSponsorship: "unable to provide visa sponsorship" → not_sponsored', () => {
  assert.strictEqual(detectVisaSponsorship('We are unable to provide visa sponsorship at this time.'), 'not_sponsored');
});

test('detectVisaSponsorship: "we do not sponsor visas" → not_sponsored', () => {
  assert.strictEqual(detectVisaSponsorship('We do not sponsor visas for this position.'), 'not_sponsored');
});

test('detectVisaSponsorship: "without need for visa sponsorship" → not_sponsored', () => {
  assert.strictEqual(detectVisaSponsorship('Looking for candidates without the need for visa sponsorship.'), 'not_sponsored');
});

test('detectVisaSponsorship: "must be US citizen" → locals_only', () => {
  assert.strictEqual(detectVisaSponsorship('Must be a US citizen with active security clearance.'), 'locals_only');
});

test('detectVisaSponsorship: "green card holders only" → locals_only', () => {
  assert.strictEqual(detectVisaSponsorship('Must be a US citizen or permanent resident only.'), 'locals_only');
});

test('detectVisaSponsorship: TS/SCI clearance → locals_only', () => {
  assert.strictEqual(detectVisaSponsorship('Active TS/SCI clearance required for this role.'), 'locals_only');
});

test('detectVisaSponsorship: French authorization required → locals_only', () => {
  assert.strictEqual(detectVisaSponsorship('Autorisation de travail en France requise pour ce poste.'), 'locals_only');
});

test('detectVisaSponsorship: locals_only beats sponsored in conflict', () => {
  // If an offer mentions both sponsorship AND citizenship requirement, the citizenship wins
  assert.strictEqual(detectVisaSponsorship('We sponsor visas. Must be a US citizen for this role.'), 'locals_only');
});

test('detectVisaSponsorship: no mention → unspecified', () => {
  assert.strictEqual(detectVisaSponsorship('We are looking for a Senior Engineer to join our team. You will work with cutting-edge technology.'), 'unspecified');
});

test('detectVisaSponsorship: handles empty input', () => {
  assert.strictEqual(detectVisaSponsorship(''), 'unspecified');
  assert.strictEqual(detectVisaSponsorship(null), 'unspecified');
});

test('detectVisaSponsorship: negation prefix prevents false positive on "we provide"', () => {
  // "we do not provide visa sponsorship" should not match "we provide visa sponsorship"
  assert.strictEqual(detectVisaSponsorship('Please note we do not provide visa sponsorship for this opening.'), 'not_sponsored');
});

// === NEW TESTS — currency-based Remote country inference ===

test('extractLocation: Remote + USD ($/hr) → Remote (US)', () => {
  const text = 'Machine Learning Engineer $50-70/hr Remote Freelance. Location: Remote.';
  assert.strictEqual(extractLocation(text), 'Remote (US)');
});

test('extractLocation: Remote + EUR (€60k) → Remote (France)', () => {
  const text = 'Backend Engineer · Remote · €60,000-€80,000 per year.';
  assert.strictEqual(extractLocation(text), 'Remote (France)');
});

test('extractLocation: Remote + GBP (£50k) → Remote (UK)', () => {
  const text = 'Senior Engineer (Remote). Salary £50,000-£70,000.';
  assert.strictEqual(extractLocation(text), 'Remote (UK)');
});

test('extractLocation: Remote + USD code → Remote (US)', () => {
  const text = 'Data Engineer Remote position. Compensation: 120,000 USD annually.';
  assert.strictEqual(extractLocation(text), 'Remote (US)');
});

test('extractLocation: Remote + EUR code → Remote (France)', () => {
  const text = 'ML Engineer · Fully remote · 70,000 EUR per year.';
  assert.strictEqual(extractLocation(text), 'Remote (France)');
});

test('extractLocation: Remote + CAD → Remote (Canada)', () => {
  const text = 'Software Engineer Remote. Compensation: 100,000 CAD.';
  assert.strictEqual(extractLocation(text), 'Remote (Canada)');
});

test('extractLocation: Remote without currency stays Remote', () => {
  const text = 'This is a fully remote position. We do not disclose salary publicly.';
  assert.strictEqual(extractLocation(text), 'Remote');
});

test('extractLocation: explicit city beats currency inference', () => {
  // Boston is more specific than Remote → Boston wins even if $ is mentioned
  const text = 'Senior Engineer based in Boston, MA. $100k. Remote-friendly.';
  assert.strictEqual(extractLocation(text), 'Boston, USA');
});
