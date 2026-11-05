import { describe, expect, it } from 'vitest';
import { parseHttpUrl, toHttpUrl } from './httpUrl';

describe('toHttpUrl', () => {
  it.each(['https://example.org/terms', 'http://localhost:8008/rules?lang=en'])('keeps %s', (url) =>
    expect(toHttpUrl(url)).toBe(url)
  );

  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,hi',
    'vbscript:msgbox',
    'file:///etc/passwd',
    '/relative/path',
    'not a url',
    '',
    42,
    undefined,
    { url: 'https://example.org' },
  ])('drops %j', (value) => {
    expect(toHttpUrl(value)).toBeUndefined();
    expect(parseHttpUrl(value)).toBeUndefined();
  });

  it('parses an http URL for further editing', () => {
    expect(parseHttpUrl('https://auth.example.org/account')?.host).toBe('auth.example.org');
  });
});
