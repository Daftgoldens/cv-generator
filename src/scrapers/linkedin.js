'use strict';
/**
 * Scraper LinkedIn — endpoint guest (sans login, sans authentification).
 *
 * STRATEGIE ANTI-BAN :
 * - Endpoint guest public uniquement (jobs-guest/jobs/api/seeMoreJobPostings/search)
 * - Pas d'authentification, pas de cookie de session, pas d'Easy Apply auto
 * - 1 requête / 15 secondes (très conservateur)
 * - 30 jobs max par run
 * - User-Agent rotatif type "real browser"
 * - Si HTTP 429 ou 999 : abort immediate et attente 30 min avant retry
 *
 * Risque résiduel : LinkedIn peut bloquer l'IP de Railway. Si ça arrive,
 * le scraper retournera 0 résultats sans casser le pipeline.
 */
const { BaseScraper } = require('./base');

const GUEST_LIST_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

const REQUEST_INTERVAL_MS = 15_000;       // 1 req / 15s
const MAX_PER_RUN = 30;
const FETCH_TIMEOUT_MS = 15_000;

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildSearchUrl({ keyword, location, postedWithinHours, remoteFilter, start = 0 }) {
  const seconds = postedWithinHours * 3600;
  const params = new URLSearchParams({
    keywords: keyword,
    location: location,
    f_TPR: `r${seconds}`,
    start: String(start),
  });
  // Remote filter : LinkedIn workplaceType (1=onsite, 2=remote, 3=hybrid)
  const wtCodes = [];
  if (remoteFilter.includes('onsite')) wtCodes.push('1');
  if (remoteFilter.includes('remote')) wtCodes.push('2');
  if (remoteFilter.includes('hybrid')) wtCodes.push('3');
  if (wtCodes.length > 0) params.set('f_WT', wtCodes.join(','));
  return `${GUEST_LIST_URL}?${params.toString()}`;
}

/**
 * Parse le HTML retourné par l'endpoint list pour extraire les job IDs et infos minimales.
 * Le format est une série de <li> avec data-entity-urn="urn:li:jobPosting:1234567"
 */
function parseListHtml(html) {
  const out = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRegex.exec(html)) !== null) {
    const liHtml = m[1];
    const urnMatch = liHtml.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/);
    if (!urnMatch) continue;
    const jobId = urnMatch[1];

    const titleMatch = liHtml.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/);
    const companyMatch = liHtml.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/);
    const locationMatch = liHtml.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/);

    const title = stripTags(titleMatch?.[1] || '');
    const company = stripTags(companyMatch?.[1] || '');
    const location = stripTags(locationMatch?.[1] || '');
    if (!title || !company) continue;

    out.push({
      sourceId: jobId,
      url: `https://www.linkedin.com/jobs/view/${jobId}`,
      title,
      company,
      location,
    });
  }
  return out;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

class LinkedInScraper extends BaseScraper {
  static source = 'linkedin';

  async *scrape() {
    let totalYielded = 0;
    let lastRequestAt = 0;

    for (const keyword of this.keywords) {
      let start = 0;
      const seenInRun = new Set();
      while (totalYielded < Math.min(this.maxResults, MAX_PER_RUN)) {
        // Rate limit
        const elapsed = Date.now() - lastRequestAt;
        if (elapsed < REQUEST_INTERVAL_MS) {
          await this.sleep(REQUEST_INTERVAL_MS - elapsed);
        }

        const url = buildSearchUrl({
          keyword,
          location: this.location,
          postedWithinHours: this.postedWithinHours,
          remoteFilter: this.config.remote_filter || ['remote', 'hybrid', 'onsite'],
          start,
        });

        let html;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          const res = await fetch(url, {
            headers: {
              'User-Agent': randomUserAgent(),
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: ctrl.signal,
          });
          clearTimeout(t);
          lastRequestAt = Date.now();
          if (res.status === 429 || res.status === 999) {
            // ANTI-BAN : on stoppe immédiatement, le scheduler reprendra plus tard
            console.warn(`[linkedin] HTTP ${res.status} reçu — arrêt du scraper pour ce run`);
            return;
          }
          if (!res.ok) break;
          html = await res.text();
        } catch (err) {
          console.warn('[linkedin] fetch error:', err.message);
          break;
        }

        const items = parseListHtml(html);
        if (items.length === 0) break;

        let yieldedThisPage = 0;
        for (const item of items) {
          if (seenInRun.has(item.sourceId)) continue;
          seenInRun.add(item.sourceId);
          yield {
            ...item,
            source: 'linkedin',
            country_code: this.country,
            posted_at: new Date().toISOString(),
          };
          totalYielded++;
          yieldedThisPage++;
          if (totalYielded >= Math.min(this.maxResults, MAX_PER_RUN)) break;
        }
        if (yieldedThisPage === 0) break;
        start += 25;
      }
    }
  }
}

module.exports = { LinkedInScraper, parseListHtml };
