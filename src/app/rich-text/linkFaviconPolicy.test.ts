import { describe, expect, it } from 'vitest';
import { shouldShowLinkFavicons } from './linkFaviconPolicy';

describe('shared link favicon settings', () => {
  it.each([
    { mediaAutoLoad: false, urlPreview: true, encrypted: false, want: false },
    { mediaAutoLoad: false, urlPreview: true, encrypted: true, want: false },
    { mediaAutoLoad: true, urlPreview: false, encrypted: false, want: false },
    { mediaAutoLoad: true, urlPreview: true, encrypted: false, want: true },
    { mediaAutoLoad: true, urlPreview: true, encrypted: true, want: false },
    { mediaAutoLoad: undefined, urlPreview: true, encrypted: false, want: false },
    { mediaAutoLoad: true, urlPreview: undefined, encrypted: false, want: false },
  ])('applies the room-specific policy: %j', ({ encrypted, want, ...settings }) => {
    expect(shouldShowLinkFavicons(settings, encrypted)).toBe(want);
  });

  it('never shows icons in encrypted rooms, whatever the encrypted preview setting says', () => {
    const settings = { mediaAutoLoad: true, urlPreview: true, encUrlPreview: true };
    expect(shouldShowLinkFavicons(settings, true)).toBe(false);
  });
});
