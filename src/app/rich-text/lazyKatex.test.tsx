import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// A loaded machine can take seconds to load a lazy module's code.
const LOAD_WAIT = { timeout: 60_000, interval: 20 };
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// The test setup loads KaTeX for every test file; fresh modules start without it, as the app does.
beforeEach(() => {
  vi.resetModules();
});

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.doUnmock('katex');
});

it('shows the TeX source until KaTeX has loaded, which rendering math starts, then typesets it', async () => {
  const { WithKatex, isKatexLoaded } = await import('./lazyKatex');
  const { renderLatexToHtml } = await import('./math');
  expect(isKatexLoaded()).toBe(false);

  act(() => {
    renderer = create(<WithKatex render={() => renderLatexToHtml('x^2', false)} />);
  });
  expect(renderer!.toJSON()).toBe('x^2');

  await act(async () => {
    await vi.waitFor(() => expect(isKatexLoaded()).toBe(true), LOAD_WAIT);
  });
  expect(renderer!.toJSON()).toContain('class="katex"');
});

it('loads KaTeX again after a failed load', async () => {
  vi.doMock('katex', () => {
    throw new Error('offline');
  });
  const { loadKatex, isKatexLoaded } = await import('./lazyKatex');
  await expect(loadKatex()).rejects.toThrow();
  expect(isKatexLoaded()).toBe(false);

  vi.doUnmock('katex');
  await expect(loadKatex()).resolves.toHaveProperty('renderToString');
  expect(isKatexLoaded()).toBe(true);
});
