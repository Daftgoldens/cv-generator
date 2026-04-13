'use strict';
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { fetchOffer } = require('./src/fetch-offer.js');
const { generate } = require('./src/generate.js');
const { detectLanguage, detectRegion, selectTemplate } = require('./src/templates.js');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path === '/login' || req.path === '/health') return next();
  res.redirect('/login');
}

app.use(requireAuth);

// --- Health check (Railway uses this) ---
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- Login page ---
app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CV Generator — Login</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0f0f0f; color:#fff; font-family:'Helvetica Neue',sans-serif;
           display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .box { width:320px; }
    h1 { font-size:16px; font-weight:700; letter-spacing:2px; text-transform:uppercase;
         margin-bottom:4px; }
    p { font-size:11px; color:#666; margin-bottom:24px; }
    input { width:100%; background:#1a1a1a; border:1px solid #333; border-radius:6px;
            padding:12px 14px; color:#fff; font-size:13px; outline:none; margin-bottom:12px; }
    input:focus { border-color:#555; }
    button { width:100%; background:#fff; color:#000; border:none; border-radius:6px;
             padding:12px; font-size:13px; font-weight:700; letter-spacing:1px;
             text-transform:uppercase; cursor:pointer; }
    .error { color:#f87171; font-size:11px; margin-top:8px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>CV Generator</h1>
    <p>Baptiste Hoffmann — Personal Tool</p>
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Password" autofocus>
      <button type="submit">Enter →</button>
      ${req.query.error ? '<p class="error">Wrong password</p>' : ''}
    </form>
  </div>
</body>
</html>`);
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.password === process.env.PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// --- Static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- API: detect template from offer + location ---
app.post('/api/detect-template', (req, res) => {
  const { offerContent, location } = req.body;
  if (!offerContent || !location) return res.status(400).json({ error: 'Missing fields' });
  const language = detectLanguage(offerContent);
  const region = detectRegion(location);
  const template = selectTemplate(region, language);
  res.json({ template, language, region });
});

// --- API: fetch offer from URL ---
app.post('/api/fetch-offer', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const content = await fetchOffer(url);
    res.json({ content });
  } catch (err) {
    res.status(422).json({ error: `Could not fetch: ${err.message}` });
  }
});

// --- API: generate CV (+ optional cover letter) ---
app.post('/api/generate', async (req, res) => {
  const { offerContent, location, workMode, withCoverLetter, templateOverride } = req.body;
  if (!offerContent || !location) {
    return res.status(400).json({ error: 'offerContent and location are required' });
  }
  try {
    const result = await generate({
      offerContent,
      location: location || 'Paris, France',
      workMode: workMode || 'on-site',
      withCoverLetter: !!withCoverLetter,
      templateOverride: templateOverride || null
    });
    res.json(result);
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CV Generator running on port ${PORT}`));
