'use strict';
/**
 * Seed initial : charge config/portals.seed.yml et config/searches.seed.yml
 * dans les tables Supabase tracked_companies et scraper_searches.
 *
 * Idempotent : utilise UPSERT sur le nom (companies) ou la combo source+location (searches).
 *
 * Usage : node scripts/seed.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function seedCompanies() {
  const file = path.join(__dirname, '..', 'config', 'portals.seed.yml');
  if (!fs.existsSync(file)) { console.log('skip : portals.seed.yml absent'); return; }
  const seed = yaml.load(fs.readFileSync(file, 'utf8'));

  // Le YAML est une liste hétérogène : items companies + un item title_filter
  const titleFilterItem = Array.isArray(seed) ? seed.find(s => s && s.title_filter) : null;
  const companies = Array.isArray(seed)
    ? seed.filter(s => s && s.name)
    : (seed.tracked_companies || []);

  console.log(`Seeding ${companies.length} companies...`);
  let inserted = 0;
  let skipped = 0;
  for (const c of companies) {
    const { data: existing } = await supabase
      .from('tracked_companies')
      .select('id').eq('name', c.name).maybeSingle();
    if (existing) { skipped++; continue; }
    const { error } = await supabase.from('tracked_companies').insert({
      name: c.name,
      careers_url: c.careers_url || null,
      api: c.api || null,
      enabled: c.enabled !== false,
      category: c.category || null,
    });
    if (error) console.warn(`  ! ${c.name}:`, error.message);
    else inserted++;
  }
  console.log(`  → ${inserted} inserted, ${skipped} already existed`);

  if (titleFilterItem?.title_filter) {
    const { error } = await supabase.from('title_filters').upsert({
      id: 1,
      positive: titleFilterItem.title_filter.positive || [],
      negative: titleFilterItem.title_filter.negative || [],
    });
    if (error) console.warn('title_filters:', error.message);
    else console.log('  → title_filters updated');
  }
}

async function seedSearches() {
  const file = path.join(__dirname, '..', 'config', 'searches.seed.yml');
  if (!fs.existsSync(file)) { console.log('skip : searches.seed.yml absent'); return; }
  const searches = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(searches)) { console.log('searches seed: expected array'); return; }

  console.log(`Seeding ${searches.length} searches...`);
  let inserted = 0;
  let skipped = 0;
  for (const s of searches) {
    // Check if (source, location, country_code) combo exists
    const { data: existing } = await supabase
      .from('scraper_searches')
      .select('id')
      .eq('source', s.source)
      .eq('location', s.location)
      .eq('country_code', s.country_code || '')
      .maybeSingle();
    if (existing) { skipped++; continue; }
    const { error } = await supabase.from('scraper_searches').insert({
      source: s.source,
      keywords: s.keywords,
      location: s.location,
      country_code: s.country_code || null,
      remote_filter: s.remote_filter || [],
      posted_within_hours: s.posted_within_hours || 48,
      max_results: s.max_results || 25,
      enabled: s.enabled !== false,
    });
    if (error) console.warn(`  ! ${s.source}/${s.location}:`, error.message);
    else inserted++;
  }
  console.log(`  → ${inserted} inserted, ${skipped} already existed`);
}

(async () => {
  console.log('=== SEED BOOTSTRAP ===');
  try {
    await seedCompanies();
    await seedSearches();
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
})();
