// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createBrowserRouter, createHashRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { pluginRoutePath, usePluginRouteHref } from './pluginPages';

afterEach(() => {
  cleanup();
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
