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
