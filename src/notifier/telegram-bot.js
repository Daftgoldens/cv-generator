'use strict';
/**
 * Bot Telegram handler — polling long pour récupérer les clics sur boutons.
 * À lancer en service `bot` séparé sur Railway.
 *
 * Usage : node src/notifier/telegram-bot.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const TG = 'https://api.telegram.org';

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID requis');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('FATAL: SUPABASE_URL et SUPABASE_ANON_KEY requis');
  process.exit(1);
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function call(method, payload) {
  const res = await fetch(`${TG}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35000),
  });
  return res.json();
}

async function answerCallback(id, text) {
  return call('answerCallbackQuery', { callback_query_id: id, text });
}

async function editStatus(chatId, messageId, statusText) {
  return call('editMessageReplyMarkup', {
    chat_id: chatId, message_id: messageId,
    reply_markup: { inline_keyboard: [[{ text: statusText, callback_data: 'noop' }]] },
  });
}

async function handleCallback(cb) {
  const fromChatId = String(cb.message?.chat?.id || '');
  if (fromChatId !== ALLOWED_CHAT_ID) {
    await answerCallback(cb.id, '⛔ Non autorisé');
    return;
  }

  const data = cb.data || '';
  const [action, appId] = data.split(':');
  if (!appId) {
    await answerCallback(cb.id, 'ID manquant');
    return;
  }

  let response = '?';
  if (action === 'approve') {
    const { error } = await supabase
      .from('applications')
      .update({ status: 'Approved', reviewed_at: new Date().toISOString() })
      .eq('id', appId);
    response = error ? `❌ Erreur: ${error.message}` : '✅ Approuvé';
  } else if (action === 'skip') {
    const { error } = await supabase
      .from('applications')
      .update({ status: 'Discarded', reviewed_at: new Date().toISOString() })
      .eq('id', appId);
    response = error ? `❌ Erreur: ${error.message}` : '⏭️ Skipé';
  } else if (action === 'noop') {
    response = 'Déjà traité';
  }

  await answerCallback(cb.id, response);
  if (cb.message?.message_id && action !== 'noop') {
    await editStatus(cb.message.chat.id, cb.message.message_id, response);
  }
}

async function poll() {
  let offset = 0;
  console.log('[bot] Polling started');
  while (true) {
    try {
      const url = `${TG}/bot${TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=${encodeURIComponent('["callback_query"]')}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(35000) });
      const data = await r.json();
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        if (update.callback_query) {
          handleCallback(update.callback_query).catch(err => console.error('[bot] callback error', err));
        }
      }
    } catch (err) {
      console.warn('[bot] polling error:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

poll();
