'use strict';
require('dotenv').config();

if (!process.env.PASSWORD) {
  console.error('FATAL: PASSWORD env var is required');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET env var is required');
  process.exit(1);
}

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { fetchOffer } = require('./src/fetch-offer.js');
const { generate } = require('./src/generate.js');
const { detectLanguage, detectRegion, selectTemplate, extractLocation } = require('./src/templates.js');

const COOKIE_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'cv_auth';
const COOKIE_OPTS = {
  signed: true,
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(COOKIE_SECRET));

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (req.signedCookies[COOKIE_NAME] === '1') return next();
  if (req.path === '/login' || req.path === '/health') return next();
  res.redirect('/login');
}

app.use(requireAuth);

// --- Health check (Railway uses this) ---
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- Login page ---
app.get('/login', (req, res) => {
  if (req.signedCookies[COOKIE_NAME] === '1') return res.redirect('/');
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
    .pwd-wrap { position:relative; margin-bottom:12px; }
    .pwd-wrap input { width:100%; background:#1a1a1a; border:1px solid #333; border-radius:6px;
            padding:12px 40px 12px 14px; color:#fff; font-size:13px; outline:none; margin-bottom:0; }
    .pwd-wrap input:focus { border-color:#555; }
    .pwd-toggle { position:absolute; right:12px; top:50%; transform:translateY(-50%);
                  background:none; border:none; color:#555; cursor:pointer; padding:0;
                  font-size:16px; width:auto; letter-spacing:0; }
    .pwd-toggle:hover { color:#aaa; }
    button[type="submit"] { width:100%; background:#fff; color:#000; border:none; border-radius:6px;
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
      <div class="pwd-wrap">
        <input type="password" id="pwd" name="password" placeholder="Password" autofocus>
        <button type="button" class="pwd-toggle" onclick="togglePwd()" id="eyeBtn">👁</button>
      </div>
      <button type="submit">Enter →</button>
      ${req.query.error ? '<p class="error">Wrong password</p>' : ''}
    </form>
  </div>
  <script>
    function togglePwd() {
      const input = document.getElementById('pwd');
      input.type = input.type === 'password' ? 'text' : 'password';
    }
  </script>
</body>
</html>`);
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const submitted = (req.body.password || '').trim();
  const expected = (process.env.PASSWORD || '').trim();
  if (submitted === expected) {
    res.cookie(COOKIE_NAME, '1', COOKIE_OPTS);
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

// --- Static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- API: detect template from offer + location ---
app.post('/api/detect-template', (req, res) => {
  const { offerContent, location } = req.body;
  if (!offerContent) return res.status(400).json({ error: 'Missing offerContent' });
  const language = detectLanguage(offerContent);
  const extractedLocation = extractLocation(offerContent);
  const effectiveLocation = extractedLocation || location || 'Paris, France';
  const region = detectRegion(effectiveLocation);
  const template = selectTemplate(region, language);
  // Only suggest a location when we actually extracted one from the offer text
  res.json({ template, language, region, suggestedLocation: extractedLocation || null });
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
const VALID_TEMPLATES = new Set([
  'CV_France.md',
  'Resume_USA_Canada.md',
  'Resume_Singapore_SouthKorea.md',
  'Resume_Japan.md'
]);

app.post('/api/generate', async (req, res) => {
  const { offerContent, location, workMode, withCoverLetter, templateOverride } = req.body;
  if (!offerContent || !location) {
    return res.status(400).json({ error: 'offerContent and location are required' });
  }
  if (templateOverride && !VALID_TEMPLATES.has(templateOverride)) {
    return res.status(400).json({ error: 'Invalid template' });
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
    res.status(500).json({ error: 'Generation failed. Check server logs.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CV Generator running on port ${PORT}`));
