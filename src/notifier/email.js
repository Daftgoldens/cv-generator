'use strict';
/**
 * Email digest via Resend (https://resend.com).
 *
 * Requiert RESEND_API_KEY + EMAIL_FROM + EMAIL_TO.
 * Si non configuré, no-op silencieux.
 */

function isConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.EMAIL_TO);
}

function escape(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendEmail({ subject, html, text }) {
  if (!isConfigured()) return null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [process.env.EMAIL_TO],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn('[email] HTTP', res.status, await res.text().catch(() => ''));
    }
    return await res.json().catch(() => null);
  } catch (err) {
    console.warn('[email] error:', err.message);
    return null;
  }
}

async function sendDailyDigest(stats, baseUrl = '') {
  if (!isConfigured()) return;
  const top = (stats.topApplications || []).slice(0, 10);
  const date = new Date().toLocaleDateString('fr-FR');

  const html = `
<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <h2 style="margin:0 0 16px;font-size:18px;">📥 Récap candidatures — ${date}</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr><td style="padding:8px 0;color:#666;">Offres trouvées</td><td style="text-align:right;font-weight:700;">${stats.newPipeline || 0}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">Offres évaluées</td><td style="text-align:right;font-weight:700;">${stats.evaluated || 0}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">Documents générés</td><td style="text-align:right;font-weight:700;">${stats.generated || 0}</td></tr>
  </table>
  ${top.length > 0 ? `
    <h3 style="font-size:14px;margin:24px 0 12px;">Top ${top.length} à valider</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${top.map(a => `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:10px 0;"><strong>${escape(a.role || '')}</strong><br><span style="color:#666;font-size:12px;">${escape(a.company || '')}</span></td>
          <td style="text-align:right;color:#3ecf8e;font-weight:700;">${Number(a.score || 0).toFixed(1)}</td>
        </tr>
      `).join('')}
    </table>
  ` : ''}
  ${baseUrl ? `<p style="margin-top:24px;"><a href="${baseUrl}" style="background:#000;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;display:inline-block;font-weight:600;">Ouvrir le dashboard</a></p>` : ''}
</body></html>`;

  const textPlain = `
Récap candidatures — ${date}

Offres trouvées : ${stats.newPipeline || 0}
Offres évaluées : ${stats.evaluated || 0}
Documents générés : ${stats.generated || 0}

${top.length > 0 ? 'Top à valider :\n' + top.map(a => `  - ${a.role} @ ${a.company} (${Number(a.score || 0).toFixed(1)})`).join('\n') : ''}

${baseUrl ? `Dashboard : ${baseUrl}` : ''}`;

  return sendEmail({
    subject: `📥 ${stats.newPipeline || 0} nouvelles offres · ${stats.generated || 0} candidatures à valider`,
    html,
    text: textPlain,
  });
}

module.exports = { isConfigured, sendEmail, sendDailyDigest };
