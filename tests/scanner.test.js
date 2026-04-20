'use strict';
const { detectApi, parseGreenhouse, parseAshby, parseLever, buildTitleFilter } = require('../src/scanner');

describe('detectApi', () => {
  test('detects Ashby from careers_url', () => {
    const r = detectApi({ careers_url: 'https://jobs.ashbyhq.com/mistral' });
    expect(r.type).toBe('ashby');
    expect(r.url).toContain('api.ashbyhq.com/posting-api/job-board/mistral');
  });

  test('detects Lever from careers_url', () => {
    const r = detectApi({ careers_url: 'https://jobs.lever.co/anthropic' });
    expect(r.type).toBe('lever');
    expect(r.url).toContain('api.lever.co/v0/postings/anthropic');
  });

  test('detects Greenhouse from api field', () => {
    const r = detectApi({ api: 'https://boards-api.greenhouse.io/v1/boards/openai/jobs', careers_url: '' });
    expect(r.type).toBe('greenhouse');
  });

  test('detects Greenhouse from job-boards URL', () => {
    const r = detectApi({ careers_url: 'https://job-boards.greenhouse.io/cohere' });
    expect(r.type).toBe('greenhouse');
    expect(r.url).toContain('boards-api.greenhouse.io/v1/boards/cohere/jobs');
  });

  test('returns null for unknown URL', () => {
    expect(detectApi({ careers_url: 'https://careers.example.com' })).toBeNull();
  });
});

describe('parseGreenhouse', () => {
  test('maps jobs array to normalized format', () => {
    const json = { jobs: [{ title: 'AI Engineer', absolute_url: 'https://gh.io/job/1', location: { name: 'Paris' } }] };
    const result = parseGreenhouse(json, 'Mistral');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ title: 'AI Engineer', url: 'https://gh.io/job/1', company: 'Mistral', location: 'Paris' });
  });

  test('handles empty jobs array', () => {
    expect(parseGreenhouse({ jobs: [] }, 'X')).toEqual([]);
  });
});

describe('parseAshby', () => {
  test('maps jobs array to normalized format', () => {
    const json = { jobs: [{ title: 'ML Engineer', jobUrl: 'https://ashby.io/job/2', location: 'Remote' }] };
    const result = parseAshby(json, 'Cohere');
    expect(result[0]).toEqual({ title: 'ML Engineer', url: 'https://ashby.io/job/2', company: 'Cohere', location: 'Remote' });
  });
});

describe('parseLever', () => {
  test('maps array to normalized format', () => {
    const json = [{ text: 'Data Scientist', hostedUrl: 'https://lever.co/job/3', categories: { location: 'NYC' } }];
    const result = parseLever(json, 'Scale AI');
    expect(result[0]).toEqual({ title: 'Data Scientist', url: 'https://lever.co/job/3', company: 'Scale AI', location: 'NYC' });
  });

  test('returns [] for non-array input', () => {
    expect(parseLever({}, 'X')).toEqual([]);
  });
});

describe('buildTitleFilter', () => {
  const filter = buildTitleFilter({
    positive: ['AI', 'Machine Learning'],
    negative: ['Junior', 'Intern'],
  });

  test('passes title matching positive keyword', () => {
    expect(filter('Senior AI Engineer')).toBe(true);
  });

  test('blocks title matching negative keyword', () => {
    expect(filter('AI Intern')).toBe(false);
  });

  test('blocks title with no positive match', () => {
    expect(filter('Backend Developer')).toBe(false);
  });

  test('case-insensitive', () => {
    expect(filter('machine learning engineer')).toBe(true);
  });
});
