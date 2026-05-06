'use strict';
/**
 * Scraper Indeed via Playwright.
 *
 * Indeed est très agressif sur l'anti-bot. Stratégie :
 * - Headless avec stealth-like config
 * - Délais entre clicks
 * - Si captcha détecté : skip immédiat
 * - Idéalement passer par un proxy résidentiel en prod
 */
const { chromium } = require('playwright');
const { BaseScraper } = require('./base');

const COUNTRY_DOMAIN = {
  FR: 'fr.indeed.com',
  US: 'www.indeed.com',
  CA: 'ca.indeed.com',
  AU: 'au.indeed.com',
  SG: 'sg.indeed.com',
  JP: 'jp.indeed.com',
  GB: 'uk.indeed.com',
  UK: 'uk.indeed.com',
};

class IndeedScraper extends BaseScraper {
  static source = 'indeed';

  domain() {
    return COUNTRY_DOMAIN[this.country] || 'www.indeed.com';
  }

  async *scrape() {
    let browser;
    try {
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    } catch (err) {
      console.warn('[indeed] Playwright launch failed:', err.message);
      return;
    }

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: this.country === 'FR' ? 'fr-FR' : 'en-US',
    });

    try {
      const page = await context.newPage();
      let totalYielded = 0;

      for (const keyword of this.keywords) {
        if (totalYielded >= this.maxResults) break;
        const days = Math.min(Math.max(Math.floor(this.postedWithinHours / 24), 1), 7);
        const params = new URLSearchParams({ q: keyword, l: this.location, fromage: String(days) });
        const searchUrl = `https://${this.domain()}/jobs?${params}`;

        try {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        } catch (err) {
          console.warn(`[indeed] goto failed: ${err.message}`);
          continue;
        }

        // Captcha detection
        const captcha = await page.locator('text=/verify you|cloudflare|are you human/i').count();
        if (captcha > 0) {
          console.warn('[indeed] captcha detected, skipping');
          continue;
        }

        await page.waitForTimeout(2500);
        const cardsLocator = page.locator('a.tapItem, a.jcs-JobTitle, [data-testid="job-card-title"], h2.jobTitle a');
        const cards = await cardsLocator.elementHandles();

        for (let i = 0; i < Math.min(cards.length, this.maxResults - totalYielded); i++) {
          try {
            const card = cards[i];
            const href = await card.getAttribute('href');
            if (!href) continue;
            const fullUrl = href.startsWith('http') ? href : `https://${this.domain()}${href}`;

            await card.click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(1500);

            const title = await page.locator('h2.jobsearch-JobInfoHeader-title, [data-testid="jobsearch-JobInfoHeader-title"]').first().innerText({ timeout: 5000 }).catch(() => '');
            const company = await page.locator('[data-testid="inlineHeader-companyName"], .jobsearch-CompanyInfoContainer a').first().innerText({ timeout: 5000 }).catch(() => '');
            const loc = await page.locator('[data-testid="inlineHeader-companyLocation"], [data-testid="job-location"]').first().innerText({ timeout: 3000 }).catch(() => this.location);

            if (!title || !company) continue;

            const sourceId = (fullUrl.match(/[?&]jk=([^&]+)/) || [])[1] || null;

            yield {
              source: 'indeed',
              source_id: sourceId,
              url: fullUrl,
              title: title.trim(),
              company: company.trim(),
              location: (loc || '').trim(),
              country_code: this.country,
              posted_at: new Date().toISOString(),
            };
            totalYielded++;
            await page.waitForTimeout(1000);
          } catch (_) { /* skip card */ }
        }
      }
    } finally {
      await browser.close();
    }
  }
}

module.exports = { IndeedScraper };
