// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { type Settings, settingsAtom } from '../preferences/settings';
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
let rowWidth = 0;
let resized: (() => void) | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  resized = undefined;
  // The settings live in localStorage, which outlasts each test's store.
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The room row of a tablet window 900 px wide; the members were left open. */
const renderRow = (width: number, settings: Partial<Settings> = {}) => {
  rowWidth = width;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function width(
    this: HTMLElement
  ) {
    return this === document.body ? 900 : rowWidth;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  const store = createStore();
  store.set(settingsAtom, { ...store.get(settingsAtom), isPeopleDrawer: true, ...settings });
  host = document.createElement('div');
  document.body.append(host);
  const mount = () =>
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
  mount();
  const button = () => host!.querySelector('button')!;
  return {
    store,
    open: () => button().getAttribute('aria-pressed'),
    click: () => act(() => button().click()),
    resize: (next: number) => {
      rowWidth = next;
      act(() => resized?.());
    },
    remount: () => {
      act(() => root?.unmount());
      mount();
    },
  };
};

describe('PanelRow', () => {
  it('keeps the members beside a row with room to read the conversation beside them', () => {
    const row = renderRow(1034);
    expect(row.open()).toBe('true');
    row.click();
    expect(row.store.get(settingsAtom).isPeopleDrawer).toBe(false);
    expect(row.store.get(settingsAtom).membersBesideNarrowRoom).toBe(false);
  });

  it('starts them closed beside a row too narrow to read beside them, and keeps them opened there', () => {
    const row = renderRow(1033);
    expect(row.open()).toBe('false');
    row.click();
    expect(row.open()).toBe('true');
    expect(row.store.get(settingsAtom).membersBesideNarrowRoom).toBe(true);
    row.remount();
    expect(row.open()).toBe('true');
    // Closed there, they are closed everywhere, as before.
    row.click();
    expect(row.store.get(settingsAtom)).toMatchObject({
      isPeopleDrawer: false,
      membersBesideNarrowRoom: false,
    });
    row.remount();
    expect(row.open()).toBe('false');
  });

  it('never closes members already shown as the row narrows, and shows them once it widens', () => {
    const wide = renderRow(1118);
    wide.resize(958);
    expect(wide.open()).toBe('true');
    wide.remount();
    expect(wide.open()).toBe('false');
    wide.resize(1118);
    expect(wide.open()).toBe('true');
    wide.resize(958);
    expect(wide.open()).toBe('true');
  });

  it('forgets an opening beside a narrow row once they are closed beside a wide one', () => {
    const row = renderRow(958);
    row.click();
    row.resize(1118);
    row.click();
    expect(row.store.get(settingsAtom).membersBesideNarrowRoom).toBe(false);
    row.click();
    expect(row.open()).toBe('true');
    row.resize(958);
    row.remount();
    expect(row.open()).toBe('false');
  });

  it('remembers them shown again beside a row that narrowed while they were open', () => {
    const row = renderRow(1118);
    row.resize(958);
    row.click();
    expect(row.open()).toBe('false');
    row.click();
    expect(row.open()).toBe('true');
    row.remount();
    expect(row.open()).toBe('true');
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
