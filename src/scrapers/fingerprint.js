'use strict';
const crypto = require('crypto');

/**
 * Hash stable pour dédup cross-platform.
 * Une même offre publiée sur LinkedIn ET WTTJ sera détectée si title+company+location matchent.
 */
function fingerprint({ title, company, location }) {
  const key = `${(title || '').toLowerCase().trim()}|${(company || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

module.exports = { fingerprint };
