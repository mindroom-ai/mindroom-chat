// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { CallEmbed } from './CallEmbed';

describe('Element Call background', () => {
  it('layers the transparent iframe above the host animation', () => {
    const iframe = CallEmbed.getIframe('https://example.org/call');

    expect(iframe.style.backgroundColor).toBe('transparent');
    expect(iframe.style.position).toBe('relative');
    expect(iframe.style.zIndex).toBe('1');
  });
});
