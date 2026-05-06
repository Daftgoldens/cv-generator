'use strict';
/**
 * Orchestrateur des jobs cron.
 *
 * Pipeline quotidien :
 *  1. scan-ats        — scanner.scanPortals (Greenhouse/Ashby/Lever)
 *  2. scan-boards     — scrapers (LinkedIn/WTTJ/Indeed/HelloWork)
 *  3. batch-evaluate  — évalue toutes les nouvelles entrées du pipeline
 *  4. generate-docs   — pour les apps avec score >= threshold, génère CV+lettre, upload sur Supabase Storage
 *  5. daily-digest    — récap email + Telegram
 *
 * Chaque étape log un cron_run en DB pour debugging.
 */

const { createClient } = require('@supabase/supabase-js');
const { scanPortals } = require('../scanner');
const { runAllScrapers } = require('../scrapers');
const { batchEvaluate } = require('../batch');
const tracker = require('../tracker');
const { generate } = require('../generate');
const { uploadPdf } = require('../storage/supabase-storage');
const telegram = require('../notifier/telegram');
const email = require('../notifier/email');
const { fetchOffer } = require('../fetch-offer');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

async function getSettings(supabase) {
  const { data } = await supabase.from('auto_settings').select('*').eq('id', 1).maybeSingle();
  return data || {
    scoring_threshold: 7.0,
    daily_digest_enabled: true,
    telegram_enabled: true,
    email_enabled: true,
    cron_scan_ats_enabled: true,
    cron_scan_boards_enabled: true,
    cron_batch_evaluate_enabled: true,
    cron_generate_docs_enabled: true,
    daily_application_cap: 30,
  };
}

async function logRunStart(supabase, jobName) {
  const { data } = await supabase
    .from('cron_runs')
    .insert({ job_name: jobName, status: 'running' })
    .select()
    .single();
  return data?.id;
}

async function logRunEnd(supabase, runId, { status, items_processed = 0, items_new = 0, error = null, metadata = null }) {
  if (!runId) return;
  await supabase
    .from('cron_runs')
    .update({ finished_at: new Date().toISOString(), status, items_processed, items_new, error, metadata })
    .eq('id', runId);
}

// ============================================================
// Job 1 : scan-ats
// ============================================================
async function runScanAts() {
  const supabase = getSupabase();
  const settings = await getSettings(supabase);
  if (!settings.cron_scan_ats_enabled) return { skipped: true };

  const runId = await logRunStart(supabase, 'scan-ats');
  let totalNew = 0;
  let totalScanned = 0;
  const errors = [];

  try {
    await scanPortals(supabase, async (event) => {
      if (event.type === 'new') {
        const { error } = await supabase.from('pipeline').insert({
          url: event.url, title: event.title,
          company: event.company, location: event.location,
          source: 'ats-scanner',
        });
        if (!error) totalNew++;
      } else if (event.type === 'progress') {
        totalScanned++;
        if (event.error) errors.push(`${event.company}: ${event.error}`);
      }
    });
    await logRunEnd(supabase, runId, { status: 'success', items_processed: totalScanned, items_new: totalNew, metadata: { errors } });
    return { totalNew, totalScanned, errors };
  } catch (err) {
    await logRunEnd(supabase, runId, { status: 'failed', items_processed: totalScanned, items_new: totalNew, error: err.message });
    throw err;
  }
}

// ============================================================
// Job 2 : scan-boards (scrapers LinkedIn/WTTJ/Indeed/HelloWork)
// ============================================================
async function runScanBoards() {
  const supabase = getSupabase();
  const settings = await getSettings(supabase);
  if (!settings.cron_scan_boards_enabled) return { skipped: true };

  const runId = await logRunStart(supabase, 'scan-boards');
  try {
    const stats = await runAllScrapers(supabase, () => {});
    await logRunEnd(supabase, runId, {
      status: 'success',
      items_processed: stats.totalFound,
      items_new: stats.totalNew,
      metadata: stats.perSource,
    });
    return stats;
  } catch (err) {
    await logRunEnd(supabase, runId, { status: 'failed', error: err.message });
    throw err;
  }
}

// ============================================================
// Job 3 : batch-evaluate
// ============================================================
// Title filter (kept in sync with server.js, applied here too as defense-in-depth)
const TITLE_POSITIVE_JS = /\b(engineer|developer|ml|ai|data scientist|data engineer|data analyst|founding|llm|infrastructure|platform|backend|forward deployed|solutions|technical|ingénieur|ingenieur)\b/i;
const TITLE_NEGATIVE_JS = /\b(intern|stage|alternance|apprentice|manager|director|vp|head of|sales|marketing|recruiter|account|finance|legal|hr|people|security clearance|principal|counsel|partner|customer success|business development|risk|tax|accounting|compliance|operations associate|help desk|support engineer)\b|staff \+/i;

function passesTitle(title) {
  if (!title) return false;
  return TITLE_POSITIVE_JS.test(title) && !TITLE_NEGATIVE_JS.test(title);
}

async function runBatchEvaluate(maxItems = 50, companies = null) {
  const supabase = getSupabase();
  const settings = await getSettings(supabase);
  if (!settings.cron_batch_evaluate_enabled) return { skipped: true };

  const runId = await logRunStart(supabase, 'batch-evaluate');
  try {
    const all = await tracker.listPipeline();
    let items = all.filter(i => !i.processed && i.url && passesTitle(i.title));
    // Optional company filter (case-insensitive)
    if (companies && companies.length > 0) {
      const set = new Set(companies.map(c => c.toLowerCase()));
      items = items.filter(i => i.company && set.has(i.company.toLowerCase()));
    }
    items = items.slice(0, maxItems);

    if (items.length === 0) {
      await logRunEnd(supabase, runId, { status: 'success', items_processed: 0, items_new: 0 });
      return { evaluated: 0, candidates: 0 };
    }
    const results = await batchEvaluate(items, () => {});
    const ok = results.filter(r => r.status === 'done').length;
    const errors = results.filter(r => r.status === 'error').length;
    await logRunEnd(supabase, runId, {
      status: 'success',
      items_processed: results.length,
      items_new: ok,
      metadata: { errors, companies: companies || 'all' },
    });
    return { evaluated: ok, errors, candidates: items.length };
  } catch (err) {
    await logRunEnd(supabase, runId, { status: 'failed', error: err.message });
    throw err;
  }
}

// ============================================================
// Job 4 : generate-docs (pour les top scores)
// ============================================================
async function runGenerateDocs() {
  const supabase = getSupabase();
  const settings = await getSettings(supabase);
  if (!settings.cron_generate_docs_enabled) return { skipped: true };

  const runId = await logRunStart(supabase, 'generate-docs');
  try {
    const { data: candidates, error } = await supabase
      .from('applications')
      .select('*')
      .gte('score', settings.scoring_threshold)
      .is('cv_pdf_url', null)
      .eq('auto_generated', false)
      .order('score', { ascending: false })
      .limit(settings.daily_application_cap || 30);
    if (error) throw error;

    let generated = 0;
    const generatedApps = [];

    for (const app of candidates || []) {
      try {
        // Récupérer le contenu de l'offre (re-fetch ou utiliser report_md)
        let offerContent = '';
        try {
          offerContent = await fetchOffer(app.url);
        } catch (e) {
          console.warn('[gen-docs] fetch offer failed for', app.url, e.message);
          continue;
        }

        const result = await generate({
          offerContent,
          keywords: app.keywords || [],
          location: '',
          workMode: 'auto',
          withCoverLetter: true,
        });

        const cvBuffer = Buffer.from(result.cv.data, 'base64');
        const clBuffer = result.coverLetter ? Buffer.from(result.coverLetter.data, 'base64') : null;

        const cvKey = `auto/${app.id}/${result.cv.filename}`;
        const cvUrl = await uploadPdf(cvBuffer, cvKey);
        let clUrl = null;
        if (clBuffer) {
          const clKey = `auto/${app.id}/${result.coverLetter.filename}`;
          clUrl = await uploadPdf(clBuffer, clKey);
        }

        await supabase
          .from('applications')
          .update({
            cv_pdf_url: cvUrl,
            cover_letter_pdf_url: clUrl,
            auto_generated: true,
            company: result.meta?.company || app.company,
            role: result.meta?.role || app.role,
          })
          .eq('id', app.id);

        generated++;
        generatedApps.push({ ...app, cv_pdf_url: cvUrl, cover_letter_pdf_url: clUrl, company: result.meta?.company || app.company, role: result.meta?.role || app.role });
      } catch (err) {
        console.warn('[gen-docs] failed for app', app.id, err.message);
      }
    }

    // Notifier au fur et à mesure
    if (settings.telegram_enabled) {
      const baseUrl = process.env.PUBLIC_BASE_URL || '';
      for (const app of generatedApps) {
        await telegram.sendApplicationCard(app, baseUrl);
        await new Promise(r => setTimeout(r, 200));
      }
    }

    await logRunEnd(supabase, runId, {
      status: 'success',
      items_processed: candidates?.length || 0,
      items_new: generated,
    });
    return { generated, candidates: candidates?.length || 0, generatedApps };
  } catch (err) {
    await logRunEnd(supabase, runId, { status: 'failed', error: err.message });
    throw err;
  }
}

// ============================================================
// Job 5 : daily digest
// ============================================================
async function runDailyDigest() {
  const supabase = getSupabase();
  const settings = await getSettings(supabase);
  if (!settings.daily_digest_enabled) return { skipped: true };

  const runId = await logRunStart(supabase, 'daily-digest');
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [{ count: newPipeline }, { count: evaluated }, { count: generated }, { data: top }] = await Promise.all([
      supabase.from('pipeline').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('applications').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('applications').select('*', { count: 'exact', head: true }).gte('created_at', since).eq('auto_generated', true),
      supabase.from('applications').select('id, company, role, score').gte('created_at', since).order('score', { ascending: false }).limit(10),
    ]);

    const stats = {
      newPipeline: newPipeline || 0,
      evaluated: evaluated || 0,
      generated: generated || 0,
      topApplications: top || [],
    };

    const baseUrl = process.env.PUBLIC_BASE_URL || '';
    if (settings.telegram_enabled) await telegram.sendDailyDigest(stats);
    if (settings.email_enabled) await email.sendDailyDigest(stats, baseUrl);

    await logRunEnd(supabase, runId, { status: 'success', items_processed: 1, metadata: stats });
    return stats;
  } catch (err) {
    await logRunEnd(supabase, runId, { status: 'failed', error: err.message });
    throw err;
  }
}

// ============================================================
// Pipeline complet (chained)
// ============================================================
async function runFullPipeline() {
  const out = {};
  try { out.scanAts = await runScanAts(); } catch (e) { out.scanAts = { error: e.message }; }
  try { out.scanBoards = await runScanBoards(); } catch (e) { out.scanBoards = { error: e.message }; }
  try { out.batchEvaluate = await runBatchEvaluate(); } catch (e) { out.batchEvaluate = { error: e.message }; }
  try { out.generateDocs = await runGenerateDocs(); } catch (e) { out.generateDocs = { error: e.message }; }
  return out;
}

module.exports = {
  runScanAts,
  runScanBoards,
  runBatchEvaluate,
  runGenerateDocs,
  runDailyDigest,
  runFullPipeline,
};
