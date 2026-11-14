import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room } from 'matrix-js-sdk';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ExploreTab } from './rail/ExploreTab';
import { NavToActivePathProvider } from '../routes/useNavToActivePath';
import { makeNavToActivePathAtom } from '../routes/navToActivePath';
import { SpaceProvider } from '../matrix/hooks/useSpace';
import { useNavToActivePathMapper } from '../routes/useNavToActivePathMapper';
import { getScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { getDesktopPageNavCollapsedStorageKey } from '../preferences/accountStorageKeys';
import {
  NavigationProvider,
  SectionPageRoot,
  CollapsibleSidebarNav,
  SpacePageRoot,
} from './Navigation';
import { type PanelPhase, usePanelPresence } from '../ui/panels/panelPresence';

const COLLAPSE_LABEL = 'Collapse navigation panel';
const EXPAND_LABEL = 'Expand navigation panel';
const storageState = new Map<string, string>();

vi.mock('../routes/useNavToActivePathMapper', () => ({ useNavToActivePathMapper: vi.fn() }));

vi.mock('folds', () => ({
  Icon: ({ src }: { src: string }) => React.createElement('span', { 'data-icon-src': src }),
  Icons: {
    ChevronLeft: 'chevron-left',
    ChevronRight: 'chevron-right',
    Explore: 'explore',
  },
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));

vi.mock('../config/useClientConfig', () => ({
  useClientConfig: () => ({ featuredCommunities: { openAsDefault: true } }),
}));

vi.mock('../ui/sidebar/SidebarItem', () => ({
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { outlined?: boolean }
  >(({ children, outlined: _outlined, ...props }, ref) =>
    React.createElement('button', { ...props, ref }, children)
  ),
  SidebarItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  SidebarItemTooltip: ({
    children,
    tooltip,
  }: {
    children: (ref: React.RefCallback<HTMLButtonElement>) => React.ReactNode;
    tooltip: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-tooltip': tooltip },
      children(() => undefined)
    ),
}));

vi.mock('../ui/page/Page', () => ({
  PageRoot: ({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) =>
    React.createElement('section', { 'data-testid': 'page-root' }, nav, children),
}));

vi.mock('./MobileFriendly', () => ({
  MobileFriendlyClientNav: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('./SidebarNav', () => ({
  SidebarNav: ({
    footer,
    onPageNavSelect,
  }: {
    footer?: React.ReactNode;
    onPageNavSelect?: (selected: boolean) => boolean;
  }) =>
    React.createElement(
      'nav',
      { 'data-testid': 'sidebar-rail' },
      React.createElement('button', {
        'aria-label': 'Select section',
        onClick: () => onPageNavSelect?.(false),
      }),
      React.createElement('button', {
        'aria-label': 'Select current section',
        onClick: () => onPageNavSelect?.(true),
      }),
      React.createElement(ExploreTab, { onSelect: onPageNavSelect }),
      footer
    ),
}));

type Renderer = ReturnType<typeof create>;

function LocationProbe() {
  const { pathname, search, hash, key } = useLocation();
  return <output data-testid="location" data-path={`${pathname}${search}${hash}`} data-key={key} />;
}

const navigationAtWidth = (width: number, initialPath = '/home/') => (
  <MemoryRouter
    initialEntries={[initialPath]}
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
  >
    <NavToActivePathProvider value={makeNavToActivePathAtom('@alice:example.org')}>
      <ScreenSizeProvider value={getScreenSize(width)}>
        <NavigationProvider>
          <CollapsibleSidebarNav />
          <SectionPageRoot nav={<aside data-testid="page-nav" />}>
            <main data-testid="page-content" />
            <LocationProbe />
          </SectionPageRoot>
        </NavigationProvider>
      </ScreenSizeProvider>
    </NavToActivePathProvider>
  </MemoryRouter>
);

const renderNavigation = (width = 1280, initialPath?: string): Renderer => {
  let renderer: Renderer;
  act(() => {
    renderer = create(navigationAtWidth(width, initialPath));
  });
  return renderer!;
};

const findButtons = (renderer: Renderer, label: string) =>
  renderer.root.findAllByType('button').filter((button) => button.props['aria-label'] === label);

const clickExplore = (renderer: Renderer): void => {
  act(() => {
    renderer.root.findByType(ExploreTab).findByType('button').props.onClick();
  });
};

const currentLocation = (renderer: Renderer) =>
  renderer.root.findByProps({ 'data-testid': 'location' }).props;

let navPhase: PanelPhase | undefined;

/** The page navigation; reports how its slot says it appears. */
function NavProbe() {
  navPhase = usePanelPresence()?.phase;
  return <aside data-testid="page-nav" />;
}

/**
 * A page that mounts anew for each path, as a space's page does for each space; Threads has no
 * navigation.
 */
function PagePerPath() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/threads/')) return <main data-testid="page-content" />;
  return (
    <SectionPageRoot key={pathname} nav={<NavProbe />}>
      <main data-testid="page-content" />
    </SectionPageRoot>
  );
}

/** The navigation beside pages that mount anew per path. */
const renderPagePerPath = (initialPath: string): Renderer => {
  let renderer: Renderer;
  act(() => {
    renderer = create(
      <MemoryRouter
        initialEntries={[initialPath]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <NavToActivePathProvider value={makeNavToActivePathAtom('@alice:example.org')}>
          <ScreenSizeProvider value={getScreenSize(1280)}>
            <NavigationProvider>
              <CollapsibleSidebarNav />
              <PagePerPath />
            </NavigationProvider>
          </ScreenSizeProvider>
        </NavToActivePathProvider>
      </MemoryRouter>
    );
  });
  return renderer!;
};

const navCount = (renderer: Renderer) =>
  renderer.root.findAllByProps({ 'data-testid': 'page-nav' }).length;

const expectNavigationState = (renderer: Renderer, collapsed: boolean): void => {
  const activeLabel = collapsed ? EXPAND_LABEL : COLLAPSE_LABEL;
  const inactiveLabel = collapsed ? COLLAPSE_LABEL : EXPAND_LABEL;
  const chevron = collapsed ? 'chevron-right' : 'chevron-left';

  expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar-rail' })).toHaveLength(1);
  expect(renderer.root.findAllByProps({ 'data-testid': 'page-nav' })).toHaveLength(
    collapsed ? 0 : 1
  );
  expect(renderer.root.findAllByProps({ 'data-testid': 'page-content' })).toHaveLength(1);
  expect(findButtons(renderer, activeLabel)).toHaveLength(1);
  expect(findButtons(renderer, inactiveLabel)).toHaveLength(0);
  expect(renderer.root.findAllByProps({ 'data-icon-src': chevron })).toHaveLength(1);
  expect(renderer.root.findAllByProps({ 'data-tooltip': activeLabel })).toHaveLength(1);
};

const expectNavigationWithoutToggle = (renderer: Renderer): void => {
  expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar-rail' })).toHaveLength(1);
  expect(renderer.root.findAllByProps({ 'data-testid': 'page-nav' })).toHaveLength(1);
  expect(findButtons(renderer, COLLAPSE_LABEL)).toHaveLength(0);
  expect(findButtons(renderer, EXPAND_LABEL)).toHaveLength(0);
};

describe('MindroomNavigation', () => {
  const storageKey = getDesktopPageNavCollapsedStorageKey('@alice:example.org');

  beforeEach(() => {
    vi.mocked(useNavToActivePathMapper).mockClear();
    storageState.clear();
    vi.stubGlobal('localStorage', {
      clear: vi.fn(() => storageState.clear()),
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      removeItem: vi.fn((key: string) => storageState.delete(key)),
      setItem: vi.fn((key: string, value: string) => storageState.set(key, value)),
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('tracks the already-resolved space from its route provider', () => {
    let renderer: Renderer;
    act(() => {
      renderer = create(
        <ScreenSizeProvider value={getScreenSize(1280)}>
          <SpaceProvider value={{ roomId: '!resolved-space:example.org' } as Room}>
            <NavigationProvider>
              <SpacePageRoot nav={<aside />}>
                <main />
              </SpacePageRoot>
            </NavigationProvider>
          </SpaceProvider>
        </ScreenSizeProvider>
      );
    });
    expect(useNavToActivePathMapper).toHaveBeenCalledWith('!resolved-space:example.org', true);
    act(() => renderer.unmount());
  });

  it('updates the navigation toggle tooltip and accessible name after a language change', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: {
        en: {
          translation: {
            sharedUi: {
              mindroomNavigation: {
                collapseNavigationPanel: COLLAPSE_LABEL,
                expandNavigationPanel: EXPAND_LABEL,
              },
            },
          },
        },
        de: {
          translation: {
            sharedUi: {
              mindroomNavigation: {
                collapseNavigationPanel: 'Navigationsleiste einklappen',
                expandNavigationPanel: 'Navigationsleiste ausklappen',
              },
            },
          },
        },
      },
    });
    let renderer: Renderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>{navigationAtWidth(1280)}</I18nextProvider>
      );
    });

    expect(findButtons(renderer!, COLLAPSE_LABEL)).toHaveLength(1);
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(findButtons(renderer!, 'Navigationsleiste einklappen')).toHaveLength(1);
    expect(
      renderer!.root.findAllByProps({ 'data-tooltip': 'Navigationsleiste einklappen' })
    ).toHaveLength(1);
    act(() => renderer!.unmount());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageState.clear();
  });

  it.each([751, 1124, 1125])('persists page navigation collapse at %i px', (width) => {
    let renderer = renderNavigation(width);

    expectNavigationState(renderer, false);

    act(() => findButtons(renderer, COLLAPSE_LABEL)[0]!.props.onClick());

    expectNavigationState(renderer, true);
    expect(localStorage.getItem(storageKey)).toBe('true');

    act(() => renderer.unmount());
    renderer = renderNavigation(width);

    expectNavigationState(renderer, true);

    act(() => findButtons(renderer, EXPAND_LABEL)[0]!.props.onClick());

    expectNavigationState(renderer, false);
    expect(localStorage.getItem(storageKey)).toBe('false');

    act(() => renderer.unmount());
  });

  it('ignores malformed persisted collapse values', () => {
    localStorage.setItem(storageKey, JSON.stringify('true'));

    const renderer = renderNavigation();

    expectNavigationState(renderer, false);

    act(() => renderer.unmount());
  });

  it.each([751, 1280])('toggles the current section without navigating at %i px', (width) => {
    const renderer = renderNavigation(width);
    let handled: boolean | undefined;
    act(() => {
      handled = findButtons(renderer, 'Select current section')[0]!.props.onClick();
    });
    expect(handled).toBe(true);
    expectNavigationState(renderer, true);
    act(() => {
      handled = findButtons(renderer, 'Select current section')[0]!.props.onClick();
    });
    expect(handled).toBe(true);
    expectNavigationState(renderer, false);
    act(() => renderer.unmount());
  });

  it.each([751, 1280])('toggles active Explorer without changing its page at %i px', (width) => {
    const path = '/explore/example.org/?term=matrix#results';
    const renderer = renderNavigation(width, path);
    const locationKey = currentLocation(renderer)['data-key'];

    expectNavigationState(renderer, false);
    clickExplore(renderer);
    expectNavigationState(renderer, true);
    expect(localStorage.getItem(storageKey)).toBe('true');
    expect(currentLocation(renderer)).toMatchObject({ 'data-path': path, 'data-key': locationKey });

    clickExplore(renderer);
    expectNavigationState(renderer, false);
    expect(localStorage.getItem(storageKey)).toBe('false');
    expect(currentLocation(renderer)).toMatchObject({ 'data-path': path, 'data-key': locationKey });
    act(() => renderer.unmount());
  });

  it.each([751, 1280])(
    'opens Explorer from another section and then toggles it at %i px',
    (width) => {
      localStorage.setItem(storageKey, 'true');
      const renderer = renderNavigation(width);

      clickExplore(renderer);
      expectNavigationState(renderer, false);
      expect(currentLocation(renderer)['data-path']).toBe('/explore/featured/');

      clickExplore(renderer);
      expectNavigationState(renderer, true);
      act(() => renderer.unmount());
    }
  );

  it.each([375, 750])(
    'opens the Explorer list on mobile without changing saved collapse at %i px',
    (width) => {
      localStorage.setItem(storageKey, 'true');
      const renderer = renderNavigation(width, '/explore/example.org/');

      clickExplore(renderer);
      expectNavigationWithoutToggle(renderer);
      expect(currentLocation(renderer)['data-path']).toBe('/explore/');
      expect(localStorage.getItem(storageKey)).toBe('true');
      act(() => renderer.unmount());
    }
  );

  it.each([751, 1280])('reopens and persists navigation on section selection at %i px', (width) => {
    let renderer = renderNavigation(width);
    act(() => findButtons(renderer, COLLAPSE_LABEL)[0]!.props.onClick());

    act(() => findButtons(renderer, 'Select section')[0]!.props.onClick?.());

    expectNavigationState(renderer, false);
    expect(localStorage.getItem(storageKey)).toBe('false');
    act(() => renderer.unmount());
    renderer = renderNavigation(width);
    expectNavigationState(renderer, false);
    act(() => renderer.unmount());
  });

  it('keeps the saved split-layout collapse choice when selecting a section on mobile', () => {
    localStorage.setItem(storageKey, 'true');
    const renderer = renderNavigation(750);

    act(() => findButtons(renderer, 'Select section')[0]!.props.onClick?.());

    expectNavigationWithoutToggle(renderer);
    expect(localStorage.getItem(storageKey)).toBe('true');
    act(() => renderer.unmount());
  });

  it.each([375, 750])(
    'keeps single-pane navigation visible at %i px despite a saved collapse choice',
    (width) => {
      localStorage.setItem(storageKey, 'true');

      const renderer = renderNavigation(width);

      expectNavigationWithoutToggle(renderer);

      act(() => renderer.unmount());
    }
  );

  it('preserves the collapse choice across desktop, tablet, and mobile resizing', () => {
    const renderer = renderNavigation(1280);

    act(() => findButtons(renderer, COLLAPSE_LABEL)[0]!.props.onClick());

    act(() => renderer.update(navigationAtWidth(1024)));
    expectNavigationState(renderer, true);

    act(() => renderer.update(navigationAtWidth(750)));
    expectNavigationWithoutToggle(renderer);
    expect(localStorage.getItem(storageKey)).toBe('true');

    act(() => renderer.update(navigationAtWidth(751)));
    expectNavigationState(renderer, true);

    act(() => findButtons(renderer, EXPAND_LABEL)[0]!.props.onClick());
    expectNavigationState(renderer, false);

    act(() => renderer.update(navigationAtWidth(1280)));
    expectNavigationState(renderer, false);
    expect(localStorage.getItem(storageKey)).toBe('false');

    act(() => renderer.unmount());
  });

  it('moves the navigation in when the click that opens it also opens a new page', () => {
    localStorage.setItem(storageKey, 'true');
    const renderer = renderPagePerPath('/home/');
    expect(navCount(renderer)).toBe(0);

    clickExplore(renderer);

    expect(navCount(renderer)).toBe(1);
    expect(navPhase).toBe('enter');
    act(() => renderer.unmount());
  });

  it('shows the navigation in place when a new page comes with it already open', () => {
    const renderer = renderPagePerPath('/home/');
    expect(navPhase).toBe('shown');

    clickExplore(renderer);

    expect(navCount(renderer)).toBe(1);
    expect(navPhase).toBe('shown');
    act(() => renderer.unmount());
  });

  it('moves the navigation in on the next page after it opens on a page without one', () => {
    localStorage.setItem(storageKey, 'true');
    const renderer = renderPagePerPath('/threads/');
    // Threads is not the selected section, so its button opens the navigation it does not show.
    act(() => findButtons(renderer, 'Select section')[0]!.props.onClick());
    expect(navCount(renderer)).toBe(0);

    clickExplore(renderer);

    expect(navCount(renderer)).toBe(1);
    expect(navPhase).toBe('enter');
    act(() => renderer.unmount());
  });
});
