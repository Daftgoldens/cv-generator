'use strict';
const { parseListHtml } = require('../src/scrapers/linkedin');

describe('LinkedIn parseListHtml', () => {
  test('parse une carte basique', () => {
    const html = `
      <li>
        <div data-entity-urn="urn:li:jobPosting:1234567">
          <h3 class="base-search-card__title">Senior Data Engineer</h3>
          <h4 class="base-search-card__subtitle">Acme Corp</h4>
          <span class="job-search-card__location">Paris, France</span>
        </div>
      </li>
    `;
    const items = parseListHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: '1234567',
      title: 'Senior Data Engineer',
      company: 'Acme Corp',
      location: 'Paris, France',
      url: 'https://www.linkedin.com/jobs/view/1234567',
    });
  });

  test('parse plusieurs cartes', () => {
    const html = `
      <li><div data-entity-urn="urn:li:jobPosting:111"><h3 class="base-search-card__title">A</h3><h4 class="base-search-card__subtitle">X</h4></div></li>
      <li><div data-entity-urn="urn:li:jobPosting:222"><h3 class="base-search-card__title">B</h3><h4 class="base-search-card__subtitle">Y</h4></div></li>
    `;
    const items = parseListHtml(html);
    expect(items).toHaveLength(2);
    expect(items.map(i => i.sourceId)).toEqual(['111', '222']);
  });

  test('skip si pas de title ou company', () => {
    const html = `<li><div data-entity-urn="urn:li:jobPosting:333"></div></li>`;
    expect(parseListHtml(html)).toHaveLength(0);
  });

  test('strip les tags imbriqués', () => {
    const html = `
      <li><div data-entity-urn="urn:li:jobPosting:444">
        <h3 class="base-search-card__title"><span>Senior</span> Engineer</h3>
        <h4 class="base-search-card__subtitle">Acme  Corp</h4>
      </div></li>
    `;
    const items = parseListHtml(html);
    expect(items[0].title).toBe('Senior Engineer');
    expect(items[0].company).toBe('Acme Corp');
  });
});
