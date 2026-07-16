import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize } from '../../hooks/useScreenSize';
import { getDesktopSidebarHiddenStorageKey } from './desktopSidebarState';
import { MindroomSidebarNav } from './MindroomSidebarNav';

const screenSizeState = { value: ScreenSize.Desktop };
const activeSessionState: { value: { userId: string } | undefined } = {
  value: { userId: '@alice:example.org' },
};
const storageState = new Map<string, string>();

vi.mock('folds', () => ({
  Icon: () => React.createElement('span'),
  IconButton: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ children, ...props }, ref) => React.createElement('button', { ...props, ref }, children)
  ),
  Icons: {
    ChevronLeft: 'chevron-left',
    ChevronRight: 'chevron-right',
  },
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
  TooltipProvider: ({
    children,
  }: {
    children: (ref: React.RefCallback<HTMLButtonElement>) => React.ReactNode;
  }) =>
    React.createElement(
      React.Fragment,
      null,
      children(() => undefined)
    ),
  config: {
    zIndex: { Z100: 100 },
  },
}));

vi.mock('../../hooks/useScreenSize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useScreenSize')>();
  return {
    ...actual,
    useScreenSizeContext: () => screenSizeState.value,
  };
});

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: () => activeSessionState.value,
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
  }: {
    children: (ref: React.RefCallback<HTMLButtonElement>) => React.ReactNode;
  }) =>
    React.createElement(
      React.Fragment,
      null,
      children(() => undefined)
    ),
}));

vi.mock('../../pages/MobileFriendly', () => ({
  MobileFriendlyClientNav: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../pages/client/SidebarNav', () => ({
  SidebarNav: ({ footer }: { footer?: React.ReactNode }) =>
    React.createElement('nav', { 'data-testid': 'sidebar' }, footer),
}));

describe('MindroomSidebarNav', () => {
  const storageKey = getDesktopSidebarHiddenStorageKey('@alice:example.org');

  const renderSidebar = () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(MindroomSidebarNav));
    });
    return renderer!;
  };

  const findButtons = (renderer: ReturnType<typeof create>, label: string) =>
    renderer.root.findAllByType('button').filter((button) => button.props['aria-label'] === label);

  beforeEach(() => {
    screenSizeState.value = ScreenSize.Desktop;
    activeSessionState.value = { userId: '@alice:example.org' };
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

  it('hides the desktop sidebar, reclaims its layout slot, and remembers the choice', () => {
    let renderer = renderSidebar();

    expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar' })).toHaveLength(1);

    act(() => {
      findButtons(renderer, 'Hide sidebar')[0].props.onClick();
    });

    expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar' })).toHaveLength(0);
    expect(findButtons(renderer, 'Show sidebar')).toHaveLength(1);
    expect(findButtons(renderer, 'Show sidebar')[0].props.style.position).toBe('fixed');
    expect(localStorage.getItem(storageKey)).toBe('true');

    act(() => renderer.unmount());
    renderer = renderSidebar();

    expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar' })).toHaveLength(0);

    act(() => {
      findButtons(renderer, 'Show sidebar')[0].props.onClick();
    });

    expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar' })).toHaveLength(1);
    expect(localStorage.getItem(storageKey)).toBe('false');

    act(() => renderer.unmount());
  });

  it('ignores malformed persisted hidden values', () => {
    localStorage.setItem(storageKey, JSON.stringify('true'));

    const renderer = renderSidebar();

    expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar' })).toHaveLength(1);
    expect(findButtons(renderer, 'Hide sidebar')).toHaveLength(1);

    act(() => renderer.unmount());
  });

  it('keeps navigation visible without writing a shared fallback key before session restore', () => {
    activeSessionState.value = undefined;

    const renderer = renderSidebar();

    expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar' })).toHaveLength(1);
    expect(findButtons(renderer, 'Hide sidebar')).toHaveLength(0);
    expect(findButtons(renderer, 'Show sidebar')).toHaveLength(0);
    expect(storageState.size).toBe(0);

    act(() => renderer.unmount());
  });

  it.each([ScreenSize.Tablet, ScreenSize.Mobile])(
    'keeps %s navigation visible without desktop controls',
    (screenSize) => {
      screenSizeState.value = screenSize;
      localStorage.setItem(storageKey, 'true');

      const renderer = renderSidebar();

      expect(renderer.root.findAllByProps({ 'data-testid': 'sidebar' })).toHaveLength(1);
      expect(findButtons(renderer, 'Hide sidebar')).toHaveLength(0);
      expect(findButtons(renderer, 'Show sidebar')).toHaveLength(0);

      act(() => renderer.unmount());
    }
  );
});
