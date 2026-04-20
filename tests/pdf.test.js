'use strict';

// Test pure functions only — no Playwright required
const {
  normalizeUnicode,
  buildHtmlFromTemplate,
  resolveFontPaths,
  getSectionLabels,
  getPageWidth,
} = require('../src/pdf');

describe('normalizeUnicode', () => {
  test('replaces em-dash with hyphen', () => {
    expect(normalizeUnicode('hello \u2014 world')).toBe('hello - world');
  });
  test('replaces smart quotes', () => {
    expect(normalizeUnicode('\u201cquote\u201d')).toBe('"quote"');
  });
  test('removes zero-width chars', () => {
    expect(normalizeUnicode('hel\u200blo')).toBe('hello');
  });
  test('replaces non-breaking space', () => {
    expect(normalizeUnicode('a\u00a0b')).toBe('a b');
  });
});

describe('getSectionLabels', () => {
  test('returns English labels for en', () => {
    const labels = getSectionLabels('en');
    expect(labels.summary).toBe('Professional Summary');
    expect(labels.experience).toBe('Work Experience');
    expect(labels.education).toBe('Education');
  });
  test('returns French labels for fr', () => {
    const labels = getSectionLabels('fr');
    expect(labels.summary).toBe('Profil');
    expect(labels.experience).toBe('Expériences');
    expect(labels.education).toBe('Formation');
  });
});

describe('getPageWidth', () => {
  test('returns letter width for usa-canada', () => {
    expect(getPageWidth('usa-canada')).toBe('816px');
  });
  test('returns a4 width for france', () => {
    expect(getPageWidth('france')).toBe('794px');
  });
  test('defaults to a4 for unknown', () => {
    expect(getPageWidth('unknown')).toBe('794px');
  });
});

describe('buildHtmlFromTemplate', () => {
  const profileData = {
    name: 'Baptiste Hoffmann',
    phone: '+33 7 82 98 80 75',
    email: 'baptistehoffmann02@gmail.com',
    linkedinUrl: 'https://linkedin.com/in/baptistehoffmann',
    linkedinDisplay: 'linkedin.com/in/baptistehoffmann',
    portfolioUrl: 'https://kronvex.io',
    portfolioDisplay: 'kronvex.io',
    location: 'Paris, France',
  };

  const sectionData = {
    summary: 'Test summary',
    competencies: ['Python', 'FastAPI'],
    experience: '<div class="job"><p>Experience</p></div>',
    projects: '<div class="project"><p>Project</p></div>',
    education: '<div class="edu-item">Education</div>',
    certifications: '<div class="cert-item">Cert</div>',
    skills: '<div class="skills-grid">Skills</div>',
  };

  test('replaces NAME placeholder', () => {
    const template = '<html><body>{{NAME}}</body></html>';
    const result = buildHtmlFromTemplate(template, profileData, sectionData, 'en', 'france');
    expect(result).toContain('Baptiste Hoffmann');
    expect(result).not.toContain('{{NAME}}');
  });

  test('replaces all section labels for FR', () => {
    const template = '<div>{{SECTION_SUMMARY}}</div><div>{{SECTION_EXPERIENCE}}</div>';
    const result = buildHtmlFromTemplate(template, profileData, sectionData, 'fr', 'france');
    expect(result).toContain('Profil');
    expect(result).toContain('Expériences');
  });

  test('renders competency tags', () => {
    const template = '<div>{{COMPETENCIES}}</div>';
    const result = buildHtmlFromTemplate(template, profileData, sectionData, 'en', 'france');
    expect(result).toContain('<span class="tag">Python</span>');
    expect(result).toContain('<span class="tag">FastAPI</span>');
  });

  test('no unreplaced placeholders remain', () => {
    const fs = require('fs');
    const path = require('path');
    const template = fs.readFileSync(
      path.join(__dirname, '../templates/cv-template.html'), 'utf8'
    );
    const result = buildHtmlFromTemplate(template, profileData, sectionData, 'en', 'usa-canada');
    expect(result).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

describe('resolveFontPaths', () => {
  test('replaces ./fonts/ with absolute file:// path', () => {
    const html = "<style>url('./fonts/dm-sans-latin.woff2')</style>";
    const result = resolveFontPaths(html, '/abs/path/to');
    expect(result).toContain('file:///abs/path/to/fonts/dm-sans-latin.woff2');
    expect(result).not.toContain('./fonts/');
  });
});
