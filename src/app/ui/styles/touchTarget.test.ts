import { describe, expect, it } from 'vitest';
import { touchTarget } from './touchTarget';

/** The layer's rule inside the coarse pointer query. */
const layerOf = (rule: ReturnType<typeof touchTarget>) => {
  const selectors = rule['@media']?.['(pointer: coarse)']?.selectors ?? {};
  const layer = Object.entries(selectors).find(([selector]) => selector.endsWith('::after'));
  if (!layer) throw new Error('Missing layer rule');
  return layer[1] as { insetInline: string; insetBlock: string };
};

describe('touchTarget', () => {
  it('negates a theme variable reach with calc, since a minus sign before var() is not CSS', () => {
    const { insetInline, insetBlock } = layerOf(touchTarget('var(--gap)'));
    expect(insetInline).toBe('min(0px, max(calc((100% - 44px) / 2), calc(-1 * var(--gap))))');
    expect(insetInline).not.toContain('-var(');
    expect(insetBlock).toBe('min(0px, max(calc((100% - 44px) / 2), calc(-1 * 44px)))');
  });
});
