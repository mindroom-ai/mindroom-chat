// @vitest-environment jsdom
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { createClient, KnownMembership, MatrixEvent, Room } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../app/config/useClientConfig';
import {
  ScreenSizeProvider,
  useScreenSize as useAppScreenSize,
} from '../app/lib/hooks/useScreenSize';
import { withReasoning } from '../app/messages/agent-run/Reasoning';
import { LIVE_REASONING_KEY } from '../app/messages/live/useLiveReplyContent';
import { pdfFrameUrl as appPdfFrameUrl } from '../app/messages/viewers/pdfFrame';
import { applyAppTheme } from '../app/theme/appliedTheme';
import { DarkTheme, LightTheme } from '../app/theme/useTheme';
import { Dialog, Header, IconButton, Menu } from '../app/ui/glass/GlassPrimitives';
import { PopOut } from '../app/ui/directional';
import { IconTooltip } from '../app/ui/IconTooltip';
import { MenuEntry, MenuGroup } from '../app/ui/MenuEntry';
import { NavButton, NavItem, NavItemContent } from '../app/ui/nav/NavItem';
import * as ui from './ui';
import {
  pdfFrameUrl,
  replaceMatrixUserIdsWithDisplayNames,
  sanitizeHtml,
  useMarkdownHtml,
  useScreenSize,
  useThemeKind,
} from './ui';

// The test setup stands folds' plain components in for the glass ones; compare the real modules.
vi.unmock('../app/ui/glass/GlassPrimitives');

afterEach(cleanup);

describe('@mindroom/client-sdk/ui', () => {
  it("is the app's own components, not copies, so a plugin's menus, dialogs and rows look like the app's", () => {
    const app = {
      Dialog,
      Header,
      IconButton,
      IconTooltip,
      Menu,
      MenuEntry,
      MenuGroup,
      NavButton,
      NavItem,
      NavItemContent,
      PopOut,
    };
    const text = ['replaceMatrixUserIdsWithDisplayNames', 'sanitizeHtml', 'useMarkdownHtml'];
    const ownSurface = ['pdfFrameUrl', 'useScreenSize', 'useThemeKind'];
    // The SDK only grows: a name a plugin imports never goes.
    expect(Object.keys(ui).sort()).toEqual([...Object.keys(app), ...text, ...ownSurface].sort());
    Object.entries(app).forEach(([name, component]) => {
      expect(ui[name as keyof typeof ui], name).toBe(component);
    });
  });
});

/** The elements of `html`, as a plugin that sets it as an element's inner HTML gets them. */
const elementsOf = (html: string) => {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
};

// Raw HTML inside a line, which the Markdown renderer passes on as it is.
const UNSAFE =
  'Hi <script>alert(1)</script><img src="mxc://example.org/cat" onerror="alert(2)">' +
  ' <a href="javascript:alert(3)">open</a>';

/** Whether `html` is free of the script, the handler and the script link of `UNSAFE`. */
const expectSafe = (html: string) => {
  const element = elementsOf(html);
  expect(element.querySelector('script')).toBeNull();
  expect(element.querySelector('[onerror]')).toBeNull();
  expect(html).not.toMatch(/javascript:/i);
  // What is safe stays: the text, the image and the link's text.
  expect(element.textContent).toContain('Hi');
  expect(element.querySelector('img')?.getAttribute('src')).toBe('mxc://example.org/cat');
  expect(element.textContent).toContain('open');
};

describe('useMarkdownHtml', () => {
  const MARKDOWN = '# Plan\n\n- one\n- `two`\n\nSee [the docs](https://example.org/docs).';

  // First in this file: the renderer loads once per test file, and stays.
  it("is undefined until the renderer has loaded, then the HTML the app's reasoning shows", async () => {
    const { result } = renderHook(() => useMarkdownHtml(MARKDOWN));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBeDefined());
    const shown = elementsOf(result.current ?? '');
    expect(shown.querySelector('h1')?.textContent).toBe('Plan');
    expect([...shown.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'one',
      'two',
    ]);
    expect(shown.querySelector('li code')?.textContent).toBe('two');
    expect(shown.querySelector('a')?.getAttribute('href')).toBe('https://example.org/docs');

    // The app's reasoning, open while it streams, shows the same elements for the same Markdown.
    const { findByRole } = render(
      <>{withReasoning({ [LIVE_REASONING_KEY]: MARKDOWN }, null, {})}</>
    );
    const heading = await findByRole('heading', { level: 1, name: 'Plan' });
    expect(heading.parentElement?.innerHTML).toBe(shown.innerHTML);
  });

  it('drops scripts, event handlers and script links', async () => {
    const { result } = renderHook(() => useMarkdownHtml(UNSAFE));
    await waitFor(() => expect(result.current).toBeDefined());
    expectSafe(result.current ?? '');
  });

  it("keeps the link schemes the deployment adds, as the app's timeline does", async () => {
    const config = { messageRendering: { additionalAllowedUriSchemes: ['obsidian'] } };
    const link = (wrapper?: (props: { children: ReactNode }) => ReactNode) => {
      const { result } = renderHook(() => useMarkdownHtml('[note](obsidian://vault/x)'), {
        wrapper,
      });
      return waitFor(() => {
        expect(result.current).toBeDefined();
        return elementsOf(result.current ?? '').querySelector('a');
      });
    };
    expect((await link())?.hasAttribute('href')).toBe(false);
    const configured = await link(({ children }) => (
      <ClientConfigProvider value={config}>{children}</ClientConfigProvider>
    ));
    expect(configured?.getAttribute('href')).toBe('obsidian://vault/x');
  });
});

describe('sanitizeHtml', () => {
  it('drops scripts, event handlers and script links', () => {
    expectSafe(sanitizeHtml(UNSAFE));
  });
});

describe('replaceMatrixUserIdsWithDisplayNames', () => {
  const ROOM = '!lobby:example.org';
  const ADA = '@ada:example.org';

  /** A room whose members have these names, by user ID. */
  const roomWith = (names: Record<string, string>) => {
    const client = createClient({ baseUrl: 'https://example.org', userId: ADA });
    const room = new Room(ROOM, client, ADA);
    room.currentState.setStateEvents(
      Object.entries(names).map(
        ([userId, displayname]) =>
          new MatrixEvent({
            type: 'm.room.member',
            room_id: ROOM,
            sender: userId,
            state_key: userId,
            content: { membership: KnownMembership.Join, displayname },
          })
      )
    );
    return room;
  };

  it("names the room's members, also before punctuation, and leaves other IDs", () => {
    const room = roomWith({ [ADA]: 'Ada Lovelace' });
    expect(
      replaceMatrixUserIdsWithDisplayNames(room, `Ask ${ADA} or ${ADA}. Not @bob:example.org.`)
    ).toBe('Ask Ada Lovelace or Ada Lovelace. Not @bob:example.org.');
  });

  it('gives a shared name with its user ID, which shows so in Markdown', async () => {
    const room = roomWith({ [ADA]: 'Ada', '@ada2:example.org': 'Ada' });
    const named = replaceMatrixUserIdsWithDisplayNames(room, `Ask ${ADA}.`);
    // The user ID keeps its own direction beside a name in any script (U+2066 to U+2069).
    expect(named).toBe(`Ask Ada (\u2066${ADA}\u2069).`);
    const { result } = renderHook(() => useMarkdownHtml(named));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(elementsOf(result.current ?? '').textContent?.trim()).toBe(named);
  });
});

describe('useThemeKind', () => {
  it('is light or dark as the app applies its theme, and follows a switch', () => {
    act(() => applyAppTheme(LightTheme));
    const { result } = renderHook(() => useThemeKind());
    expect(result.current).toBe('light');

    act(() => applyAppTheme(DarkTheme));
    expect(result.current).toBe('dark');

    act(() => applyAppTheme(LightTheme));
    expect(result.current).toBe('light');
  });
});

describe('useScreenSize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Measures the window as the app's root does, and provides it as the app does. */
  function App({ children }: { children: ReactNode }) {
    return <ScreenSizeProvider value={useAppScreenSize()}>{children}</ScreenSizeProvider>;
  }

  const resizeTo = (width: number) =>
    act(() => {
      vi.stubGlobal('innerWidth', width);
      window.dispatchEvent(new Event('resize'));
    });

  it("is the size the app lays out by, under the app's provider, and follows a resize", () => {
    vi.stubGlobal('innerWidth', 390);
    const { result } = renderHook(() => useScreenSize(), { wrapper: App });
    expect(result.current).toBe('Mobile');

    resizeTo(900);
    expect(result.current).toBe('Tablet');

    resizeTo(1440);
    expect(result.current).toBe('Desktop');
  });

  it('is what the app provides, not a measure of its own', () => {
    vi.stubGlobal('innerWidth', 390);
    const { result } = renderHook(() => useScreenSize(), {
      wrapper: ({ children }) => <ScreenSizeProvider value="Tablet">{children}</ScreenSizeProvider>,
    });
    expect(result.current).toBe('Tablet');
  });
});

describe('pdfFrameUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the app's PDF frame page under its base path, with the encoded object URL after #", () => {
    vi.stubGlobal('__APP_BASE_PATH__', '/mindroom/');
    const objectUrl = 'blob:https://chat.example.org/0b5e-4c1d';
    expect(pdfFrameUrl(objectUrl)).toBe(
      `/mindroom/pdf-frame.html#${encodeURIComponent(objectUrl)}`
    );
  });

  it("is the app's own, which its PDF viewer frames with", () => {
    expect(pdfFrameUrl).toBe(appPdfFrameUrl);
  });

  it.each(['https://chat.example.org/report.pdf', 'javascript:alert(1)'])(
    'is undefined for %s, which the app shows no PDF from',
    (url) => {
      expect(pdfFrameUrl(url)).toBeUndefined();
    }
  );
});
