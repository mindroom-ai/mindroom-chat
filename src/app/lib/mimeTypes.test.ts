import { describe, expect, it } from 'vitest';
import { FALLBACK_MIMETYPE, getBlobSafeMimeType, isHeicMimeType } from './mimeTypes';

describe('mimeTypes', () => {
  it.each([
    ['image/heic', 'image/heic'],
    ['image/heif', 'image/heif'],
    ['image/heic-sequence', 'image/heic-sequence'],
    ['image/heif-sequence', 'image/heif-sequence'],
    ['IMAGE/HEIC; charset=binary', 'image/heic'],
    ['image/png', 'image/png'],
    ['video/quicktime', 'video/mp4'],
    ['image/svg+xml', FALLBACK_MIMETYPE],
    ['text/html', FALLBACK_MIMETYPE],
  ])('maps %s to safe blob type %s', (input, expected) => {
    expect(getBlobSafeMimeType(input)).toBe(expected);
  });

  it.each([
    ['image/heic', true],
    ['image/heif', true],
    ['image/heic-sequence', true],
    ['image/heif-sequence', true],
    ['Image/HEIF; profile=foo', true],
    ['image/jpeg', false],
    ['image/avif', false],
    ['image/svg+xml', false],
    ['', false],
  ])('identifies HEIC/HEIF type %s as %s', (input, expected) => {
    expect(isHeicMimeType(input)).toBe(expected);
  });
});
