'use strict';
const { LinkedInScraper } = require('./linkedin');
const { WTTJScraper } = require('./wttj');
const { IndeedScraper } = require('./indeed');
const { HelloWorkScraper } = require('./hellowork');
const { fingerprint } = require('./fingerprint');

const REGISTRY = {
  linkedin: LinkedInScraper,
  wttj: WTTJScraper,
  indeed: IndeedScraper,
  hellowork: HelloWorkScraper,
};

function getScraper(source, searchConfig) {
  const Cls = REGISTRY[source];
  if (!Cls) return null;
  return new Cls(searchConfig);
}

/**
 * Charge les recherches actives depuis Supabase (table scraper_searches).
 */
async function loadSearches(supabase) {
  const { data, error } = await supabase
    .from('scraper_searches')
    .select('*')
    .eq('enabled', true);
  if (error) throw error;
  return data || [];
}

/**
 * Lance tous les scrapers en série (par souci de rate-limit) et insère
 * les nouvelles offres dans la table pipeline.
 *
 * Retourne { totalFound, totalNew, perSource: { linkedin: {...}, ... } }
 */
async function runAllScrapers(supabase, onEvent = () => {}) {
  const searches = await loadSearches(supabase);
  const stats = { totalFound: 0, totalNew: 0, perSource: {} };

  // Récupérer les fingerprints+URLs déjà connus pour dédup
  const seenFingerprints = new Set();
  const seenUrls = new Set();
  const [{ data: pip }, { data: apps }] = await Promise.all([
    supabase.from('pipeline').select('url, fingerprint'),
    supabase.from('applications').select('url'),
  ]);
  (pip || []).forEach(r => {
    if (r.url) seenUrls.add(r.url);
    if (r.fingerprint) seenFingerprints.add(r.fingerprint);
  });
  (apps || []).forEach(r => { if (r.url) seenUrls.add(r.url); });

  for (const search of searches) {
    const scraper = getScraper(search.source, search);
    if (!scraper) {
      onEvent({ type: 'progress', source: search.source, status: 'skipped', reason: 'no scraper' });
      continue;
    }

    const sourceStats = stats.perSource[search.source] = stats.perSource[search.source] || { found: 0, new: 0, errors: 0 };
    onEvent({ type: 'progress', source: search.source, status: 'started', keywords: search.keywords, location: search.location });

    try {
      const newRows = [];
      for await (const job of scraper.scrape()) {
        sourceStats.found++;
        stats.totalFound++;
        const fp = fingerprint(job);
        if (seenUrls.has(job.url) || seenFingerprints.has(fp)) continue;
        seenUrls.add(job.url);
        seenFingerprints.add(fp);

        newRows.push({
          url: job.url,
          title: job.title,
          company: job.company,
          location: job.location || null,
          source: job.source,
          source_id: job.source_id || null,
          posted_at: job.posted_at || null,
          fingerprint: fp,
          processed: false,
        });
      }

      if (newRows.length > 0) {
        // Insert by chunks of 50
        for (let i = 0; i < newRows.length; i += 50) {
          const chunk = newRows.slice(i, i + 50);
          const { error } = await supabase.from('pipeline').insert(chunk);
          if (error) {
            console.warn(`[scrapers] insert error pour ${search.source}:`, error.message);
            sourceStats.errors++;
          } else {
            sourceStats.new += chunk.length;
            stats.totalNew += chunk.length;
          }
        }
      }
      onEvent({ type: 'progress', source: search.source, status: 'done', found: sourceStats.found, new: sourceStats.new });
    } catch (err) {
      console.error(`[scrapers] ${search.source} failed:`, err);
      sourceStats.errors++;
      onEvent({ type: 'progress', source: search.source, status: 'error', message: err.message });
    }
  }

  return stats;
}

module.exports = { getScraper, loadSearches, runAllScrapers, REGISTRY };
