'use strict';

// =============================================================================
// fetch-offer.js — Universal job offer extractor
//
// Pipeline (in order, first non-empty result wins):
//   1. HTTP fetch (fast path)
//      a. JSON-LD JobPosting     ← works on ~80% of well-SEO'd sites
//      b. Domain-specific extractors (LinkedIn, Greenhouse, Lever, WTTJ, Workable)
//      c. SSR data blobs (__NEXT_DATA__, __NUXT__, window.__INITIAL_STATE__)
//      d. Generic HTML heuristics
//   2. Playwright fallback (slow path) for SPAs
//      a. Render page, wait for content, re-run all extractors against rendered DOM
//
// Returns plain text (≤8000 chars) ready for LLM consumption.
// =============================================================================

function stripHtml(html) {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// =============================================================================
// STRATEGY 1A — JSON-LD JobPosting (universal standard for Google for Jobs)
// =============================================================================

function extractJsonLdJobPosting(html) {
  const ldMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const json = JSON.parse(m[1].trim());
      const candidates = Array.isArray(json) ? json : (json['@graph'] || [json]);
      for (const c of candidates) {
        if (c && (c['@type'] === 'JobPosting' || c.type === 'JobPosting')) {
          return formatJobPostingFromJsonLd(c);
        }
      }
    } catch {
      // malformed JSON-LD — try next script tag
    }
  }
  return null;
}

function formatJobPostingFromJsonLd(jp) {
  const parts = [];
  if (jp.title) parts.push(jp.title);
  if (jp.hiringOrganization && jp.hiringOrganization.name) parts.push(jp.hiringOrganization.name);

  const locations = Array.isArray(jp.jobLocation) ? jp.jobLocation : (jp.jobLocation ? [jp.jobLocation] : []);
  const locStrings = locations.map(loc => {
    if (!loc) return null;
    if (typeof loc === 'string') return loc;
    const addr = loc.address || loc;
    if (!addr) return null;
    const city = addr.addressLocality || addr.locality || '';
    const region = addr.addressRegion || addr.region || '';
    const country = addr.addressCountry || addr.country || '';
    const countryName = typeof country === 'object' ? (country.name || '') : country;
    return [city, region, countryName].filter(Boolean).join(', ');
  }).filter(Boolean);

  if (locStrings.length) parts.push('Location: ' + locStrings.join(' | '));

  if (jp.jobLocationType === 'TELECOMMUTE' || jp.applicantLocationRequirements) {
    parts.push('Work mode: Remote');
    if (jp.applicantLocationRequirements) {
      const reqs = Array.isArray(jp.applicantLocationRequirements) ? jp.applicantLocationRequirements : [jp.applicantLocationRequirements];
      const reqStrings = reqs.map(r => r && (r.name || r)).filter(Boolean);
      if (reqStrings.length) parts.push('Remote eligibility: ' + reqStrings.join(', '));
    }
  }

  if (jp.employmentType) {
    const et = Array.isArray(jp.employmentType) ? jp.employmentType.join(', ') : jp.employmentType;
    parts.push('Employment type: ' + et);
  }

  if (jp.baseSalary) {
    const s = jp.baseSalary;
    const cur = s.currency || '';
    const val = s.value && (s.value.value || s.value.minValue || s.value);
    if (val) parts.push('Salary: ' + cur + ' ' + val + (s.value && s.value.unitText ? '/' + s.value.unitText : ''));
  }

  if (jp.description) {
    parts.push('');
    parts.push(stripHtml(jp.description));
  }

  return parts.join('\n');
}

// =============================================================================
// STRATEGY 1B — Domain-specific extractors
// =============================================================================

function extractLinkedInJob(html) {
  // LinkedIn provides JSON-LD on guest pages — but also has rich HTML
  const jsonLd = extractJsonLdJobPosting(html);
  if (jsonLd) return jsonLd;

  const topCardParts = [];

  const titleMatch = html.match(/<h\d[^>]*class="[^"]*(?:topcard__title|top-card-layout__title)[^"]*"[^>]*>([\s\S]*?)<\/h\d>/i)
                  || html.match(/<a[^>]*class="[^"]*topcard__link[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  if (titleMatch) topCardParts.push(stripHtml(titleMatch[1]));

  const companyMatch = html.match(/<a[^>]*class="[^"]*(?:topcard__org-name-link|topcard__flavor--black-link|top-card-layout__company-url)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  if (companyMatch) topCardParts.push(stripHtml(companyMatch[1]));

  const locationMatch = html.match(/<span[^>]*class="[^"]*(?:topcard__flavor--bullet|topcard__flavor\s+topcard__flavor--bullet)[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
                     || html.match(/<div[^>]*class="[^"]*top-card-layout__second-subline[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (locationMatch) {
    const loc = stripHtml(locationMatch[1]);
    if (loc) topCardParts.push('Location: ' + loc);
  }

  const DESC_SELECTORS = [
    /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const re of DESC_SELECTORS) {
    const m = html.match(re);
    if (m) {
      const desc = stripHtml(m[1] || m[0]);
      if (desc.length > 300) {
        return topCardParts.length ? topCardParts.join('\n') + '\n\n' + desc : desc;
      }
    }
  }

  const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
  if (ogDesc) {
    const desc = stripHtml(ogDesc[1]);
    if (desc.length > 200) {
      return topCardParts.length ? topCardParts.join('\n') + '\n\n' + desc : desc;
    }
  }

  return topCardParts.length >= 2 ? topCardParts.join('\n') : null;
}

function extractGreenhouse(html) {
  const titleMatch = html.match(/<h1[^>]*class="[^"]*app-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
                  || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const locationMatch = html.match(/<div[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  // Try multiple patterns: greenhouse-hosted (#content) vs embedded
  const contentMatch = html.match(/<div[^>]+id="content"[^>]*>([\s\S]+?)<\/(?:div|section)>\s*(?:<\/div>|$)/i)
                    || html.match(/<div[^>]+id="content"[^>]*>([\s\S]*)/i)
                    || html.match(/<div[^>]*class="[^"]*opening[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/i);

  if (!contentMatch) return null;
  const parts = [];
  if (titleMatch) parts.push(stripHtml(titleMatch[1]));
  if (locationMatch) parts.push('Location: ' + stripHtml(locationMatch[1]));
  parts.push('');
  parts.push(stripHtml(contentMatch[1]));
  const joined = parts.join('\n');
  return joined.length > 200 ? joined : null;
}

function extractLever(html) {
  const titleMatch = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const headerMatch = html.match(/<div[^>]*class="[^"]*posting-headline[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const catMatch = html.match(/<div[^>]*class="[^"]*posting-categories[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const contentMatch = html.match(/<div[^>]*class="[^"]*content-wrapper[^"]*posting-page[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);

  if (!headerMatch && !contentMatch) return null;
  const parts = [];
  if (titleMatch) parts.push(stripHtml(titleMatch[1]));
  if (catMatch) parts.push(stripHtml(catMatch[1]));
  if (headerMatch) parts.push(stripHtml(headerMatch[1]));
  if (contentMatch) parts.push(stripHtml(contentMatch[1]));
  const joined = parts.join('\n');
  return joined.length > 300 ? joined : null;
}

function extractWTTJ(html) {
  const re = /<div[^>]*data-testid="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const m = html.match(re);
  if (m) {
    const txt = stripHtml(m[1]);
    if (txt.length > 200) return txt;
  }
  return null;
}

function extractWorkable(html) {
  const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (ogDesc) {
    const desc = stripHtml(ogDesc[1]);
    if (desc.length > 200) {
      return (ogTitle ? stripHtml(ogTitle[1]) + '\n\n' : '') + desc;
    }
  }
  return null;
}

// =============================================================================
// STRATEGY 1C — SSR data blobs (Next.js, Nuxt, Gatsby, etc.)
// =============================================================================

function extractFromSsrBlobs(html) {
  // Next.js: <script id="__NEXT_DATA__" type="application/json">
  const nextMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const found = findJobInJson(data);
      if (found) return found;
    } catch {}
  }

  // Nuxt: window.__NUXT__={...}
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (nuxtMatch) {
    try {
      const data = JSON.parse(nuxtMatch[1]);
      const found = findJobInJson(data);
      if (found) return found;
    } catch {}
  }

  // Generic __INITIAL_STATE__ / __APOLLO_STATE__ / __PRELOADED_STATE__
  const initialMatch = html.match(/window\.__(?:INITIAL_STATE|APOLLO_STATE|PRELOADED_STATE)__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (initialMatch) {
    try {
      const data = JSON.parse(initialMatch[1]);
      const found = findJobInJson(data);
      if (found) return found;
    } catch {}
  }

  return null;
}

// Recursively search a JSON object for fields that look like a job posting.
function findJobInJson(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;

  const title = obj.title || obj.jobTitle || obj.name || obj.position || obj.role;
  const description = obj.description || obj.descriptionPlain || obj.content || obj.body || obj.fullDescription;
  if (title && description && typeof description === 'string' && description.length > 200) {
    const parts = [stripHtml(String(title))];
    const company = obj.company || obj.companyName || obj.organization || (obj.hiringOrganization && obj.hiringOrganization.name);
    if (company) parts.push(typeof company === 'string' ? company : (company.name || ''));
    const loc = obj.location || obj.jobLocation || obj.city;
    if (loc) {
      const locStr = typeof loc === 'string' ? loc :
                     (loc.name || loc.city || (loc.address && (loc.address.addressLocality || loc.address.locality)) || '');
      if (locStr) parts.push('Location: ' + locStr);
    }
    parts.push('');
    parts.push(stripHtml(description));
    return parts.join('\n');
  }

  for (const key of Object.keys(obj)) {
    const child = obj[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findJobInJson(item, depth + 1);
        if (found) return found;
      }
    } else if (child && typeof child === 'object') {
      const found = findJobInJson(child, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

// =============================================================================
// STRATEGY 1D — Generic HTML heuristics (last resort before Playwright)
// =============================================================================

function extractGenericHtml(html) {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<[^>]*(?:class|id)="[^"]*(?:nav|menu|breadcrumb|cookie|banner|header|footer|sidebar|modal|popup|alert|toast|toolbar|topbar|related|similar|recommended|suggestions)[^"]*"[\s\S]*?<\/\w+>/gi, '');

  const SELECTORS = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<[^>]+(?:class|id)="[^"]*(?:job[-_]?desc|offer[-_]?desc|job[-_]?detail|posting[-_]?detail|job[-_]?content|description[-_]?content|job[-_]?body|offer[-_]?body)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section|article)>/i,
    /<[^>]+(?:class|id)="[^"]*(?:description|content|main|body)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section|main)>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  for (const re of SELECTORS) {
    const m = cleaned.match(re);
    if (m) {
      const txt = stripHtml(m[1] || m[0]);
      if (txt.length > 300) return txt;
    }
  }

  return stripHtml(cleaned);
}

// =============================================================================
// PIPELINE — run all HTTP strategies against the same HTML, return first non-empty
// =============================================================================

function extractFromHtml(html, hostFlags) {
  const jsonLd = extractJsonLdJobPosting(html);
  if (jsonLd && jsonLd.length > 200) return { result: jsonLd, source: 'json-ld' };

  if (hostFlags.isLinkedIn) {
    const r = extractLinkedInJob(html);
    if (r && r.length > 200) return { result: r, source: 'linkedin-html' };
  }
  if (hostFlags.isGreenhouse) {
    const r = extractGreenhouse(html);
    if (r && r.length > 200) return { result: r, source: 'greenhouse' };
  }
  if (hostFlags.isLever) {
    const r = extractLever(html);
    if (r && r.length > 200) return { result: r, source: 'lever' };
  }
  if (hostFlags.isWTTJ) {
    const r = extractWTTJ(html);
    if (r && r.length > 200) return { result: r, source: 'wttj' };
  }
  if (hostFlags.isWorkable) {
    const r = extractWorkable(html);
    if (r && r.length > 200) return { result: r, source: 'workable' };
  }

  const ssr = extractFromSsrBlobs(html);
  if (ssr && ssr.length > 200) return { result: ssr, source: 'ssr-blob' };

  const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (ogDesc) {
    const desc = stripHtml(ogDesc[1]);
    if (desc.length > 400) {
      return {
        result: (ogTitle ? stripHtml(ogTitle[1]) + '\n\n' : '') + desc,
        source: 'og-tags',
      };
    }
  }

  const generic = extractGenericHtml(html);
  if (generic && generic.length > 300) return { result: generic, source: 'generic' };

  return { result: null, source: null };
}

function detectHostFlags(url) {
  return {
    isLinkedIn:    /linkedin\.com/i.test(url),
    isGreenhouse:  /greenhouse\.io|boards\.greenhouse/i.test(url),
    isLever:       /jobs\.lever\.co|lever\.co\/jobs/i.test(url),
    isAshby:       /ashbyhq\.com|jobs\.ashbyhq/i.test(url),
    isWTTJ:        /welcometothejungle/i.test(url),
    isWorkable:    /workable\.com|apply\.workable/i.test(url),
    isWorkday:     /myworkdayjobs\.com|workday\.com/i.test(url),
    isIndeed:      /indeed\.com/i.test(url),
  };
}

// =============================================================================
// HTTP fetch path
// =============================================================================

async function fetchOfferHttp(url, hostFlags) {
  let targetUrl = url;
  if (hostFlags.isLinkedIn) {
    try {
      const u = new URL(url);
      if (!u.searchParams.has('locale')) u.searchParams.set('locale', 'en_US');
      targetUrl = u.toString();
    } catch {}
  }

  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${targetUrl}`);
  }

  return await res.text();
}

// =============================================================================
// Playwright fallback for SPAs (Alignerr, Workday, modern company career pages)
// =============================================================================

async function fetchOfferPlaywright(url, hostFlags) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw new Error('Playwright not installed — cannot render SPA');
  }

  const browser = await playwright.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Block heavy resources we don't need (images, fonts, media) — speeds up render
    await page.route('**/*', route => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });

    let targetUrl = url;
    if (hostFlags.isLinkedIn) {
      try {
        const u = new URL(url);
        if (!u.searchParams.has('locale')) u.searchParams.set('locale', 'en_US');
        targetUrl = u.toString();
      } catch {}
    }

    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500); // hydration buffer for SPAs

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

// =============================================================================
// Public API — orchestrates HTTP → Playwright fallback
// =============================================================================

async function fetchOffer(url, options = {}) {
  const { allowPlaywright = true } = options;
  const hostFlags = detectHostFlags(url);

  // Known-SPA hosts: skip HTTP, go straight to Playwright.
  const knownSpaHosts = hostFlags.isWorkday;

  let httpHtml = null;
  let httpResult = { result: null, source: null };

  if (!knownSpaHosts) {
    try {
      httpHtml = await fetchOfferHttp(url, hostFlags);
      httpResult = extractFromHtml(httpHtml, hostFlags);
      if (httpResult.result && httpResult.result.length >= 300) {
        return httpResult.result.slice(0, 8000);
      }
    } catch (err) {
      if (!allowPlaywright) throw err;
    }
  }

  // === Playwright fallback ===
  if (allowPlaywright) {
    try {
      const renderedHtml = await fetchOfferPlaywright(url, hostFlags);
      const renderedResult = extractFromHtml(renderedHtml, hostFlags);
      if (renderedResult.result && renderedResult.result.length >= 300) {
        return renderedResult.result.slice(0, 8000);
      }
      const raw = extractGenericHtml(renderedHtml);
      if (raw && raw.length > 300) return raw.slice(0, 8000);
    } catch (err) {
      if (httpResult.result) return httpResult.result.slice(0, 8000);
      throw new Error('Failed to extract job content (HTTP + Playwright both failed): ' + err.message);
    }
  }

  if (httpResult.result) return httpResult.result.slice(0, 8000);
  if (httpHtml) return extractGenericHtml(httpHtml).slice(0, 8000);

  throw new Error('No content could be extracted from ' + url);
}

module.exports = {
  fetchOffer,
  extractJsonLdJobPosting,
  extractLinkedInJob,
  extractGreenhouse,
  extractLever,
  extractWTTJ,
  extractWorkable,
  extractFromSsrBlobs,
  extractFromHtml,
  findJobInJson,
  stripHtml,
  detectHostFlags,
};
