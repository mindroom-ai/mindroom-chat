// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { settingsAtom } from '../preferences/settings';
import { PanelRow } from './PanelRow';
import { useMembersDrawer } from './useMembersDrawer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@alice:example.org' }),
}));

function Toggle() {
  const [open, setOpen] = useMembersDrawer();
  return <button type="button" aria-pressed={open} onClick={() => setOpen(!open)} />;
}

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  vi.restoreAllMocks();
});

/** A tablet window 900 px wide whose room row is `rowWidth` wide; the members were left open. */
const renderRow = (rowWidth: number) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function width(
    this: HTMLElement
  ) {
    return this === document.body ? 900 : rowWidth;
  });
  const store = createStore();
  store.set(settingsAtom, { ...store.get(settingsAtom), isPeopleDrawer: true });
  host = document.createElement('div');
  document.body.append(host);
  act(() => {
    root = createRoot(host!);
    root.render(
      <Provider store={store}>
        <ScreenSizeProvider value={ScreenSize.Tablet}>
          <PanelRow>
            <Toggle />
          </PanelRow>
        </ScreenSizeProvider>
      </Provider>
    );
  });
  const button = () => host!.querySelector('button')!;
  return {
    store,
    open: () => button().getAttribute('aria-pressed'),
    click: () => act(() => button().click()),
  };
};

describe('PanelRow', () => {
  it('keeps the members beside a row with room for them and the conversation', () => {
    const row = renderRow(626);
    expect(row.open()).toBe('true');
    row.click();
    expect(row.store.get(settingsAtom).isPeopleDrawer).toBe(false);
  });

  it('opens them over a narrower row only when asked, leaving the saved choice alone', () => {
    const row = renderRow(625);
    expect(row.open()).toBe('false');
    row.click();
    expect(row.open()).toBe('true');
    row.click();
    expect(row.open()).toBe('false');
    expect(row.store.get(settingsAtom).isPeopleDrawer).toBe(true);
  });
});
