'use strict';
/**
 * Cron scheduler — service Railway séparé.
 * Lance les jobs aux horaires définis.
 *
 * Schedule (heure de Paris) :
 *  - 06:00, 12:00, 18:00 → scan-ats (3x/jour)
 *  - 07:00, 13:00, 19:00 → scan-boards (3x/jour, décalé pour éviter contention)
 *  - 08:00, 14:00, 20:00 → batch-evaluate
 *  - 09:00, 15:00, 21:00 → generate-docs
 *  - 09:30 → daily-digest
 *
 * Usage : node src/cron/scheduler.js
 */
require('dotenv').config();
const cron = require('node-cron');
const runner = require('./runner');

const TZ = process.env.TZ || 'Europe/Paris';

function schedule(name, expr, fn) {
  console.log(`[cron] schedule ${name} : ${expr} (${TZ})`);
  cron.schedule(expr, async () => {
    const start = Date.now();
    console.log(`[cron] ▶ ${name} start`);
    try {
      const result = await fn();
      console.log(`[cron] ✓ ${name} done in ${Math.round((Date.now() - start) / 1000)}s`, JSON.stringify(result).slice(0, 300));
    } catch (err) {
      console.error(`[cron] ✗ ${name} failed:`, err.message);
    }
  }, { timezone: TZ });
}

console.log('[cron] Scheduler starting...');

schedule('scan-ats',       '0 6,12,18 * * *',  runner.runScanAts);
schedule('scan-boards',    '0 7,13,19 * * *',  runner.runScanBoards);
schedule('batch-evaluate', '0 8,14,20 * * *',  runner.runBatchEvaluate);
schedule('generate-docs',  '0 9,15,21 * * *',  runner.runGenerateDocs);
schedule('daily-digest',   '30 9 * * *',       runner.runDailyDigest);

console.log('[cron] Scheduler running. Ctrl+C to stop.');

// Keep process alive (node-cron runs in same process)
process.on('SIGTERM', () => { console.log('[cron] SIGTERM, shutting down'); process.exit(0); });
