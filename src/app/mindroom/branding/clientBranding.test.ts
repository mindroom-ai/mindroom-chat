import { describe, expect, it } from 'vitest';

import { MINDROOM_CLIENT_BRANDING, getMindroomWelcomePageContent } from './clientBranding';

describe('clientBranding', () => {
  it('exposes client-facing MindRoom defaults', () => {
    expect(MINDROOM_CLIENT_BRANDING.appName).toBe('MindRoom');
    expect(MINDROOM_CLIENT_BRANDING.docsUrl).toBe('https://docs.mindroom.chat/');
    expect(MINDROOM_CLIENT_BRANDING.sourceUrl).toBe('https://github.com/mindroom-ai/mindroom');
    expect(MINDROOM_CLIENT_BRANDING.logoAlt).toBe('MindRoom Logo');
  });

  it('merges configured welcome content with MindRoom defaults', () => {
    expect(
      getMindroomWelcomePageContent({
        docsUrl: '',
        poweredBy: [{ label: 'Custom', url: 'https://example.test' }],
        title: 'Custom title',
      })
    ).toEqual({
      docsLabel: 'Docs',
      docsUrl: '',
      poweredBy: [{ label: 'Custom', url: 'https://example.test' }],
      sourceLabel: 'Source Code',
      sourceUrl: 'https://github.com/mindroom-ai/mindroom',
      subtitle: 'Yet another matrix client.',
      title: 'Custom title',
    });
  });
});
