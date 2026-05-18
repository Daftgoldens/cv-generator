'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const FONTS_DIR = path.join(__dirname, '..', 'fonts');

const PROFILE = {
  name: 'Baptiste Hoffmann',
  phone: '+33 7 82 98 80 75',
  email: 'baptistehoffmann02@gmail.com',
  linkedinUrl: 'https://linkedin.com/in/baptistehoffmann',
  linkedinDisplay: 'linkedin.com/in/baptistehoffmann',
  portfolioUrl: 'https://kronvex.io',
  portfolioDisplay: 'kronvex.io',
};

const SECTION_LABELS = {
  en: {
    summary: 'Professional Summary',
    competencies: 'Core Competencies',
    experience: 'Work Experience',
    projects: 'Projects',
    education: 'Education',
    certifications: 'Certifications',
    skills: 'Skills',
  },
  fr: {
    summary: 'Profil',
    competencies: 'Compétences clés',
    experience: 'Expériences',
    projects: 'Projets',
    education: 'Formation',
    certifications: 'Certifications',
    skills: 'Compétences techniques',
  },
};

const PAGE_WIDTHS = {
  'usa-canada': '816px',
  default: '794px',
};

function getSectionLabels(lang) {
  return SECTION_LABELS[lang] || SECTION_LABELS.en;
}

function getPageWidth(region) {
  return PAGE_WIDTHS[region] || PAGE_WIDTHS.default;
}

function normalizeUnicode(html) {
  return html
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ');
}

function resolveFontPaths(html, baseDir) {
  const normalized = baseDir.replace(/\\/g, '/').replace(/^\/+/, '');
  return html.replace(/url\(['"]?\.\/fonts\//g, `url('file:///${normalized}/fonts/`);
}

function buildHtmlFromTemplate(template, profileData, sectionData, lang, region) {
  const labels = getSectionLabels(lang);
  const pageWidth = getPageWidth(region);

  const competencyTags = (sectionData.competencies || [])
    .map(c => `<span class="tag">${c}</span>`)
    .join('\n      ');

  return template
    .replace(/\{\{LANG\}\}/g, lang)
    .replace(/\{\{PAGE_WIDTH\}\}/g, pageWidth)
    .replace(/\{\{NAME\}\}/g, profileData.name)
    .replace(/\{\{PHONE\}\}/g, profileData.phone)
    .replace(/\{\{EMAIL\}\}/g, profileData.email)
    .replace(/\{\{LINKEDIN_URL\}\}/g, profileData.linkedinUrl)
    .replace(/\{\{LINKEDIN_DISPLAY\}\}/g, profileData.linkedinDisplay)
    .replace(/\{\{PORTFOLIO_URL\}\}/g, profileData.portfolioUrl)
    .replace(/\{\{PORTFOLIO_DISPLAY\}\}/g, profileData.portfolioDisplay)
    .replace(/\{\{LOCATION\}\}/g, profileData.location || 'Paris, France')
    .replace(/\{\{SECTION_SUMMARY\}\}/g, labels.summary)
    .replace(/\{\{SUMMARY_TEXT\}\}/g, sectionData.summary || '')
    .replace(/\{\{SECTION_COMPETENCIES\}\}/g, labels.competencies)
    .replace(/\{\{COMPETENCIES\}\}/g, competencyTags)
    .replace(/\{\{SECTION_EXPERIENCE\}\}/g, labels.experience)
    .replace(/\{\{EXPERIENCE\}\}/g, sectionData.experience || '')
    .replace(/\{\{SECTION_PROJECTS\}\}/g, labels.projects)
    .replace(/\{\{PROJECTS\}\}/g, sectionData.projects || '')
    .replace(/\{\{SECTION_EDUCATION\}\}/g, labels.education)
    .replace(/\{\{EDUCATION\}\}/g, sectionData.education || '')
    .replace(/\{\{SECTION_CERTIFICATIONS\}\}/g, labels.certifications)
    .replace(/\{\{CERTIFICATIONS\}\}/g, sectionData.certifications || '')
    .replace(/\{\{SECTION_SKILLS\}\}/g, labels.skills)
    .replace(/\{\{SKILLS\}\}/g, sectionData.skills || '');
}

async function renderPdf(html, format) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  const margins = format === 'letter'
    ? { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' }
    : { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' };
  const buffer = await page.pdf({
    format: format === 'letter' ? 'Letter' : 'A4',
    margin: margins,
    printBackground: true,
  });
  await browser.close();
  return buffer;
}

async function generateCvPdf(sectionData, lang, region, location) {
  const templateHtml = fs.readFileSync(path.join(TEMPLATES_DIR, 'cv-template.html'), 'utf8');
  const profileData = { ...PROFILE, location };
  let html = buildHtmlFromTemplate(templateHtml, profileData, sectionData, lang, region);
  html = resolveFontPaths(html, path.dirname(TEMPLATES_DIR));
  html = normalizeUnicode(html);
  const format = region === 'usa-canada' ? 'letter' : 'a4';
  return renderPdf(html, format);
}

async function generateCoverLetterPdf(bodyHtml, lang, region, company, dateLine) {
  const templateHtml = fs.readFileSync(path.join(TEMPLATES_DIR, 'cover-template.html'), 'utf8');
  const pageWidth = getPageWidth(region);
  let html = templateHtml
    .replace(/\{\{LANG\}\}/g, lang)
    .replace(/\{\{PAGE_WIDTH\}\}/g, pageWidth)
    .replace(/\{\{NAME\}\}/g, PROFILE.name)
    .replace(/\{\{PHONE\}\}/g, PROFILE.phone)
    .replace(/\{\{EMAIL\}\}/g, PROFILE.email)
    .replace(/\{\{LINKEDIN_URL\}\}/g, PROFILE.linkedinUrl)
    .replace(/\{\{LINKEDIN_DISPLAY\}\}/g, PROFILE.linkedinDisplay)
    .replace(/\{\{PORTFOLIO_URL\}\}/g, PROFILE.portfolioUrl)
    .replace(/\{\{PORTFOLIO_DISPLAY\}\}/g, PROFILE.portfolioDisplay)
    .replace(/\{\{DATE_LINE\}\}/g, dateLine || '')
    .replace(/\{\{BODY\}\}/g, bodyHtml);
  html = resolveFontPaths(html, path.dirname(TEMPLATES_DIR));
  html = normalizeUnicode(html);
  const format = region === 'usa-canada' ? 'letter' : 'a4';
  return renderPdf(html, format);
}

module.exports = {
  normalizeUnicode,
  resolveFontPaths,
  buildHtmlFromTemplate,
  getSectionLabels,
  getPageWidth,
  generateCvPdf,
  generateCoverLetterPdf,
};
