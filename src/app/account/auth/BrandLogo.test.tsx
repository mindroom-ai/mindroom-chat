// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { DarkTheme, LightTheme, ThemeContextProvider, type Theme } from '../../theme/useTheme';
import { MINDROOM_LOGO_SRC } from '../../ui/branding/branding';
import { BrandLogo } from './BrandLogo';

vi.mock('../../theme/colors.css', () => ({
  lightTheme: 'light-palette',
  silverTheme: 'silver-palette',
  darkTheme: 'dark-palette',
  midnightTheme: 'midnight-palette',
  butterTheme: 'butter-palette',
  greenTheme: 'green-palette',
  orangeTheme: 'orange-palette',
}));

const BRANDED: ClientConfig = {
  branding: {
    logo: {
      src: 'https://cdn.example.test/logo.svg',
      srcDark: 'https://cdn.example.test/logo-dark.svg',
      alt: 'Example Co logo',
    },
  },
};

const renderLogo = (config: ClientConfig, theme: Theme) => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <ClientConfigProvider value={config}>
        <ThemeContextProvider value={theme}>
          <BrandLogo className="logo" />
        </ThemeContextProvider>
      </ClientConfigProvider>
    );
  });
  if (!renderer) throw new Error('not rendered');
  return renderer;
};

const image = (renderer: ReactTestRenderer) => renderer.root.findByType('img');

afterEach(() => vi.restoreAllMocks());

describe('BrandLogo', () => {
  it('shows the MindRoom Chat logo without a configured one', () => {
    const { props } = image(renderLogo({}, DarkTheme));
    expect(props.src).toBe(MINDROOM_LOGO_SRC);
    expect(props.alt).toBe('MindRoom Chat Logo');
    expect(props.className).toBe('logo');
    expect(props.referrerPolicy).toBeUndefined();
  });

  it("shows the configured logo for the theme's kind, without a referrer", () => {
    expect(image(renderLogo(BRANDED, LightTheme)).props).toMatchObject({
      src: 'https://cdn.example.test/logo.svg',
      alt: 'Example Co logo',
      referrerPolicy: 'no-referrer',
    });
    expect(image(renderLogo(BRANDED, DarkTheme)).props.src).toBe(
      'https://cdn.example.test/logo-dark.svg'
    );
  });

  it('falls back to the MindRoom Chat logo, with a warning, when the configured one fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const renderer = renderLogo(BRANDED, LightTheme);
    act(() => {
      image(renderer).props.onError();
    });
    expect(image(renderer).props).toMatchObject({
      src: MINDROOM_LOGO_SRC,
      alt: 'MindRoom Chat Logo',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('https://cdn.example.test/logo.svg'));
  });
});
