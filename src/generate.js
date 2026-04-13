'use strict';
const { detectLanguage, detectRegion, selectTemplate, loadTemplate } = require('./templates.js');
const { adaptCv, generateCoverLetter } = require('./claude.js');
const { generateCvPdf, generateCoverLetterPdf } = require('./pdf.js');

async function generate({ offerContent, location, workMode, withCoverLetter, templateOverride }) {
  const language = detectLanguage(offerContent);
  const region = detectRegion(location);
  const templateFile = templateOverride || selectTemplate(region, language);
  const templateMd = loadTemplate(templateFile);

  // Adapt CV with Claude
  const { markdown: adaptedCv, company, role } = await adaptCv(templateMd, offerContent, workMode, location);

  // Generate CV PDF (French CVs include photo)
  const withPhoto = templateFile === 'CV_France.md';
  const cvBuffer = await generateCvPdf(adaptedCv, withPhoto);

  const safeCompany = company.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const isEnglish = language === 'en';
  const cvFilename = isEnglish
    ? `Resume_Baptiste_Hoffmann_${safeCompany}.pdf`
    : `CV_Baptiste_Hoffmann_${safeCompany}.pdf`;

  const result = {
    cv: { data: cvBuffer.toString('base64'), filename: cvFilename }
  };

  if (withCoverLetter) {
    const clMarkdown = await generateCoverLetter(offerContent, language, company, role, location);
    const clBuffer = await generateCoverLetterPdf(clMarkdown);
    const clFilename = isEnglish
      ? `Cover_Letter_Baptiste_Hoffmann_${safeCompany}.pdf`
      : `Lettre_de_motivation_Baptiste_Hoffmann_${safeCompany}.pdf`;
    result.coverLetter = { data: clBuffer.toString('base64'), filename: clFilename };
  }

  return result;
}

module.exports = { generate };
