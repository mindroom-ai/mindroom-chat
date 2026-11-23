import { describe, expect, it } from 'vitest';
import { getFileLanguageName } from './FileContent';

describe('getFileLanguageName', () => {
  it('does not return Object.prototype properties for prototype-named file extensions', () => {
    expect(getFileLanguageName('notes.constructor', 'text/plain')).toBe('plaintext');
    expect(getFileLanguageName('notes.__proto__', 'text/plain')).toBe('plaintext');
    expect(getFileLanguageName('notes.toString', 'text/plain')).toBe('plaintext');
    expect(getFileLanguageName('notes.hasOwnProperty', 'text/plain')).toBe('plaintext');
  });

  it('resolves known extensions and MIME fallbacks cleanly', () => {
    expect(getFileLanguageName('report.json', 'text/plain')).toBe('json');
    expect(getFileLanguageName('sensor.py', 'text/plain')).toBe('python');
    expect(getFileLanguageName('notes.constructor', 'application/json')).toBe('json');
    expect(getFileLanguageName('notes.__proto__', 'application/yaml')).toBe('yaml');
  });
});
