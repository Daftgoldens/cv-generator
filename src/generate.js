'use strict';
const { detectLanguage, detectRegion, selectTemplate, extractLocation } = require('./templates');
const { adaptCv, generateCoverLetter } = require('./claude');
const { generateCvPdf, generateCoverLetterPdf } = require('./pdf');

async function generate({
  offerContent,
  keywords,
  location,
  workMode,
  withCoverLetter,
  templateOverride,
  languageOverride,   // 'fr' | 'en' | undefined
  regionOverride,     // 'france' | 'usa-canada' | 'asia' | 'japan' | 'other' | undefined
  locationOverride,   // si l'user a explicitement choisi un lieu → on l'utilise tel quel
}) {
  // === LANGUAGE ===
  // Priorité : override explicite > détection auto
  const language = (languageOverride === 'fr' || languageOverride === 'en')
    ? languageOverride
    : detectLanguage(offerContent);

  // === LOCATION ===
  // Priorité : override explicite (champ user) > détection dans l'offre > location passée > défaut
  // L'override gagne TOUJOURS — si l'user a tapé un lieu, on le respecte.
  let effectiveLocation;
  if (locationOverride && locationOverride.trim()) {
    effectiveLocation = locationOverride.trim();
  } else {
    effectiveLocation = extractLocation(offerContent) || location || 'Paris, France';
  }

  // === REGION ===
  const region = (regionOverride && regionOverride !== 'auto')
    ? regionOverride
    : detectRegion(effectiveLocation);

  // adaptCv returns JSON sections + company/role
  const sections = await adaptCv(offerContent, keywords || [], workMode, effectiveLocation, language);
  const { company, role } = sections;

  // Generate CV PDF
  const cvBuffer = await generateCvPdf(sections, language, region, effectiveLocation);

  const safeCompany = (company || 'Company').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const cvFilename = language === 'fr'
    ? `CV_Baptiste_Hoffmann_${safeCompany}.pdf`
    : `Resume_Baptiste_Hoffmann_${safeCompany}.pdf`;

  const result = {
    cv: { data: cvBuffer.toString('base64'), filename: cvFilename },
    meta: { company, role, language, region, location: effectiveLocation },
  };

  if (withCoverLetter) {
    const clLang = language;
    const now = new Date();
    const months = {
      en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      fr: ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'],
    };
    const monthList = months[clLang] || months.en;
    const dateLine = `${monthList[now.getMonth()]} ${now.getFullYear()} · ${company} — Hiring Team`;

    const clBodyHtml = await generateCoverLetter(offerContent, clLang, company, role, effectiveLocation);
    const clBuffer = await generateCoverLetterPdf(clBodyHtml, clLang, region, company, dateLine);

    const clFilename = clLang === 'fr'
      ? `Lettre_de_motivation_Baptiste_Hoffmann_${safeCompany}.pdf`
      : `Cover_Letter_Baptiste_Hoffmann_${safeCompany}.pdf`;
    result.coverLetter = { data: clBuffer.toString('base64'), filename: clFilename };
  }

  return result;
}

module.exports = { generate };
