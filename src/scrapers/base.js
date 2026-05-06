'use strict';
/**
 * Interface commune pour tous les scrapers de job boards.
 * Chaque scraper retourne via async generator des objets :
 *   { title, company, location, url, source, source_id?, posted_at?, country_code? }
 */

class BaseScraper {
  constructor(searchConfig) {
    this.config = searchConfig;
    this.keywords = searchConfig.keywords || [];
    this.location = searchConfig.location || '';
    this.country = searchConfig.country_code || '';
    this.maxResults = searchConfig.max_results || 25;
    this.postedWithinHours = searchConfig.posted_within_hours || 48;
  }

  // eslint-disable-next-line require-yield
  async *scrape() {
    throw new Error('scrape() not implemented');
  }

  async sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { BaseScraper };
