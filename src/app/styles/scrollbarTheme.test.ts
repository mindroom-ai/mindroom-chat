import { readFileSync } from 'node:fs';
import chroma from 'chroma-js';
import { describe, expect, it } from 'vitest';

const indexCss = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const foldsCss = readFileSync(
  new URL('../../../node_modules/folds/dist/style.css', import.meta.url),
  'utf8'
);

describe('scrollbar theme', () => {
  it('keeps the dark-theme thumb visible on the weakest dark track', () => {
    const thumbValue = indexCss.match(
      /\.dark-theme,\s*\.midnight-theme,\s*\.butter-theme\s*\{[^}]*--mr-scrollbar-thumb-color:\s*(#[\da-f]{8})/i
    )?.[1];
    if (!thumbValue) throw new Error('Dark scrollbar thumb token is missing.');

    const weakestDarkTrack = '#175030';
    const thumb = chroma(thumbValue);
    const renderedThumb = chroma.mix(weakestDarkTrack, thumb.alpha(1), thumb.alpha(), 'rgb');

    expect(chroma.contrast(renderedThumb, weakestDarkTrack)).toBeGreaterThanOrEqual(3);

    const thumbFallback = 'var(--mr-scrollbar-thumb-color, var(--_4yxtfd1))';
    expect(foldsCss.split(thumbFallback)).toHaveLength(5);
    expect(foldsCss).toContain(`scrollbar-color: ${thumbFallback} var(--_4yxtfd0)`);
  });
});
