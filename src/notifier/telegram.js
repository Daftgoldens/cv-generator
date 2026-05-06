'use strict';
/**
 * Telegram notifier — envoie des cartes par offre avec boutons Approuver/Skip/Voir.
 *
 * Setup :
 * 1. @BotFather → /newbot → récup le TOKEN
 * 2. Envoyer un message au bot
 * 3. Visiter https://api.telegram.org/bot<TOKEN>/getUpdates
 * 4. Récupérer result[0].message.chat.id → TELEGRAM_CHAT_ID
 */

const TG = 'https://api.telegram.org';

function token() { return process.env.TELEGRAM_BOT_TOKEN; }
function chatId() { return process.env.TELEGRAM_CHAT_ID; }

function isConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function send(method, payload) {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${TG}/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[telegram] ${method} HTTP ${res.status}: ${text}`);
    }
    return await res.json().catch(() => null);
  } catch (err) {
    console.warn(`[telegram] ${method} error:`, err.message);
    return null;
  }
}

async function sendText(text, opts = {}) {
  return send('sendMessage', {
    chat_id: chatId(),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...opts,
  });
}

/**
 * Envoie une carte par application générée auto.
 * @param {object} app - { id, company, role, score, url, cv_pdf_url, cover_letter_pdf_url }
 */
async function sendApplicationCard(app, baseUrl = '') {
  if (!isConfigured()) return;

  const score = Number(app.score || 0).toFixed(1);
  const text = [
    `🎯 <b>${escapeHtml(app.role || 'Untitled')}</b>`,
    `🏢 ${escapeHtml(app.company || '')}`,
    app.location ? `📍 ${escapeHtml(app.location)}` : null,
    `📊 Score: <b>${score}/10</b>`,
  ].filter(Boolean).join('\n');

  const buttons = [];
  buttons.push([
    { text: '✅ Approuver', callback_data: `approve:${app.id}` },
    { text: '⏭️ Skip', callback_data: `skip:${app.id}` },
  ]);

  const links = [];
  if (app.url) links.push({ text: '🔗 Offre', url: app.url });
  if (app.cv_pdf_url) links.push({ text: '📄 CV', url: app.cv_pdf_url });
  if (app.cover_letter_pdf_url) links.push({ text: '✉️ Lettre', url: app.cover_letter_pdf_url });
  if (links.length > 0) buttons.push(links);

  if (baseUrl) {
    buttons.push([{ text: '🖥️ Dashboard', url: `${baseUrl.replace(/\/$/, '')}/?app=${app.id}` }]);
  }

  return send('sendMessage', {
    chat_id: chatId(),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons },
  });
}

/**
 * Récap quotidien : nb de nouvelles offres trouvées, nb évaluées, top scores.
 */
async function sendDailyDigest(stats) {
  if (!isConfigured()) return;
  const lines = [
    `📥 <b>Récap quotidien</b>`,
    ``,
    `🔍 Offres trouvées : <b>${stats.newPipeline || 0}</b>`,
    `🤖 Offres évaluées : <b>${stats.evaluated || 0}</b>`,
    `📝 Documents générés : <b>${stats.generated || 0}</b>`,
  ];
  if (stats.topApplications && stats.topApplications.length > 0) {
    lines.push('', '<b>Top 3 du jour :</b>');
    for (const a of stats.topApplications.slice(0, 3)) {
      lines.push(`• ${escapeHtml(a.role || '')} @ ${escapeHtml(a.company || '')} (${Number(a.score || 0).toFixed(1)})`);
    }
  }
  return sendText(lines.join('\n'));
}

module.exports = { isConfigured, sendText, sendApplicationCard, sendDailyDigest };
