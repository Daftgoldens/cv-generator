'use strict';
require('dotenv').config();

if (!process.env.PASSWORD) { console.error('FATAL: PASSWORD required'); process.exit(1); }
if (!process.env.SESSION_SECRET) { console.error('FATAL: SESSION_SECRET required'); process.exit(1); }

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { fetchOffer } = require('./src/fetch-offer');
const { generate } = require('./src/generate');
const { detectLanguage, detectRegion, selectTemplate, extractLocation } = require('./src/templates');
const { streamEvaluation } = require('./src/evaluate');
const tracker = require('./src/tracker');

const COOKIE_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'cv_auth';
const COOKIE_OPTS = {
  signed: true, httpOnly: true, sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser(COOKIE_SECRET));

function requireAuth(req, res, next) {
  if (req.signedCookies[COOKIE_NAME] === '1') return next();
  if (req.path === '/login' || req.path === '/health') return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}
app.use(requireAuth);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- Auth ---
app.get('/login', (req, res) => {
  if (req.signedCookies[COOKIE_NAME] === '1') return res.redirect('/');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Login</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f0f0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{width:300px}h1{font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:24px}input{width:100%;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:10px 14px;color:#fff;font-size:13px;margin-bottom:12px;outline:none}button{width:100%;background:#fff;color:#000;border:none;border-radius:6px;padding:10px;font-size:13px;font-weight:600;cursor:pointer}</style>
</head><body><div class="box"><h1>CV Generator</h1>
<form method="POST" action="/login"><input type="password" name="password" placeholder="Password" autofocus><button type="submit">Enter</button></form>
</div></body></html>`);
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.password === process.env.PASSWORD) {
    res.cookie(COOKIE_NAME, '1', COOKIE_OPTS);
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

// --- Static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Offer fetch ---
app.post('/api/fetch-offer', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const content = await fetchOffer(url);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Template detection ---
app.post('/api/detect-template', (req, res) => {
  try {
    const { offerContent, location } = req.body;
    const lang = detectLanguage(offerContent || '');
    const effectiveLocation = (typeof extractLocation === 'function' ? extractLocation(offerContent || '') : null) || location || '';
    const region = detectRegion(effectiveLocation);
    const template = selectTemplate(region, lang);
    res.json({ template, language: lang, region });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Evaluate (SSE streaming) ---
app.post('/api/evaluate', streamEvaluation);

// --- Generate CV + cover letter ---
app.post('/api/generate', async (req, res) => {
  try {
    const result = await generate(req.body);
    res.json(result);
  } catch (err) {
    console.error('generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Tracker ---
app.get('/api/tracker', async (_req, res) => {
  try { res.json(await tracker.listApplications()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tracker', async (req, res) => {
  try { res.status(201).json(await tracker.createApplication(req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/tracker/:id', async (req, res) => {
  try { res.json(await tracker.updateApplication(req.params.id, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tracker/:id', async (req, res) => {
  try { await tracker.deleteApplication(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Pipeline ---
app.get('/api/pipeline', async (_req, res) => {
  try { res.json(await tracker.listPipeline()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pipeline', async (req, res) => {
  try { res.status(201).json(await tracker.createPipelineItem(req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/pipeline/:id', async (req, res) => {
  try { res.json(await tracker.updatePipelineItem(req.params.id, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pipeline/:id', async (req, res) => {
  try { await tracker.deletePipelineItem(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Scanner (SSE) ---
app.get('/api/scan', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
  const { scanPortals } = require('./src/scanner');
  const supabase = createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  let totalNew = 0;
  let totalScanned = 0;

  try {
    const newItems = await scanPortals(supabase, async (event) => {
      if (event.type === 'new') {
        await supabase.from('pipeline').insert({ url: event.url, title: event.title });
      } else if (event.type === 'progress') {
        totalScanned++;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });
    totalNew = newItems.length;
    res.write(`data: ${JSON.stringify({ type: 'done', total_new: totalNew, total_scanned: totalScanned })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// --- Batch evaluate (SSE) ---
app.post('/api/batch', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { batchEvaluate } = require('./src/batch');

  try {
    const allItems = await tracker.listPipeline();
    const items = allItems.filter(i => !i.processed && i.url);
    res.write(`data: ${JSON.stringify({ type: 'start', total: items.length })}\n\n`);

    if (items.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'done', evaluated: 0, errors: 0 })}\n\n`);
      return res.end();
    }

    const results = await batchEvaluate(items, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const errors = results.filter(r => r.status === 'error').length;
    res.write(`data: ${JSON.stringify({ type: 'done', evaluated: results.length - errors, errors })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CV Generator v2 running on :${PORT}`));
