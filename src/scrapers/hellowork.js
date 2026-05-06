'use strict';
/**
 * HelloWork (anciennement RegionsJob) — scraper HTML.
 * URL search : https://www.hellowork.com/fr-fr/emploi/recherche.html?k=<keyword>&l=<location>
 *
 * HelloWork a moins d'anti-bot qu'Indeed/LinkedIn, fetch HTML simple suffit.
 */
const { BaseScraper } = require('./base');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function parseListingHtml(html) {
  // Les cartes ont la forme : <a class="..." href="/fr-fr/emplois/<id>.html">...</a>
  // avec à l'intérieur un h3 contenant le titre, et un span pour entreprise+location.
  const out = [];
  const cardRegex = /<a[^>]+href="(\/fr-fr\/emplois\/\d+\.html)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = cardRegex.exec(html)) !== null) {
    const href = m[1];
    const inner = m[2];
    const titleM = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const companyM = inner.match(/data-cy="company-name"[^>]*>([\s\S]*?)</);
    const locationM = inner.match(/data-cy="localisation"[^>]*>([\s\S]*?)</);
    if (!titleM) continue;
    const title = strip(titleM[1]);
    const company = companyM ? strip(companyM[1]) : '';
    const location = locationM ? strip(locationM[1]) : '';
    const idMatch = href.match(/\/(\d+)\.html$/);
    if (!title || !company) continue;
    out.push({
      sourceId: idMatch?.[1] || href,
      url: `https://www.hellowork.com${href}`,
      title, company, location,
    });
  }
  return out;
}

function strip(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

class HelloWorkScraper extends BaseScraper {
  static source = 'hellowork';

  async *scrape() {
    let totalYielded = 0;
    for (const keyword of this.keywords) {
      if (totalYielded >= this.maxResults) break;
      const params = new URLSearchParams({ k: keyword, l: this.location });
      const url = `https://www.hellowork.com/fr-fr/emploi/recherche.html?${params}`;

      let html;
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          console.warn(`[hellowork] HTTP ${r.status}`);
          continue;
        }
        html = await r.text();
      } catch (err) {
        console.warn('[hellowork] fetch error:', err.message);
        continue;
      }

      const items = parseListingHtml(html);
      for (const item of items) {
        if (totalYielded >= this.maxResults) break;
        yield {
          source: 'hellowork',
          source_id: item.sourceId,
          url: item.url,
          title: item.title,
          company: item.company,
          location: item.location,
          country_code: 'FR',
          posted_at: new Date().toISOString(),
        };
        totalYielded++;
      }
      await new Promise(r => setTimeout(r, 2000)); // poli
    }
  }
}

module.exports = { HelloWorkScraper, parseListingHtml };
