// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageTab } from './UsageTab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  available: false,
  hasLowQuota: false,
}));

vi.mock('../../usage/useProviderUsage', () => ({
  useProviderUsage: () => ({
    status: state.available ? 'ready' : 'idle',
    available: state.available,
    hasLowQuota: state.hasLowQuota,
    loading: false,
    refreshing: false,
    runtimes: [],
    selectedRuntimeId: undefined,
    snapshot: undefined,
    selectRuntime: vi.fn(),
    ensureLoaded: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('../../ui/sidebar/SidebarItem', () => ({
  SidebarItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarItemTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) => (
    <>{children(() => undefined)}</>
  ),
  SidebarAvatar: React.forwardRef<
    HTMLElement,
    { as?: string; outlined?: boolean } & Record<string, unknown>
  >(({ as, outlined: _outlined, ...props }, ref) =>
    React.createElement(as ?? 'div', { ...props, ref })
  ),
  SidebarItemBadge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

function LocationEcho() {
  const location = useLocation();
  return <span data-location={location.pathname} />;
}

let container: HTMLDivElement;
let root: Root;

const render = (path = '/home/') => {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <UsageTab />
        <LocationEcho />
      </MemoryRouter>
    );
  });
};

describe('UsageTab', () => {
  beforeEach(() => {
    state.available = false;
    state.hasLowQuota = false;
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it('stays hidden until a runtime reports usage, then reveals and navigates to /usage/', () => {
    render();
    expect(container.querySelector('button')).toBeNull();

    state.available = true;
    render();
    const button = container.querySelector('button[aria-label="Usage"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(container.querySelector('[data-usage-low-quota="true"]')).toBeNull();

    act(() => button.click());
    expect(container.querySelector('[data-location]')?.getAttribute('data-location')).toBe(
      '/usage/'
    );
  });

  it('shows the subtle amber badge dot only when hasLowQuota is true', () => {
    state.available = true;
    state.hasLowQuota = true;
    render();

    expect(container.querySelector('button[aria-label="Usage (low quota)"]')).not.toBeNull();
    expect(container.querySelector('[data-usage-low-quota="true"]')).not.toBeNull();
  });

  it('stays visible while /usage/ is open even when unavailable', () => {
    render('/usage/');
    expect(container.querySelector('button[aria-label="Usage"]')).not.toBeNull();
  });
});
