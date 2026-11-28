import { describe, expect, it } from 'vitest';
import {
  decodeInlinePreviewText,
  getFileLanguageName,
  isTextPreviewableFile,
} from './fileTextPreview';

const OCTET_STREAM = 'application/octet-stream';

const bundledLanguages = [
  ['sample.HTM', 'html'],
  ['sample.svg', 'xml'],
  ['sample.css', 'css'],
  ['sample.cjs', 'javascript'],
  ['sample.jsx', 'jsx'],
  ['sample.mts', 'typescript'],
  ['sample.tsx', 'tsx'],
  ['sample.json', 'json'],
  ['sample.yml', 'yaml'],
  ['sample.toml', 'toml'],
  ['sample.ini', 'ini'],
  ['sample.sh', 'bash'],
  ['sample.sh-session', 'shell-session'],
  ['sample.ps1', 'powershell'],
  ['sample.py', 'python'],
  ['sample.md', 'markdown'],
  ['sample.diff', 'diff'],
  ['sample.patch', 'diff'],
  ['sample.dockerfile', 'docker'],
  ['sample.mk', 'makefile'],
  ['sample.nix', 'nix'],
  ['sample.sql', 'sql'],
  ['sample.gql', 'graphql'],
  ['sample.scss', 'scss'],
  ['sample.c', 'c'],
  ['sample.hpp', 'cpp'],
  ['sample.cs', 'csharp'],
  ['sample.java', 'java'],
  ['sample.kts', 'kotlin'],
  ['sample.swift', 'swift'],
  ['sample.go', 'go'],
  ['sample.rs', 'rust'],
  ['sample.rb', 'ruby'],
  ['sample.php', 'php'],
  ['sample.lua', 'lua'],
  ['sample.R', 'r'],
  ['sample.hs', 'haskell'],
  ['sample.exs', 'elixir'],
  ['Makefile', 'makefile'],
  ['GNUmakefile', 'makefile'],
  ['Dockerfile', 'docker'],
  ['Containerfile.preview', 'docker'],
  ['.bashrc', 'bash'],
  ['.editorconfig', 'ini'],
] as const;

describe('getFileLanguageName', () => {
  it.each(bundledLanguages)('recognizes %s as %s with generic MIME', (name, language) => {
    expect(getFileLanguageName(name, OCTET_STREAM)).toBe(language);
    expect(isTextPreviewableFile(name, OCTET_STREAM)).toBe(true);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'ignores prototype names such as %s',
    (key) => {
      expect(getFileLanguageName(`sample.${key}`, 'text/plain')).toBe('plaintext');
      expect(getFileLanguageName(`sample.${key}`, 'application/json')).toBe('json');
      expect(isTextPreviewableFile(`sample.${key}`, OCTET_STREAM)).toBe(false);
      expect(isTextPreviewableFile('sample', key)).toBe(false);
    }
  );

  it.each([
    ['application/javascript', 'javascript'],
    ['application/x-javascript', 'javascript'],
    ['text/javascript; charset=utf-8', 'javascript'],
    ['application/typescript', 'typescript'],
    ['application/sql', 'sql'],
    ['text/x-sql', 'sql'],
    ['text/x-python', 'python'],
    ['text/css', 'css'],
    ['TEXT/HTML', 'html'],
    ['application/vnd.example+json', 'json'],
    ['application/vnd.example+xml', 'xml'],
    ['application/vnd.example+yaml', 'yaml'],
    ['text/plain', 'plaintext'],
    [OCTET_STREAM, 'plaintext'],
  ])('falls back from an unknown extension to %s', (mimeType, language) => {
    expect(getFileLanguageName('sample.unlisted', mimeType)).toBe(language);
  });

  it('prefers a known extension and tolerates missing or malformed metadata', () => {
    expect(getFileLanguageName('sample.py', 'application/javascript')).toBe('python');
    expect(getFileLanguageName(null, 'application/yaml')).toBe('yaml');
    expect(getFileLanguageName('sample.py', {})).toBe('python');
    expect(getFileLanguageName(null, {})).toBe('plaintext');
  });
});

describe('isTextPreviewableFile', () => {
  it.each([
    'sample.txt',
    'sample.log',
    'sample.csv',
    'sample.tsv',
    'sample.rst',
    'sample.env',
    '.env',
    '.env.preview',
    '.gitignore',
  ])('recognizes %s as plain text', (name) => {
    expect(isTextPreviewableFile(name, OCTET_STREAM)).toBe(true);
    expect(getFileLanguageName(name, OCTET_STREAM)).toBe('plaintext');
  });

  it.each([
    [' TEXT/PLAIN ; Charset=UTF-8 ', 'plaintext'],
    ['application/ld+json', 'json'],
    ['application/x-sh', 'plaintext'],
    ['application/toml', 'plaintext'],
    ['application/x-diff', 'diff'],
    ['Application/X-Patch; charset=utf-8', 'diff'],
    ['application/graphql', 'graphql'],
    ['IMAGE/SVG+XML; charset=utf-8', 'xml'],
  ])('allows %s by MIME alone as source', (mimeType, language) => {
    expect(isTextPreviewableFile(undefined, mimeType)).toBe(true);
    expect(getFileLanguageName(undefined, mimeType)).toBe(language);
  });

  it.each([
    '',
    undefined,
    {},
    ' APPLICATION/UNKNOWN; charset=utf-8 ',
    'application/rls-services+xml',
  ])('uses the filename only as a fallback for %s', (mimeType) => {
    expect(isTextPreviewableFile('sample.rs', mimeType)).toBe(true);
    expect(isTextPreviewableFile('sample.unlisted', mimeType)).toBe(false);
    expect(isTextPreviewableFile(null, mimeType)).toBe(false);
  });

  it.each(['application/pdf', 'image/bmp', 'application/zip', 'application/vnd.example+json'])(
    'does not override an explicit unlisted type %s',
    (mimeType) => {
      expect(isTextPreviewableFile('sample.txt', mimeType)).toBe(false);
    }
  );
});

describe('decodeInlinePreviewText', () => {
  it('decodes UTF-8, including an empty file', () => {
    expect(decodeInlinePreviewText(new ArrayBuffer(0))).toBe('');
    const bytes = new TextEncoder().encode('\uFEFFcafé 水');
    expect(decodeInlinePreviewText(bytes.buffer)).toBe('café 水');
  });

  it('rejects a BMP header and does not mistake a partial BOM for UTF-16', () => {
    const bmpHeader = new Uint8Array([0x42, 0x4d, 0x36, 0, 0, 0]);
    expect(decodeInlinePreviewText(bmpHeader.buffer)).toBeUndefined();
    expect(decodeInlinePreviewText(new Uint8Array([0xff, 0]).buffer)).toBeUndefined();
    expect(decodeInlinePreviewText(new Uint8Array([0xfe, 0]).buffer)).toBeUndefined();
  });

  it.each([
    ['little endian', [0xff, 0xfe, 0x41, 0x00, 0x34, 0x6c]],
    ['big endian', [0xfe, 0xff, 0x00, 0x41, 0x6c, 0x34]],
  ] as const)('decodes BOM-marked UTF-16 %s despite NUL bytes', (_, bytes) => {
    expect(decodeInlinePreviewText(new Uint8Array(bytes).buffer)).toBe('A水');
  });

  it('checks for NUL only within the first 8192 bytes', () => {
    const bytes = new Uint8Array(8193).fill(0x61);
    bytes[8192] = 0;
    expect(decodeInlinePreviewText(bytes.buffer)).toBe(`${'a'.repeat(8192)}\0`);
    bytes[8191] = 0;
    expect(decodeInlinePreviewText(bytes.buffer)).toBeUndefined();
  });
});
