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

  it('falls back to the MIME type for code files without a known extension', () => {
    expect(getFileLanguageName('bundle', 'application/javascript')).toBe('javascript');
    expect(getFileLanguageName('bundle', 'application/x-javascript')).toBe('javascript');
    expect(getFileLanguageName('bundle', 'text/javascript; charset=utf-8')).toBe('javascript');
    expect(getFileLanguageName('types', 'application/typescript')).toBe('typescript');
    expect(getFileLanguageName('schema', 'application/sql')).toBe('sql');
    expect(getFileLanguageName('schema', 'text/x-sql')).toBe('sql');
    expect(getFileLanguageName('probe', 'text/x-python')).toBe('python');
    expect(getFileLanguageName('theme', 'text/css')).toBe('css');
    expect(getFileLanguageName('page', 'TEXT/HTML')).toBe('html');
    // The extension still wins, and an unknown type stays plain text.
    expect(getFileLanguageName('probe.py', 'application/javascript')).toBe('python');
    expect(getFileLanguageName('notes', 'text/plain')).toBe('plaintext');
    expect(getFileLanguageName('archive', 'application/octet-stream')).toBe('plaintext');
    expect(getFileLanguageName('notes.constructor', 'text/css')).toBe('css');
  });
});
