# Scanner + Batch — Design Spec
**Date:** 2026-04-20
**Status:** Approved

## Overview

Add two features to the Pipeline tab of cv-generator:
1. **Scanner** — zero-token scan of Greenhouse/Ashby/Lever APIs, new offers auto-added to Supabase pipeline table
2. **Batch evaluate** — evaluate all unprocessed pipeline URLs in parallel (3 workers), auto-save results to Tracker

Both features stream progress via SSE.

---

## Architecture

```
cv-generator/
├── src/
│   ├── scanner.js          # New — port of scan.mjs: API detection, fetch, filter, dedup
│   └── batch.js            # New — parallel evaluate() orchestrator with SSE
├── server.js               # Add: GET /api/scan (SSE), POST /api/batch (SSE)
└── public/index.html       # Modify Pipeline tab: scanner panel + batch button
```

**`career-ops/portals.yml` is read at runtime** from the sibling directory. On Railway (where career-ops isn't present), scanner returns a graceful "portals.yml not found" error — scanner is a local-only feature.

---

## Section 1: Scanner

### Backend — `src/scanner.js`

Ports the core logic from `career-ops/scan.mjs` to CommonJS. No file I/O — dedup against Supabase instead.

**`detectApi(company)`** — same logic as scan.mjs:
- `company.api` containing "greenhouse" → Greenhouse boards API
- `careers_url` matching `jobs.ashbyhq.com/{slug}` → Ashby posting API
- `careers_url` matching `jobs.lever.co/{slug}` → Lever postings API
- `careers_url` matching `job-boards.greenhouse.io/{slug}` → Greenhouse boards API
- Otherwise → `null` (skip company)

**`parseGreenhouse(json, company)`**, **`parseAshby(json, company)`**, **`parseLever(json, company)`** — same field mappings as scan.mjs, return `{ title, url, company, location }`.

**`buildTitleFilter(titleFilter)`** — returns `(title) => boolean`. Positive: at least 1 match. Negative: 0 matches.

**`scanPortals(portalsPath, seenUrls, onResult)`** — main function:
1. Read + parse `portalsPath` (YAML)
2. For each enabled company: detect API, fetch JSON (10s timeout, 10 concurrent)
3. Parse jobs, apply title filter
4. Filter out URLs in `seenUrls` Set
5. Call `onResult({ company, title, url, location, isNew: true })` for each new job
6. Return array of new job objects

**`getSeenUrls()`** — queries Supabase: all `url` values from `pipeline` + `applications` tables. Returns `Set<string>`.

**Exports:** `scanPortals`, `getSeenUrls`

### API — `GET /api/scan`

SSE endpoint. No request body.

```
Events:
  data: {"type":"progress","company":"Mistral AI","found":3,"new":2}
  data: {"type":"progress","company":"Anthropic","found":5,"new":0}
  data: {"type":"new","url":"https://...","title":"AI Engineer","company":"Mistral AI","location":"Paris"}
  data: {"type":"done","total_new":7,"total_scanned":45}
  data: {"type":"error","message":"portals.yml not found"}
```

For each `new` event, the server also inserts the URL into Supabase `pipeline` table (title + url).

Portals path: `path.join(__dirname, '..', '..', 'career-ops', 'portals.yml')` — relative to cv-generator.

---

## Section 2: Batch Evaluate

### Backend — `src/batch.js`

**`batchEvaluate(items, onProgress)`** — evaluates an array of pipeline items in parallel.

- `items`: array of `{ id, url }` (unprocessed pipeline items)
- Concurrency: 3 workers (Promise pool pattern — not Promise.all, to limit API load)
- Per item:
  1. Fetch offer content via `fetchOffer(url)` — reuse existing `src/fetch-offer.js`
  2. Call `evaluate(offerContent, 'auto', () => {})` — discard streaming chunks (batch mode)
  3. Parse result with `parseEvaluationResult(fullText)`
  4. Save to Supabase `applications` via `createApplication({ company, role, score, url, status: 'Evaluated', keywords })`
  5. Mark pipeline item as processed via `updatePipelineItem(id, { processed: true })`
  6. Call `onProgress({ id, url, status: 'done', score, company, role })` or `onProgress({ id, url, status: 'error', message })`
- On fetch/evaluate error: call onProgress with status 'error', continue to next item

**Exports:** `batchEvaluate`

### API — `POST /api/batch`

SSE endpoint. No request body — fetches unprocessed pipeline items from Supabase itself.

```
Events:
  data: {"type":"start","total":8}
  data: {"type":"progress","id":"uuid","url":"https://...","status":"evaluating"}
  data: {"type":"progress","id":"uuid","url":"https://...","status":"done","score":4.2,"company":"Mistral AI","role":"AI Engineer"}
  data: {"type":"progress","id":"uuid","url":"https://...","status":"error","message":"fetch failed"}
  data: {"type":"done","evaluated":7,"errors":1}
```

---

## Section 3: Pipeline Tab UI

### Scanner panel (top of tab)

```
[ 🔍 Scanner les portails ]   ← button, triggers GET /api/scan

During scan:
  Scanning... (spinner)
  ✓ Mistral AI — 2 nouvelles offres
  ✓ Anthropic — 0
  ✓ Cohere — 1 nouvelle offre
  ...
  Scan terminé — 3 nouvelles offres ajoutées

On error:
  portals.yml introuvable (scanner disponible en local uniquement)
```

New URLs added by scanner appear in the pipeline list in real time (no full reload needed — prepend to list).

### Batch button (above pipeline list)

```
[ ▶ Batch évaluer (N non traités) ]   ← shows count of unprocessed items

During batch:
  Each pipeline item shows inline status badge:
    ⏳ En cours...
    ✅ 4.2/5 — Mistral AI · AI Engineer
    ❌ Erreur fetch

After batch:
  "7 évaluations terminées · 1 erreur"
  Tracker tab badge updates (reload on next visit)
```

The batch button is disabled if 0 unprocessed items.

---

## Section 4: Error Handling

| Scenario | Behavior |
|----------|----------|
| portals.yml not found | SSE error event → "scanner disponible en local uniquement" |
| Company API fetch fails (timeout/404) | Skip company, log in progress event |
| Fetch offer fails (bad URL) | Mark item as error, continue batch |
| Claude API error during evaluate | Mark item as error, continue batch |
| Supabase insert fails | Log error server-side, item still shows as evaluated in UI |

---

## Out of Scope

- WebSearch queries (only direct Greenhouse/Ashby/Lever APIs, no search scraping)
- Scheduled/automatic scans
- Batch generate PDFs (evaluate only)
- scan-history.tsv dedup (Supabase tables are the source of truth)
