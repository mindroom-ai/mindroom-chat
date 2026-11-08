// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  MemoryRouter,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
} from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import type { RegisteredPlugin } from './registry';
import {
  PluginPageRoute,
  pluginRoutePath,
  usePluginPage,
  usePluginRouteHref,
  type PluginPage,
  type PluginPageProps,
} from './pluginPages';

const registry = vi.hoisted((): RegisteredPlugin[] => []);
vi.mock('./registry', () => ({ registeredPlugins: registry }));

const page = (path: string): PluginPage => ({ path, Component: () => null });

const plugin = (id: string, ...pages: PluginPage[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  conversationCovers: [],
  messageRenderers: [],
  pages,
  roomHeaderSlot: [],
  sidePanels: [],
  headerActions: [],
});

/** A config.json with this `plugins` section. */
const withPlugins = (plugins: unknown): ClientConfig => ({ plugins } as unknown as ClientConfig);

/** The app at `url` with `config`, around the plugin code under test. */
const at =
  (url: string, config: ClientConfig = {}) =>
  ({ children }: { children: ReactNode }) =>
    (
      <ClientConfigProvider value={config}>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </ClientConfigProvider>
    );

/** The plugin page the hook finds at `url` with `config`. */
const pageAt = (url: string, config: ClientConfig = {}) =>
  renderHook(() => usePluginPage(), { wrapper: at(url, config) }).result.current;

afterEach(() => {
  cleanup();
  registry.splice(0);
  window.history.replaceState(null, '', '/');
});

describe('pluginRoutePath', () => {
  it("is a path under the plugin's own root", () => {
    expect(pluginRoutePath('example')).toBe('/p/example');
    expect(pluginRoutePath('example', 'items/42')).toBe('/p/example/items/42');
  });
});

describe('usePluginRouteHref', () => {
  function BoardLink() {
    return <a href={usePluginRouteHref('example', 'board')}>Board</a>;
  }
  const hrefWith = (createRouter: typeof createBrowserRouter, basename: string) => {
    const router = createRouter([{ path: '*', element: <BoardLink /> }], { basename });
    render(<RouterProvider router={router} />);
    const href = screen.getByRole('link', { name: 'Board' }).getAttribute('href');
    cleanup();
    router.dispose();
    return href;
  };

  it("adds the browser router's base path", () => {
    window.history.replaceState(null, '', '/chat/home/');
    expect(hrefWith(createBrowserRouter, '/chat')).toBe('/chat/p/example/board');
  });

  it('puts the path after the hash with the hash router', () => {
    expect(hrefWith(createHashRouter, '/')).toBe('#/p/example/board');
  });
});

describe('usePluginPage', () => {
  it("finds the page of the address's plugin, with the params of its path", () => {
    const home = page('');
    const item = page('items/:itemId');
    registry.push(plugin('other', page('items/:itemId')), plugin('example', home, item));
    expect(pageAt('/p/example/')).toEqual({ page: home, params: {} });
    expect(pageAt('/p/example')).toEqual({ page: home, params: {} });
    expect(pageAt('/p/example/items/a%20b/')).toEqual({ page: item, params: { itemId: 'a b' } });
    expect(pageAt('/p/example/items/a%2Fb')).toEqual({ page: item, params: { itemId: 'a/b' } });
    expect(pageAt('/p/example/items/100%2525')).toEqual({
      page: item,
      params: { itemId: '100%25' },
    });
  });

  it('matches page paths as React Router matches routes: ranked, optional segments included', () => {
    const files = page('files/*');
    const report = page('reports/view?/:reportId');
    const newReport = page('reports/new');
    registry.push(plugin('example', files, report, newReport));
    // A fixed segment outranks a parameter, wherever the plugin lists the page.
    expect(pageAt('/p/example/reports/new')).toEqual({ page: newReport, params: {} });
    expect(pageAt('/p/example/files/a/b.txt')).toEqual({ page: files, params: { '*': 'a/b.txt' } });
    expect(pageAt('/p/example/reports/7')).toEqual({ page: report, params: { reportId: '7' } });
    expect(pageAt('/p/example/reports/view/7')).toEqual({
      page: report,
      params: { reportId: '7' },
    });
  });

  it('finds none for an unknown plugin or path, or outside the plugin root', () => {
    registry.push(plugin('example', page(''), page('items/:itemId')));
    expect(pageAt('/p/missing/')).toBeUndefined();
    expect(pageAt('/p/example/other')).toBeUndefined();
    expect(pageAt('/p/example/items/1/more')).toBeUndefined();
    expect(pageAt('/home/')).toBeUndefined();
  });

  it('finds none for a plugin that config.json turns off', () => {
    registry.push(plugin('example', page('')));
    expect(pageAt('/p/example/', withPlugins({ example: { enabled: false } }))).toBeUndefined();
    expect(pageAt('/p/example/', withPlugins({ example: { enabled: true } }))).toBeDefined();
  });
});

describe('PluginPageRoute', () => {
  const Item = ({ params }: PluginPageProps) => <p>Item {params.itemId}</p>;

  it("renders the address's page with the params of its path", () => {
    registry.push(plugin('example', { path: 'items/:itemId', Component: Item }));
    render(<PluginPageRoute />, { wrapper: at('/p/example/items/42') });
    expect(screen.getByText('Item 42')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  // usePluginPage's tests cover each address that finds no page.
  it('says "Page not found" where no page is found', () => {
    registry.push(plugin('example', { path: 'items/:itemId', Component: Item }));
    render(<PluginPageRoute />, { wrapper: at('/p/example/other') });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.queryByText(/^Item/)).toBeNull();
  });
});
