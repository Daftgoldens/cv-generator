# Scanner + Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add portal scanning (Greenhouse/Ashby/Lever APIs) and batch evaluation to the Pipeline tab of cv-generator.

**Architecture:** Two new backend modules (`src/scanner.js`, `src/batch.js`) with SSE routes in `server.js`, integrated into the existing Pipeline tab UI. Scanner reads `../career-ops/portals.yml` at runtime — gracefully errors on Railway where the file won't exist. Batch uses the existing `evaluate()` function with 3 concurrent workers.

**Tech Stack:** Node.js (commonjs), js-yaml, Express SSE, Supabase JS, existing `evaluate()` + `fetchOffer()` + `tracker.js`

**Spec:** `docs/superpowers/specs/2026-04-20-scan-batch-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add js-yaml dependency |
| `src/scanner.js` | Create | detectApi, parsers, titleFilter, scanPortals, getSeenUrls |
| `src/batch.js` | Create | batchEvaluate — parallel evaluate() with 3 workers |
| `server.js` | Modify | Add GET /api/scan (SSE), POST /api/batch (SSE) |
| `public/index.html` | Modify | Pipeline tab: scanner panel + batch button + inline status |
| `tests/scanner.test.js` | Create | Unit tests for pure functions |

---

## Task 1: scanner.js — pure functions + tests

**Files:**
- Create: `tests/scanner.test.js`
- Create: `src/scanner.js`

- [ ] **Step 1: Install js-yaml**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
npm install js-yaml
```

Expected: `js-yaml` appears in `node_modules/`.

- [ ] **Step 2: Write failing tests**

Create `tests/scanner.test.js`:

```javascript
'use strict';
const { detectApi, parseGreenhouse, parseAshby, parseLever, buildTitleFilter } = require('../src/scanner');

describe('detectApi', () => {
  test('detects Ashby from careers_url', () => {
    const r = detectApi({ careers_url: 'https://jobs.ashbyhq.com/mistral' });
    expect(r.type).toBe('ashby');
    expect(r.url).toContain('api.ashbyhq.com/posting-api/job-board/mistral');
  });

  test('detects Lever from careers_url', () => {
    const r = detectApi({ careers_url: 'https://jobs.lever.co/anthropic' });
    expect(r.type).toBe('lever');
    expect(r.url).toContain('api.lever.co/v0/postings/anthropic');
  });

  test('detects Greenhouse from api field', () => {
    const r = detectApi({ api: 'https://boards-api.greenhouse.io/v1/boards/openai/jobs', careers_url: '' });
    expect(r.type).toBe('greenhouse');
  });

  test('detects Greenhouse from job-boards URL', () => {
    const r = detectApi({ careers_url: 'https://job-boards.greenhouse.io/cohere' });
    expect(r.type).toBe('greenhouse');
    expect(r.url).toContain('boards-api.greenhouse.io/v1/boards/cohere/jobs');
  });

  test('returns null for unknown URL', () => {
    expect(detectApi({ careers_url: 'https://careers.example.com' })).toBeNull();
  });
});

describe('parseGreenhouse', () => {
  test('maps jobs array to normalized format', () => {
    const json = { jobs: [{ title: 'AI Engineer', absolute_url: 'https://gh.io/job/1', location: { name: 'Paris' } }] };
    const result = parseGreenhouse(json, 'Mistral');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ title: 'AI Engineer', url: 'https://gh.io/job/1', company: 'Mistral', location: 'Paris' });
  });

  test('handles empty jobs array', () => {
    expect(parseGreenhouse({ jobs: [] }, 'X')).toEqual([]);
  });
});

describe('parseAshby', () => {
  test('maps jobs array to normalized format', () => {
    const json = { jobs: [{ title: 'ML Engineer', jobUrl: 'https://ashby.io/job/2', location: 'Remote' }] };
    const result = parseAshby(json, 'Cohere');
    expect(result[0]).toEqual({ title: 'ML Engineer', url: 'https://ashby.io/job/2', company: 'Cohere', location: 'Remote' });
  });
});

describe('parseLever', () => {
  test('maps array to normalized format', () => {
    const json = [{ text: 'Data Scientist', hostedUrl: 'https://lever.co/job/3', categories: { location: 'NYC' } }];
    const result = parseLever(json, 'Scale AI');
    expect(result[0]).toEqual({ title: 'Data Scientist', url: 'https://lever.co/job/3', company: 'Scale AI', location: 'NYC' });
  });

  test('returns [] for non-array input', () => {
    expect(parseLever({}, 'X')).toEqual([]);
  });
});

describe('buildTitleFilter', () => {
  const filter = buildTitleFilter({
    positive: ['AI', 'Machine Learning'],
    negative: ['Junior', 'Intern'],
  });

  test('passes title matching positive keyword', () => {
    expect(filter('Senior AI Engineer')).toBe(true);
  });

  test('blocks title matching negative keyword', () => {
    expect(filter('AI Intern')).toBe(false);
  });

  test('blocks title with no positive match', () => {
    expect(filter('Backend Developer')).toBe(false);
  });

  test('case-insensitive', () => {
    expect(filter('machine learning engineer')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests — expect fail**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
npx jest tests/scanner.test.js --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../src/scanner'`

- [ ] **Step 4: Create src/scanner.js**

Create `src/scanner.js`:

```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PORTALS_PATH = path.join(__dirname, '..', '..', 'career-ops', 'portals.yml');
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

function detectApi(company) {
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }
  const url = company.careers_url || '';
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return { type: 'ashby', url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true` };
  }
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return { type: 'lever', url: `https://api.lever.co/v0/postings/${leverMatch[1]}` };
  }
  const ghMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghMatch) {
    return { type: 'greenhouse', url: `https://boards-api.greenhouse.io/v1/boards/${ghMatch[1]}/jobs` };
  }
  return null;
}

function parseGreenhouse(json, companyName) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, companyName) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
  }));
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());
  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getSeenUrls(supabase) {
  const seen = new Set();
  const [{ data: pipelineData }, { data: appsData }] = await Promise.all([
    supabase.from('pipeline').select('url'),
    supabase.from('applications').select('url'),
  ]);
  (pipelineData || []).forEach(r => r.url && seen.add(r.url));
  (appsData || []).forEach(r => r.url && seen.add(r.url));
  return seen;
}

async function scanPortals(supabase, onResult) {
  if (!fs.existsSync(PORTALS_PATH)) {
    throw new Error('portals.yml introuvable (scanner disponible en local uniquement)');
  }
  const config = yaml.load(fs.readFileSync(PORTALS_PATH, 'utf8'));
  const seenUrls = await getSeenUrls(supabase);
  const titleFilter = buildTitleFilter(config.title_filter);
  const companies = (config.tracked_companies || []).filter(c => c.enabled !== false);
  const newItems = [];

  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const chunk = companies.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (company) => {
      const api = detectApi(company);
      if (!api) {
        onResult({ type: 'progress', company: company.name, found: 0, new: 0 });
        return;
      }
      let jobs = [];
      try {
        const json = await fetchJson(api.url);
        jobs = PARSERS[api.type](json, company.name);
      } catch (err) {
        onResult({ type: 'progress', company: company.name, found: 0, new: 0, error: err.message });
        return;
      }
      const newJobs = jobs.filter(j => j.url && titleFilter(j.title) && !seenUrls.has(j.url));
      onResult({ type: 'progress', company: company.name, found: jobs.length, new: newJobs.length });
      for (const job of newJobs) {
        seenUrls.add(job.url);
        newItems.push(job);
        onResult({ type: 'new', ...job });
      }
    }));
  }
  return newItems;
}

module.exports = { detectApi, parseGreenhouse, parseAshby, parseLever, buildTitleFilter, scanPortals, getSeenUrls };
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
npx jest tests/scanner.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 12 passed, 12 total`

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
git add src/scanner.js tests/scanner.test.js package.json package-lock.json
git commit -m "feat: add scanner.js — Greenhouse/Ashby/Lever portal scanner with Supabase dedup"
```

---

## Task 2: batch.js + server routes

**Files:**
- Create: `src/batch.js`
- Modify: `server.js`

- [ ] **Step 1: Create src/batch.js**

Create `src/batch.js`:

```javascript
'use strict';
const { fetchOffer } = require('./fetch-offer');
const { evaluate } = require('./claude');
const { parseEvaluationResult } = require('./evaluate');
const tracker = require('./tracker');

const CONCURRENCY = 3;

async function batchEvaluate(items, onProgress) {
  const results = [];
  let index = 0;

  async function processNext() {
    while (index < items.length) {
      const item = items[index++];
      const { id, url } = item;
      onProgress({ type: 'progress', id, url, status: 'evaluating' });
      try {
        const offerContent = await fetchOffer(url);
        const fullText = await evaluate(offerContent, 'auto', () => {});
        const parsed = parseEvaluationResult(fullText);
        await tracker.createApplication({
          company: parsed.company || '',
          role: parsed.role || '',
          score: parsed.score,
          url,
          status: 'Evaluated',
          keywords: parsed.keywords || [],
          report_md: fullText,
        });
        await tracker.updatePipelineItem(id, { processed: true });
        onProgress({ type: 'progress', id, url, status: 'done', score: parsed.score, company: parsed.company, role: parsed.role });
        results.push({ id, url, status: 'done', ...parsed });
      } catch (err) {
        onProgress({ type: 'progress', id, url, status: 'error', message: err.message });
        results.push({ id, url, status: 'error', message: err.message });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, processNext));
  return results;
}

module.exports = { batchEvaluate };
```

- [ ] **Step 2: Add /api/scan and /api/batch routes to server.js**

Read the current `server.js`. Find the pipeline routes section (around `app.delete('/api/pipeline/:id')`). Add these two routes **after** the pipeline routes, before `app.listen`:

```javascript
// --- Scanner (SSE) ---
const { scanPortals } = require('./src/scanner');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

app.get('/api/scan', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

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
const { batchEvaluate } = require('./src/batch');

app.post('/api/batch', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

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
```

- [ ] **Step 3: Verify syntax**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
node --check server.js 2>&1
node --check src/batch.js 2>&1
```

Expected: no output (no syntax errors).

- [ ] **Step 4: Run all tests**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass (scanner + tracker + pdf + evaluate).

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
git add src/batch.js server.js
git commit -m "feat: add batch.js and /api/scan + /api/batch SSE routes"
```

---

## Task 3: Pipeline tab UI — scanner panel + batch button

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Read current Pipeline tab HTML**

Find the `<!-- ===== PIPELINE ===== -->` section in `public/index.html`. It currently looks like:

```html
  <!-- ===== PIPELINE ===== -->
  <div class="tab-content" id="tab-pipeline">
    <div class="section-header">
      <span class="section-title">Pipeline</span>
      <span class="section-subtitle">URLs à traiter</span>
    </div>
    <div class="pipeline-add">
      <input type="text" id="pipeline-url-input" placeholder="https://jobs.ashbyhq.com/..." />
      <input type="text" id="pipeline-title-input" placeholder="Titre (optionnel)" style="max-width:200px" />
      <button class="btn-primary" onclick="addPipelineItem()">+ Ajouter</button>
    </div>
    <ul class="pipeline-list" id="pipeline-list"></ul>
    <div class="status-msg" id="pipeline-status"></div>
  </div>
```

- [ ] **Step 2: Replace Pipeline tab HTML**

Replace the entire `<!-- ===== PIPELINE ===== -->` section with:

```html
  <!-- ===== PIPELINE ===== -->
  <div class="tab-content" id="tab-pipeline">
    <div class="section-header">
      <span class="section-title">Pipeline</span>
      <span class="section-subtitle">URLs à traiter</span>
    </div>

    <!-- Scanner panel -->
    <div style="background:#111;border:1px solid #1e1e1e;border-radius:8px;padding:14px 16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:0" id="scanner-idle">
        <button class="btn-secondary" onclick="startScan()" id="scan-btn">🔍 Scanner les portails</button>
        <span style="font-size:11px;color:#444">Greenhouse · Ashby · Lever (local uniquement)</span>
      </div>
      <div id="scanner-log" style="margin-top:10px;font-size:10.5px;line-height:1.8;color:#666;max-height:150px;overflow-y:auto;display:none"></div>
    </div>

    <!-- Batch button -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button class="btn-secondary" onclick="startBatch()" id="batch-btn">▶ Batch évaluer</button>
      <span style="font-size:11px;color:#444" id="batch-count"></span>
    </div>

    <div class="pipeline-add">
      <input type="text" id="pipeline-url-input" placeholder="https://jobs.ashbyhq.com/..." />
      <input type="text" id="pipeline-title-input" placeholder="Titre (optionnel)" style="max-width:200px" />
      <button class="btn-primary" onclick="addPipelineItem()">+ Ajouter</button>
    </div>
    <ul class="pipeline-list" id="pipeline-list"></ul>
    <div class="status-msg" id="pipeline-status"></div>
  </div>
```

- [ ] **Step 3: Add CSS for batch status badges**

Find the existing `.pipeline-item` style block in the `<style>` section and add these rules after it:

```css
    .batch-status { font-size: 10px; padding: 2px 6px; border-radius: 3px; white-space: nowrap; }
    .batch-status.evaluating { background: #1a2a3a; color: #60a5fa; }
    .batch-status.done { background: #1a3a1a; color: #4ade80; }
    .batch-status.error { background: #2a1a1a; color: #f87171; }
```

- [ ] **Step 4: Add scanner + batch JavaScript**

Find the `// ===== PIPELINE =====` comment in the `<script>` section. Add these new functions **before** `async function loadPipeline()`:

```javascript
  // ===== SCANNER =====
  async function startScan() {
    const btn = document.getElementById('scan-btn');
    const log = document.getElementById('scanner-log');
    btn.disabled = true;
    btn.textContent = '⏳ Scan en cours...';
    log.style.display = '';
    log.innerHTML = '';

    try {
      const response = await fetch('/api/scan');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let newCount = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let payload;
          try { payload = JSON.parse(line.slice(6)); } catch { continue; }
          if (payload.type === 'progress') {
            if (payload.new > 0) {
              log.innerHTML += '<span style="color:#4ade80">✓ ' + payload.company + ' — ' + payload.new + ' nouvelle' + (payload.new > 1 ? 's' : '') + '</span><br>';
            } else if (!payload.error) {
              log.innerHTML += '<span>· ' + payload.company + ' — 0</span><br>';
            } else {
              log.innerHTML += '<span style="color:#f87171">✗ ' + payload.company + ' — ' + payload.error + '</span><br>';
            }
            log.scrollTop = log.scrollHeight;
          } else if (payload.type === 'new') {
            newCount++;
          } else if (payload.type === 'done') {
            log.innerHTML += '<br><strong style="color:#fff">Scan terminé — ' + payload.total_new + ' nouvelle' + (payload.total_new !== 1 ? 's' : '') + ' offre' + (payload.total_new !== 1 ? 's' : '') + ' ajoutée' + (payload.total_new !== 1 ? 's' : '') + '</strong>';
            loadPipeline();
          } else if (payload.type === 'error') {
            log.innerHTML += '<span style="color:#f87171">⚠ ' + payload.message + '</span>';
          }
        }
      }
    } catch (e) {
      document.getElementById('pipeline-status').textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Scanner les portails';
    }
  }

  // ===== BATCH =====
  let batchStatuses = {};

  async function startBatch() {
    const btn = document.getElementById('batch-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Évaluation en cours...';
    batchStatuses = {};

    try {
      const response = await fetch('/api/batch', { method: 'POST' });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let payload;
          try { payload = JSON.parse(line.slice(6)); } catch { continue; }
          if (payload.type === 'start') {
            document.getElementById('pipeline-status').textContent = payload.total + ' offres à évaluer...';
          } else if (payload.type === 'progress') {
            batchStatuses[payload.id] = payload;
            renderBatchStatus(payload);
          } else if (payload.type === 'done') {
            document.getElementById('pipeline-status').textContent = payload.evaluated + ' évaluations terminées' + (payload.errors > 0 ? ' · ' + payload.errors + ' erreur(s)' : '');
            setTimeout(() => {
              document.getElementById('pipeline-status').textContent = '';
              loadPipeline();
            }, 3000);
          } else if (payload.type === 'error') {
            document.getElementById('pipeline-status').textContent = payload.message;
          }
        }
      }
    } catch (e) {
      document.getElementById('pipeline-status').textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Batch évaluer';
    }
  }

  function renderBatchStatus(payload) {
    const el = document.getElementById('batch-status-' + payload.id);
    if (!el) return;
    if (payload.status === 'evaluating') {
      el.className = 'batch-status evaluating';
      el.textContent = '⏳ En cours...';
    } else if (payload.status === 'done') {
      el.className = 'batch-status done';
      el.textContent = '✅ ' + (payload.score ? payload.score + '/5' : '—') + (payload.company ? ' · ' + payload.company : '');
    } else if (payload.status === 'error') {
      el.className = 'batch-status error';
      el.textContent = '❌ ' + payload.message.slice(0, 40);
    }
  }
```

- [ ] **Step 5: Update renderPipeline to show batch status badges and update batch count**

Find the existing `function renderPipeline(items)` in the script. Replace it entirely with:

```javascript
  function renderPipeline(items) {
    const unprocessed = items.filter(i => !i.processed);
    const batchBtn = document.getElementById('batch-btn');
    const batchCount = document.getElementById('batch-count');
    if (batchBtn) batchBtn.disabled = unprocessed.length === 0;
    if (batchCount) batchCount.textContent = unprocessed.length + ' non traité' + (unprocessed.length !== 1 ? 's' : '');

    const list = document.getElementById('pipeline-list');
    list.innerHTML = items.map(item =>
      '<li class="pipeline-item ' + (item.processed ? 'processed' : '') + '">' +
      '<a class="pipeline-url" onclick="loadPipelineItem(\'' + encodeURIComponent(item.url) + '\')">' + item.url + '</a>' +
      '<span class="pipeline-title">' + (item.title || '') + '</span>' +
      (batchStatuses[item.id] || !item.processed ? '<span class="batch-status" id="batch-status-' + item.id + '"></span>' : '') +
      '<button class="btn-small" onclick="markPipelineProcessed(\'' + item.id + '\')">✓ Traité</button>' +
      '<button class="btn-small" onclick="deletePipelineItem(\'' + item.id + '\')">✕</button>' +
      '</li>'
    ).join('');

    // Restore batch statuses if batch was running
    Object.values(batchStatuses).forEach(renderBatchStatus);
  }
```

- [ ] **Step 6: Run all tests**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 7: Commit and push**

```bash
cd "c:/Users/bapti/Documents/Recherche travail/cv-generator"
git add public/index.html
git commit -m "feat: add scanner panel + batch evaluate to Pipeline tab"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Scanner: detectApi, parsers, titleFilter, scanPortals, getSeenUrls → Task 1 ✓
- /api/scan SSE route → Task 2 ✓
- Batch: batchEvaluate with 3 workers → Task 2 ✓
- /api/batch SSE route → Task 2 ✓
- Pipeline tab UI: scanner panel, batch button, inline status → Task 3 ✓
- Error handling (portals.yml not found, fetch fails, evaluate fails) → handled in scanner.js and batch.js ✓
- Dedup via Supabase (getSeenUrls) → Task 1 ✓
- New items auto-inserted to Supabase pipeline in /api/scan handler → Task 2 ✓

**Type consistency:**
- `scanPortals(supabase, onResult)` — defined in scanner.js, called in server.js /api/scan ✓
- `batchEvaluate(items, onProgress)` — defined in batch.js, called in server.js /api/batch ✓
- `onResult` events: `{ type: 'progress', company, found, new, error? }` and `{ type: 'new', url, title, company, location }` ✓
- `onProgress` events: `{ type: 'progress', id, url, status, score?, company?, role?, message? }` and `{ type: 'start', total }` and `{ type: 'done', evaluated, errors }` ✓
- `tracker.listPipeline()` returns `[{ id, url, processed, title, ... }]` — matches batch.js usage ✓

**No placeholders found.**
