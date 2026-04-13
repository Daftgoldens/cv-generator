'use strict';
const { detectLanguage, detectRegion, selectTemplate, loadTemplate } = require('./templates.js');
const { adaptCv, generateCoverLetter } = require('./claude.js');
const { generateCvPdf, generateCoverLetterPdf } = require('./pdf.js');

async function generate({ offerContent, location, workMode, withCoverLetter, templateOverride }) {
  const language = detectLanguage(offerContent);
  const region = detectRegion(location);
  const templateFile = templateOverride || selectTemplate(region, language);
  const templateMd = loadTemplate(templateFile);

  // French context = CV_France.md template. Everything else = English.
  const isFrench = templateFile === 'CV_France.md';

  // Adapt CV with Claude
  const { markdown: adaptedCv, company, role } = await adaptCv(templateMd, offerContent, workMode, location);

  // Generate CV PDF
  const cvBuffer = await generateCvPdf(adaptedCv, { withPhoto: isFrench, compact: isFrench });

  const safeCompany = company.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const cvFilename = isFrench
    ? `CV_Baptiste_Hoffmann_${safeCompany}.pdf`
    : `Resume_Baptiste_Hoffmann_${safeCompany}.pdf`;

  const result = {
    cv: { data: cvBuffer.toString('base64'), filename: cvFilename }
  };

  if (withCoverLetter) {
    const clLang = isFrench ? 'fr' : 'en';
    const clMarkdown = await generateCoverLetter(offerContent, clLang, company, role, location);
    const clBuffer = await generateCoverLetterPdf(clMarkdown);
    const clFilename = isFrench
      ? `Lettre_de_motivation_Baptiste_Hoffmann_${safeCompany}.pdf`
      : `Cover_Letter_Baptiste_Hoffmann_${safeCompany}.pdf`;
    result.coverLetter = { data: clBuffer.toString('base64'), filename: clFilename };
  }

  return result;
}

module.exports = { generate };
