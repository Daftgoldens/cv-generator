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

// === LinkedIn-specific extraction ===
// LinkedIn job pages have a specific structure. The actual job description is in
// a div with class containing "description__text" or "show-more-less-html".
// Headers/footers/sidebars are localized to the user's locale — we strip them aggressively.
function extractLinkedInJob(html) {
  // Try multiple LinkedIn-specific selectors in order of specificity
  const LINKEDIN_SELECTORS = [
    // Guest page job description container (most specific)
    /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*jobs-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*core-section-container__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const re of LINKEDIN_SELECTORS) {
    const m = html.match(re);
    if (m) {
      const candidate = stripHtml(m[1] || m[0]);
      if (candidate.length > 300) return candidate;
    }
  }

  // Try to grab the job title + the description block by looking for the meta og:description
  // which LinkedIn populates with the JD content
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

  // Remove scripts, styles, SVGs
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');

  // === SPECIALIZED EXTRACTORS (try these first) ===
  if (isLinkedIn) {
    const ln = extractLinkedInJob(html);
    if (ln) return ln.slice(0, 8000);
  }
  if (isWTTJ) {
    const wttj = extractWTTJ(html);
    if (wttj) return wttj.slice(0, 8000);
  }

  // === GENERIC FALLBACK ===

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

module.exports = { fetchOffer, extractLinkedInJob, extractWTTJ };
