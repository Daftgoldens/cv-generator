'use strict';
const { parseListingHtml } = require('../src/scrapers/hellowork');

describe('HelloWork parseListingHtml', () => {
  test('parse une carte basique', () => {
    const html = `
      <a href="/fr-fr/emplois/12345.html" class="card">
        <h3>Data Engineer</h3>
        <span data-cy="company-name">Acme Corp</span>
        <span data-cy="localisation">Paris</span>
      </a>
    `;
    const items = parseListingHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: '12345',
      url: 'https://www.hellowork.com/fr-fr/emplois/12345.html',
      title: 'Data Engineer',
      company: 'Acme Corp',
      location: 'Paris',
    });
  });

  test('skip si pas de title', () => {
    const html = `<a href="/fr-fr/emplois/123.html"><span data-cy="company-name">Acme</span></a>`;
    expect(parseListingHtml(html)).toHaveLength(0);
  });
});
