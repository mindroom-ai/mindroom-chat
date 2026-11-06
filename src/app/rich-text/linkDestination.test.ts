import { describe, expect, it } from 'vitest';
import { linkTextMisleads, stripBidiControls } from './linkDestination';

describe('stripBidiControls', () => {
  it('removes embeddings, overrides and isolates but keeps marks', () => {
    expect(stripBidiControls('https://\u202Egro.elpmaxe\u202C')).toBe('https://gro.elpmaxe');
    expect(stripBidiControls('\u2066a\u2067b\u2068c\u2069 \u202Ad\u202Be\u202Df')).toBe('abc def');
    expect(stripBidiControls('שלום\u200F.txt\u200E')).toBe('שלום\u200F.txt\u200E');
  });
});

describe('linkTextMisleads', () => {
  it.each([
    // Text that names another site.
    ['https://\u202Egro.elpmaxe\u202C', 'https://evil.example/', true],
    ['https://example.org', 'https://evil.example/', true],
    ['https://example.org/login', 'https://example.org.evil.example/login', true],
    ['https://example.org', 'https://example.org@evil.example/', true],
    ['example.com', 'https://evil.example/', true],
    ['www.example.org', 'https://evil.example/', true],
    ['example.net/reset', 'https://evil.example/reset', true],
    ['https://bank.example', 'mailto:help@evil.example', true],
    ['https://example.org', 'not a url', true],
    // Text that names the same site.
    ['https://example.org', 'https://example.org/', false],
    ['https://example.org/a', 'https://example.org/b', false],
    ['HTTPS://EXAMPLE.ORG', 'https://example.org/', false],
    ['example.org', 'https://www.example.org/', false],
    ['www.example.org/docs', 'https://example.org/docs', false],
    ['https://bücher.example', 'https://xn--bcher-kva.example/', false],
    // Text that is not an address.
    ['the docs', 'https://evil.example/', false],
    ['notes.md', 'https://files.example/notes.md', false],
    ['config.yaml:12', 'https://code.example/config.yaml#L12', false],
    ['help@example.org', 'mailto:help@example.org', false],
    ['see https://example.org', 'https://evil.example/', false],
    ['', 'https://evil.example/', false],
  ])('%j opening %j: %s', (text, href, misleads) => {
    expect(linkTextMisleads(text, href)).toBe(misleads);
  });
});
