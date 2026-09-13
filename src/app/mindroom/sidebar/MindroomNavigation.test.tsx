import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize } from '../../hooks/useScreenSize';
import { getDesktopPageNavCollapsedStorageKey } from './desktopPageNavState';
import {
  MindroomNavigationProvider,
  MindroomPageRoot,
  MindroomSidebarNav,
} from './MindroomNavigation';

const COLLAPSE_LABEL = 'Collapse navigation panel';
const EXPAND_LABEL = 'Expand navigation panel';
const screenSizeState = { value: ScreenSize.Desktop };
const storageState = new Map<string, string>();

vi.mock('folds', () => ({
  Icon: ({ src }: { src: string }) => React.createElement('span', { 'data-icon-src': src }),
  Icons: {
    ChevronLeft: 'chevron-left',
    ChevronRight: 'chevron-right',
  },
}));

vi.mock('../../hooks/useScreenSize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useScreenSize')>();
  return {
    ...actual,
    useScreenSizeContext: () => screenSizeState.value,
  };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));

vi.mock('../../components/sidebar', () => ({
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

vi.mock('../../components/page', () => ({
  PageRoot: ({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) =>
    React.createElement('section', { 'data-testid': 'page-root' }, nav, children),
}));

vi.mock('../../pages/MobileFriendly', () => ({
  MobileFriendlyClientNav: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../pages/client/SidebarNav', () => ({
  SidebarNav: ({ footer }: { footer?: React.ReactNode }) =>
    React.createElement('nav', { 'data-testid': 'sidebar-rail' }, footer),
}));

type Renderer = ReturnType<typeof create>;

const renderNavigation = (): Renderer => {
  let renderer: Renderer;
  act(() => {
    renderer = create(
      <MindroomNavigationProvider>
        <MindroomSidebarNav />
        <MindroomPageRoot nav={<aside data-testid="page-nav" />}>
          <main data-testid="page-content" />
        </MindroomPageRoot>
      </MindroomNavigationProvider>
    );
  });
  return renderer!;
};

const findButtons = (renderer: Renderer, label: string) =>
  renderer.root.findAllByType('button').filter((button) => button.props['aria-label'] === label);

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
    screenSizeState.value = ScreenSize.Desktop;
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

  afterEach(() => {
    vi.unstubAllGlobals();
    storageState.clear();
  });

  it('persists desktop page navigation collapse while keeping the icon rail visible', () => {
    let renderer = renderNavigation();

    expectNavigationState(renderer, false);

    act(() => findButtons(renderer, COLLAPSE_LABEL)[0].props.onClick());

    expectNavigationState(renderer, true);
    expect(localStorage.getItem(storageKey)).toBe('true');

    act(() => renderer.unmount());
    renderer = renderNavigation();

    expectNavigationState(renderer, true);

    act(() => findButtons(renderer, EXPAND_LABEL)[0].props.onClick());

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

  it.each([ScreenSize.Tablet, ScreenSize.Mobile])(
    'keeps %s navigation visible without desktop controls',
    (screenSize) => {
      screenSizeState.value = screenSize;
      localStorage.setItem(storageKey, 'true');

      const renderer = renderNavigation();

      expectNavigationWithoutToggle(renderer);

      act(() => renderer.unmount());
    }
  );
});
