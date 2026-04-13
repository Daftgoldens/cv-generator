'use strict';
const puppeteer = require('puppeteer');
const { marked } = require('marked');

const CV_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 9pt; line-height: 1.4; color: #1a1a1a;
    padding: 13mm 14mm 11mm 14mm;
  }
  h1 {
    font-size: 17pt; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; margin-bottom: 2px;
  }
  h1 + p { font-size: 8pt; color: #444; margin-bottom: 10px; line-height: 1.5; }
  hr { border: none; border-top: 1.5px solid #1a1a1a; margin: 6px 0; }
  h2 {
    font-size: 8.5pt; font-weight: 700; letter-spacing: 1.5px;
    text-transform: uppercase; margin: 8px 0 4px 0;
    color: #1a1a1a; border-bottom: 0.5px solid #ccc; padding-bottom: 2px;
  }
  p { font-size: 8.5pt; margin-bottom: 3px; color: #222; }
  ul { padding-left: 13px; margin: 2px 0 5px 0; }
  li { margin-bottom: 1px; font-size: 8.5pt; line-height: 1.35; }
  strong { font-weight: 700; }
  em { color: #555; font-style: italic; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; margin: 3px 0 5px 0; }
  td, th { padding: 2px 6px; vertical-align: top; }
  td:first-child { white-space: nowrap; }
`;

const COVER_LETTER_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 10.5pt; line-height: 1.65; color: #1a1a1a;
    padding: 22mm 20mm 20mm 20mm;
  }
  h1 {
    font-size: 16pt; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; margin-bottom: 3px;
  }
  h1 + p { font-size: 8.8pt; color: #555; margin-bottom: 18px; line-height: 1.7; }
  hr { border: none; border-top: 1.5px solid #1a1a1a; margin: 10px 0 18px 0; }
  p { margin-bottom: 14px; font-size: 10.5pt; line-height: 1.65; }
  strong { font-weight: 700; }
`;

function wrapHtml(css, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>${css}</style></head>
<body>${bodyContent}</body>
</html>`;
}

async function generatePdf(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}

async function generateCvPdf(markdownContent) {
  const html = wrapHtml(CV_CSS, marked(markdownContent));
  return generatePdf(html);
}

async function generateCoverLetterPdf(markdownContent) {
  const html = wrapHtml(COVER_LETTER_CSS, marked(markdownContent));
  return generatePdf(html);
}

module.exports = { generateCvPdf, generateCoverLetterPdf };
