'use strict';

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

// === Generic JSON-LD JobPosting extractor ===
// JobPosting is a W3C/schema.org standard used by virtually every job board
// (LinkedIn, Indeed, WTTJ, Greenhouse, Ashby, Lever, HelloWork, Glassdoor, Monster,
// company career pages...) to appear in Google for Jobs. It is language-agnostic:
// even if the page chrome is in French, the JSON-LD content stays in the original
// language and contains structured fields (title, location, organization, description).
//
// This function tries to find ANY JobPosting schema in the page and returns a
// plain-text representation. Returns null if no JobPosting is found.
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
      // Malformed JSON-LD, skip and try next script tag
    }
  }
  return null;
}

// Format a JobPosting JSON-LD object into a plain text representation.
function formatJobPostingFromJsonLd(jp) {
  const parts = [];

  if (jp.title) parts.push(jp.title);
  if (jp.hiringOrganization && jp.hiringOrganization.name) parts.push(jp.hiringOrganization.name);

  // jobLocation can be an object or an array of objects
  const locations = Array.isArray(jp.jobLocation) ? jp.jobLocation : (jp.jobLocation ? [jp.jobLocation] : []);
  const locStrings = locations.map(loc => {
    if (!loc) return null;
    if (typeof loc === 'string') return loc;
    const addr = loc.address || loc;
    if (!addr) return null;
    const cityPart = addr.addressLocality || addr.locality || '';
    const regionPart = addr.addressRegion || addr.region || '';
    const countryPart = addr.addressCountry || addr.country || '';
    const countryName = typeof countryPart === 'object' ? (countryPart.name || '') : countryPart;
    return [cityPart, regionPart, countryName].filter(Boolean).join(', ');
  }).filter(Boolean);

  if (locStrings.length) {
    parts.push('Location: ' + locStrings.join(' | '));
  }

  // Remote indicator — also surface applicantLocationRequirements (for TELECOMMUTE jobs)
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

// === LinkedIn-specific extraction ===
// LinkedIn guest pages have JSON-LD in most cases, but we also support HTML scraping
// as a fallback for pages where the JSON-LD is missing or malformed.
function extractLinkedInJob(html) {
  // Strategy 1: JSON-LD (handled by the generic extractor caller, but keep here too for safety)
  const jsonLd = extractJsonLdJobPosting(html);
  if (jsonLd) return jsonLd;

  // Strategy 2: HTML selectors — combine top card (title + company + location) + description body
  const topCardParts = [];

  const titleMatch = html.match(/<h\d[^>]*class="[^"]*(?:topcard__title|top-card-layout__title)[^"]*"[^>]*>([\s\S]*?)<\/h\d>/i)
                  || html.match(/<a[^>]*class="[^"]*topcard__link[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  if (titleMatch) topCardParts.push(stripHtml(titleMatch[1]));

  const companyMatch = html.match(/<a[^>]*class="[^"]*(?:topcard__org-name-link|topcard__flavor--black-link|top-card-layout__company-url)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  if (companyMatch) topCardParts.push(stripHtml(companyMatch[1]));

  const locationMatch = html.match(/<span[^>]*class="[^"]*(?:topcard__flavor--bullet|topcard__flavor\s+topcard__flavor--bullet)[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
                     || html.match(/<div[^>]*class="[^"]*top-card-layout__second-subline[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
                     || html.match(/<span[^>]*class="[^"]*sub-nav-cta__meta-text[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  if (locationMatch) {
    const loc = stripHtml(locationMatch[1]);
    if (loc) topCardParts.push('Location: ' + loc);
  }

  const DESC_SELECTORS = [
    /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*jobs-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*core-section-container__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  let description = null;
  for (const re of DESC_SELECTORS) {
    const m = html.match(re);
    if (m) {
      const candidate = stripHtml(m[1] || m[0]);
      if (candidate.length > 300) {
        description = candidate;
        break;
      }
    }
  }

  if (description) {
    return topCardParts.length
      ? topCardParts.join('\n') + '\n\n' + description
      : description;
  }

  const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (ogDesc) {
    const desc = stripHtml(ogDesc[1]);
    if (desc.length > 200) {
      const fbParts = [];
      if (ogTitle) fbParts.push(stripHtml(ogTitle[1]));
      if (topCardParts.length) fbParts.push(topCardParts.join('\n'));
      fbParts.push(desc);
      return fbParts.join('\n\n');
    }
  }

  if (topCardParts.length >= 2) {
    return topCardParts.join('\n');
  }

  return null;
}

// === Welcome to the Jungle / WTTJ — fully bilingual UI, often fr/en mixed ===
function extractWTTJ(html) {
  const re = /<div[^>]*data-testid="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const m = html.match(re);
  if (m) return stripHtml(m[1]);
  return null;
}

async function fetchOffer(url) {
  // Detect known job board hosts for specialized extraction
  const isLinkedIn = /linkedin\.com/i.test(url);
  const isWTTJ = /welcometothejungle/i.test(url);

  // For LinkedIn, force English locale via URL param AND Accept-Language header.
  // This dramatically reduces FR/EN language mixing on the page chrome.
  let targetUrl = url;
  if (isLinkedIn) {
    try {
      const u = new URL(url);
      // Add locale=en_US which LinkedIn respects on guest pages
      if (!u.searchParams.has('locale')) {
        u.searchParams.set('locale', 'en_US');
      }
      targetUrl = u.toString();
    } catch {
      // URL parsing failed — fall back to original
    }
  }

  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      // Force English UI — overrides geo-based defaults on most major job boards
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${targetUrl}`);
  }

  let html = await res.text();
  const rawHtml = html; // Keep raw for JSON-LD extraction (which needs <script> tags)

  // === STEP 1: try generic JSON-LD JobPosting first (works for ANY job board) ===
  // Must run BEFORE we strip <script> tags below — JSON-LD lives inside <script> tags.
  const jsonLdResult = extractJsonLdJobPosting(rawHtml);
  if (jsonLdResult && jsonLdResult.length > 200) {
    return jsonLdResult.slice(0, 8000);
  }

  // Remove scripts, styles, SVGs
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');

  // === STEP 2: SPECIALIZED EXTRACTORS for known boards ===
  if (isLinkedIn) {
    // extractLinkedInJob already tries JSON-LD internally (we may have called it via
    // the generic path already, but the page may have multiple <script> tags or be
    // malformed — try the dedicated HTML-based extractor too)
    const ln = extractLinkedInJob(rawHtml);
    if (ln) return ln.slice(0, 8000);
  }
  if (isWTTJ) {
    const wttj = extractWTTJ(html);
    if (wttj) return wttj.slice(0, 8000);
  }

  // === STEP 3: GENERIC FALLBACK ===

  // Remove UI chrome: nav, header, footer, aside, breadcrumb, cookie banners, forms
  html = html
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<[^>]*(class|id)="[^"]*(?:nav|menu|breadcrumb|cookie|banner|header|footer|sidebar|modal|popup|alert|toast|toolbar|topbar|related|similar|recommended|suggestions)[^"]*"[\s\S]*?<\/\w+>/gi, '');

  // Try to find the job description container by common patterns
  const JOB_SELECTORS = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<[^>]+(?:class|id)="[^"]*(?:job[-_]?desc|offer[-_]?desc|job[-_]?detail|posting[-_]?detail|job[-_]?content|description[-_]?content|job[-_]?body|offer[-_]?body)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section|article)>/i,
    /<[^>]+(?:class|id)="[^"]*(?:description|content|main|body)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section|main)>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  let extracted = null;
  for (const re of JOB_SELECTORS) {
    const m = html.match(re);
    if (m) {
      const candidate = stripHtml(m[1] || m[0]);
      if (candidate.length > 300) {
        extracted = candidate;
        break;
      }
    }
  }

  // Fallback: strip all remaining tags from full page
  if (!extracted) {
    extracted = stripHtml(html);
  }

  // Return first 8000 chars
  return extracted.slice(0, 8000);
}

module.exports = { fetchOffer, extractLinkedInJob, extractWTTJ, extractJsonLdJobPosting };
