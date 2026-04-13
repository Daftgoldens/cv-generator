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

async function fetchOffer(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  let html = await res.text();

  // Remove scripts, styles, SVGs
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');

  // Remove UI chrome: nav, header, footer, aside, breadcrumb, cookie banners, forms
  html = html
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<[^>]*(class|id)="[^"]*(?:nav|menu|breadcrumb|cookie|banner|header|footer|sidebar|modal|popup|alert|toast|toolbar|topbar)[^"]*"[\s\S]*?<\/\w+>/gi, '');

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
      // Only use if it's substantial enough to be actual content
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

module.exports = { fetchOffer };
