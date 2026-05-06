'use strict';
const { fingerprint } = require('../src/scrapers/fingerprint');

describe('fingerprint', () => {
  test('même offre = même hash', () => {
    const a = fingerprint({ title: 'Data Engineer', company: 'Acme', location: 'Paris' });
    const b = fingerprint({ title: 'Data Engineer', company: 'Acme', location: 'Paris' });
    expect(a).toBe(b);
  });

  test('insensible à la casse et espaces', () => {
    const a = fingerprint({ title: 'Data Engineer', company: 'Acme', location: 'Paris' });
    const b = fingerprint({ title: 'data engineer  ', company: 'ACME', location: ' paris ' });
    expect(a).toBe(b);
  });

  test('hash différent si company différente', () => {
    const a = fingerprint({ title: 'Data Engineer', company: 'Acme', location: 'Paris' });
    const b = fingerprint({ title: 'Data Engineer', company: 'OtherCo', location: 'Paris' });
    expect(a).not.toBe(b);
  });

  test('hash de 32 caractères hex', () => {
    const f = fingerprint({ title: 'X', company: 'Y', location: 'Z' });
    expect(f).toMatch(/^[a-f0-9]{32}$/);
  });
});
