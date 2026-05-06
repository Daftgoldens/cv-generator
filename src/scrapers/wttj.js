'use strict';
/**
 * Welcome to the Jungle scraper via Algolia public API.
 *
 * WTTJ utilise un index Algolia côté front. La clé API publique tourne
 * périodiquement — à rafraîchir si le scraper retourne 0 résultats systématiquement.
 *
 * Pour récupérer la clé fraîche :
 * 1. Aller sur https://www.welcometothejungle.com/fr/jobs?query=data%20engineer
 * 2. DevTools > Network > filtrer "algolia.net"
 * 3. Repérer une requête, copier le header "X-Algolia-API-Key"
 * 4. La mettre dans WTTJ_ALGOLIA_API_KEY sur Railway
 */
const { BaseScraper } = require('./base');

const ALGOLIA_APP_ID = 'CSEPY0WTM8';
const ALGOLIA_INDEX = 'wk_live_jobs';

class WTTJScraper extends BaseScraper {
  static source = 'wttj';

  async *scrape() {
    const apiKey = process.env.WTTJ_ALGOLIA_API_KEY;
    if (!apiKey) {
      console.warn('[wttj] WTTJ_ALGOLIA_API_KEY manquante, scraper skip');
      return;
    }

    const url = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;
    const filters = this.country === 'FR' ? 'office_country:France' : '';

    for (const keyword of this.keywords) {
      let res;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'X-Algolia-API-Key': apiKey,
            'X-Algolia-Application-Id': ALGOLIA_APP_ID,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: keyword,
            hitsPerPage: Math.min(this.maxResults, 50),
            filters,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          console.warn(`[wttj] HTTP ${r.status} pour "${keyword}"`);
          continue;
        }
        res = await r.json();
      } catch (err) {
        console.warn(`[wttj] error "${keyword}":`, err.message);
        continue;
      }

      for (const hit of (res.hits || [])) {
        const slug = hit.slug || '';
        const orgSlug = hit.organization?.slug || '';
        if (!slug || !orgSlug) continue;
        const offices = hit.offices || [];
        const firstOffice = offices[0] || {};
        yield {
          source: 'wttj',
          source_id: hit.reference || slug,
          url: `https://www.welcometothejungle.com/fr/companies/${orgSlug}/jobs/${slug}`,
          title: hit.name || '',
          company: hit.organization?.name || '',
          location: firstOffice.city || '',
          country_code: firstOffice.country_code || this.country,
          posted_at: hit.published_at ? new Date(hit.published_at * 1000).toISOString() : null,
        };
      }
    }
  }
}

module.exports = { WTTJScraper };
