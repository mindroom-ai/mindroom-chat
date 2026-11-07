import { describe, expect, it } from 'vitest';
import type { ClientConfig } from '../../config/useClientConfig';
import { MINDROOM_DEFAULT_POWERED_BY, MINDROOM_LOGO_ALT, MINDROOM_LOGO_SRC } from './branding';
import { resolveDeploymentBranding } from './deploymentBranding';

const ORIGIN = 'https://chat.example.test';

/** Resolves `config` as the app at ORIGIN would, collecting the warnings instead of logging them. */
const resolve = (config: unknown) => {
  const warnings: string[] = [];
  const branding = resolveDeploymentBranding(config as ClientConfig, ORIGIN, (message) =>
    warnings.push(message)
  );
  return { branding, warnings };
};

const DEFAULTS = {
  title: 'MindRoom Chat',
  pageTitle: undefined,
  logo: {
    src: MINDROOM_LOGO_SRC,
    srcDark: MINDROOM_LOGO_SRC,
    alt: MINDROOM_LOGO_ALT,
    custom: false,
  },
  footerText: undefined,
  footerLinks: [],
  poweredBy: MINDROOM_DEFAULT_POWERED_BY,
  supportUrl: undefined,
  privacyUrl: undefined,
  termsUrl: undefined,
};

describe('resolveDeploymentBranding', () => {
  it('keeps the MindRoom Chat defaults without a branding key or a configuration', () => {
    expect(resolve({})).toEqual({ branding: DEFAULTS, warnings: [] });
    expect(resolve(undefined)).toEqual({ branding: DEFAULTS, warnings: [] });
  });

  it('takes a full branding block', () => {
    const { branding, warnings } = resolve({
      branding: {
        title: '  Example Co  ',
        logo: {
          src: 'https://cdn.example.test/logo.svg',
          srcDark: '/branding/logo-dark.svg',
          alt: 'Example Co logo',
        },
        footer: {
          text: 'Example Co internal chat',
          links: [
            { label: 'Imprint', url: 'https://example.test/imprint' },
            { label: 'Help', url: 'mailto:help@example.test' },
          ],
        },
      },
      auth: {
        poweredBy: [{ label: 'Example Co', url: 'https://example.test' }],
        supportUrl: 'https://example.test/support',
      },
    });
    expect(warnings).toEqual([]);
    expect(branding).toEqual({
      title: 'Example Co',
      pageTitle: 'Example Co',
      logo: {
        src: 'https://cdn.example.test/logo.svg',
        srcDark: `${ORIGIN}/branding/logo-dark.svg`,
        alt: 'Example Co logo',
        custom: true,
      },
      footerText: ['Example Co internal chat'],
      footerLinks: [
        { label: 'Imprint', url: 'https://example.test/imprint' },
        { label: 'Help', url: 'mailto:help@example.test' },
      ],
      poweredBy: [{ label: 'Example Co', url: 'https://example.test' }],
      supportUrl: 'https://example.test/support',
      privacyUrl: undefined,
      termsUrl: undefined,
    });
  });

  it('uses the light logo in dark themes when no dark one is set', () => {
    const { branding } = resolve({ branding: { logo: { src: '/logo.png', alt: 'Example Co' } } });
    expect(branding.logo).toEqual({
      src: `${ORIGIN}/logo.png`,
      srcDark: `${ORIGIN}/logo.png`,
      alt: 'Example Co',
      custom: true,
    });
  });

  it('falls back to the defaults, with a warning, when branding is not an object', () => {
    for (const value of ['Example Co', 42, ['Example Co'], null]) {
      const { branding, warnings } = resolve({ branding: value });
      expect(branding).toEqual(DEFAULTS);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('branding');
    }
  });

  it('keeps the default title for a blank or non-string title', () => {
    for (const title of ['', '   ', 7, { text: 'Example Co' }]) {
      const { branding, warnings } = resolve({ branding: { title } });
      expect(branding.title).toBe('MindRoom Chat');
      expect(branding.pageTitle).toBeUndefined();
      expect(warnings).toEqual([expect.stringContaining('branding.title')]);
    }
  });

  it('keeps the default logo for a logo without alt text or with a refused address', () => {
    const refused = [
      { src: 'https://cdn.example.test/logo.svg' },
      { src: 'https://cdn.example.test/logo.svg', alt: '  ' },
      { src: 'http://cdn.example.test/logo.svg', alt: 'Example Co' },
      { src: 'javascript:alert(1)', alt: 'Example Co' },
      { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'Example Co' },
      { src: 'blob:https://chat.example.test/0b1c', alt: 'Example Co' },
      { src: 'file:///etc/logo.png', alt: 'Example Co' },
      { src: '', alt: 'Example Co' },
      { srcDark: 'https://cdn.example.test/dark.svg', alt: 'Example Co' },
      'https://cdn.example.test/logo.svg',
    ];
    for (const logo of refused) {
      const { branding, warnings } = resolve({ branding: { logo } });
      expect(branding.logo, JSON.stringify(logo)).toEqual(DEFAULTS.logo);
      expect(warnings).toEqual([expect.stringContaining('branding.logo')]);
    }
  });

  it('accepts plain http only on the app origin', () => {
    const warnings: string[] = [];
    const branding = resolveDeploymentBranding(
      { branding: { logo: { src: 'http://localhost:4200/logo.png', alt: 'Local' } } },
      'http://localhost:4200',
      (message) => warnings.push(message)
    );
    expect(branding.logo.src).toBe('http://localhost:4200/logo.png');
    expect(warnings).toEqual([]);
  });

  it('shows the light logo in dark themes when the dark one is refused', () => {
    const { branding, warnings } = resolve({
      branding: {
        logo: { src: 'https://cdn.example.test/logo.svg', srcDark: 'ftp://x/y.svg', alt: 'Co' },
      },
    });
    expect(branding.logo.srcDark).toBe('https://cdn.example.test/logo.svg');
    expect(warnings).toEqual([expect.stringContaining('branding.logo.srcDark')]);
  });

  it('keeps footer text as plain text and drops links it cannot open safely', () => {
    const { branding, warnings } = resolve({
      branding: {
        footer: {
          text: '<b>Example Co</b>',
          links: [
            { label: 'Imprint', url: 'https://example.test/imprint' },
            { label: 'Script', url: 'javascript:alert(1)' },
            { label: 'Relative', url: '/privacy' },
            { label: '  ', url: 'https://example.test/blank' },
            { label: 'Data', url: 'data:text/html,hi' },
            'https://example.test/bare',
          ],
        },
      },
    });
    expect(branding.footerText).toEqual(['<b>Example Co</b>']);
    expect(branding.footerLinks).toEqual([
      { label: 'Imprint', url: 'https://example.test/imprint' },
    ]);
    expect(warnings).toHaveLength(5);
    warnings.forEach((warning) => expect(warning).toContain('branding.footer.links'));
  });

  it('ignores a footer that is not an object and footer parts of the wrong type', () => {
    expect(resolve({ branding: { footer: 'Example Co' } })).toEqual({
      branding: DEFAULTS,
      warnings: [expect.stringContaining('branding.footer')],
    });
    const { branding, warnings } = resolve({ branding: { footer: { text: 5, links: 'x' } } });
    expect(branding.footerText).toBeUndefined();
    expect(branding.footerLinks).toEqual([]);
    expect(warnings).toEqual([
      expect.stringContaining('branding.footer.text'),
      expect.stringContaining('branding.footer.links'),
    ]);
  });

  it('reads a footer text list as one line with links, keeping a refused link as its label', () => {
    const { branding, warnings } = resolve({
      branding: {
        footer: {
          text: [
            { label: 'Example', url: 'https://example.test/source' },
            ' by ',
            { label: 'Example Co', url: 'javascript:alert(1)' },
            { url: 'https://example.test/unlabeled' },
            '',
            7,
          ],
        },
      },
    });
    expect(branding.footerText).toEqual([
      { label: 'Example', url: 'https://example.test/source' },
      ' by ',
      'Example Co',
    ]);
    expect(warnings).toEqual([
      expect.stringContaining('branding.footer.text[2]'),
      expect.stringContaining('branding.footer.text[3]'),
      expect.stringContaining('branding.footer.text[5]'),
    ]);
  });

  it('treats blank footer text as no text, without a warning', () => {
    expect(resolve({ branding: { footer: { text: ['  ', ''] } } })).toEqual({
      branding: DEFAULTS,
      warnings: [],
    });
    expect(resolve({ branding: { footer: { text: '  ' } } })).toEqual({
      branding: DEFAULTS,
      warnings: [],
    });
  });

  it('hides the credit line for an empty poweredBy and keeps the default for a malformed one', () => {
    expect(resolve({ auth: { poweredBy: [] } }).branding.poweredBy).toEqual([]);
    const { branding, warnings } = resolve({ auth: { poweredBy: 'MindRoom' } });
    expect(branding.poweredBy).toEqual(MINDROOM_DEFAULT_POWERED_BY);
    expect(warnings).toEqual([expect.stringContaining('auth.poweredBy')]);
  });

  it('drops credits and policy pages whose address is not http, https or mailto', () => {
    const { branding, warnings } = resolve({
      auth: {
        poweredBy: [
          { label: 'Example Co', url: 'https://example.test' },
          { label: 'Bad', url: 'javascript:alert(1)' },
        ],
        supportUrl: 'mailto:support@example.test',
        privacyUrl: 'javascript:alert(1)',
        termsUrl: 3,
      },
    });
    expect(branding.poweredBy).toEqual([{ label: 'Example Co', url: 'https://example.test' }]);
    expect(branding.supportUrl).toBe('mailto:support@example.test');
    expect(branding.privacyUrl).toBeUndefined();
    expect(branding.termsUrl).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringContaining('auth.poweredBy'),
      expect.stringContaining('auth.privacyUrl'),
      expect.stringContaining('auth.termsUrl'),
    ]);
  });
});
