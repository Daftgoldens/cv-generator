'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PORTALS_PATH = path.join(__dirname, '..', '..', 'career-ops', 'portals.yml');
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

function detectApi(company) {
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }
  const url = company.careers_url || '';
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return { type: 'ashby', url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true` };
  }
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return { type: 'lever', url: `https://api.lever.co/v0/postings/${leverMatch[1]}` };
  }
  const ghMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghMatch) {
    return { type: 'greenhouse', url: `https://boards-api.greenhouse.io/v1/boards/${ghMatch[1]}/jobs` };
  }
  return null;
}

function parseGreenhouse(json, companyName) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, companyName) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
  }));
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());
  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getSeenUrls(supabase) {
  const seen = new Set();
  const [{ data: pipelineData }, { data: appsData }] = await Promise.all([
    supabase.from('pipeline').select('url'),
    supabase.from('applications').select('url'),
  ]);
  (pipelineData || []).forEach(r => r.url && seen.add(r.url));
  (appsData || []).forEach(r => r.url && seen.add(r.url));
  return seen;
}

async function scanPortals(supabase, onResult) {
  if (!fs.existsSync(PORTALS_PATH)) {
    throw new Error('portals.yml introuvable (scanner disponible en local uniquement)');
  }
  const config = yaml.load(fs.readFileSync(PORTALS_PATH, 'utf8'));
  const seenUrls = await getSeenUrls(supabase);
  const titleFilter = buildTitleFilter(config.title_filter);
  const companies = (config.tracked_companies || []).filter(c => c.enabled !== false);
  const newItems = [];

  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const chunk = companies.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (company) => {
      const api = detectApi(company);
      if (!api) {
        onResult({ type: 'progress', company: company.name, found: 0, new: 0 });
        return;
      }
      let jobs = [];
      try {
        const json = await fetchJson(api.url);
        jobs = PARSERS[api.type](json, company.name);
      } catch (err) {
        onResult({ type: 'progress', company: company.name, found: 0, new: 0, error: err.message });
        return;
      }
      const newJobs = jobs.filter(j => j.url && titleFilter(j.title) && !seenUrls.has(j.url));
      onResult({ type: 'progress', company: company.name, found: jobs.length, new: newJobs.length });
      for (const job of newJobs) {
        seenUrls.add(job.url);
        newItems.push(job);
        onResult({ type: 'new', ...job });
      }
    }));
  }
  return newItems;
}

module.exports = { detectApi, parseGreenhouse, parseAshby, parseLever, buildTitleFilter, scanPortals, getSeenUrls };
