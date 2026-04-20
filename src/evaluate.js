'use strict';
const { evaluate } = require('./claude');

function parseEvaluationResult(fullText) {
  const jsonMatch = fullText.match(/\{[^{}]*"score"\s*:\s*[\d.]+[^{}]*\}/);
  if (!jsonMatch) return { score: null, company: '', role: '', keywords: [] };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: typeof parsed.score === 'number' ? parsed.score : null,
      company: parsed.company || '',
      role: parsed.role || '',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return { score: null, company: '', role: '', keywords: [] };
  }
}

// Express middleware: sets SSE headers and streams evaluation to client.
async function streamEvaluation(req, res) {
  const { offerContent, language = 'auto' } = req.body;

  if (!offerContent || offerContent.trim().length < 50) {
    return res.status(400).json({ error: 'offerContent too short' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  try {
    const fullText = await evaluate(offerContent, language, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    });

    const parsed = parseEvaluationResult(fullText);
    res.write(`data: ${JSON.stringify({ type: 'done', ...parsed })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
}

module.exports = { parseEvaluationResult, streamEvaluation };
