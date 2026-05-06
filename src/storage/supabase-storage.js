'use strict';
/**
 * Upload PDFs (CV + lettres) sur Supabase Storage et retourne les URLs publiques.
 * Bucket : 'applications' (à créer manuellement, public read).
 */

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'applications';

function makeUploadUrl(projectUrl, key) {
  return `${projectUrl.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${encodeURIComponent(key)}`;
}

function makePublicUrl(projectUrl, key) {
  return `${projectUrl.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(key)}`;
}

/**
 * Upload un buffer PDF sur Supabase Storage.
 * @param {Buffer} buffer
 * @param {string} key  ex: "auto/uuid/cv.pdf"
 * @returns {Promise<string>} URL publique
 */
async function uploadPdf(buffer, key) {
  const projectUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!projectUrl || !serviceKey) throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (ou ANON_KEY) requis');

  const url = makeUploadUrl(projectUrl, key);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage upload failed [${res.status}]: ${text}`);
  }
  return makePublicUrl(projectUrl, key);
}

module.exports = { uploadPdf };
