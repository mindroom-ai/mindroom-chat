import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../hooks/useScreenSize';
import { ResizablePageNav } from './ResizablePageNav';

vi.mock('./ResizablePageNav.css', () => ({ Panel: 'panel', Handle: 'handle' }));
vi.mock('../../components/page', () => ({
  PageNav: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@alice:example.org' }),
}));

const storageKey = 'mindroom.pageNav.width:@alice:example.org';
const storage = new Map<string, string>();
let availableWidth = 1000;
let direction = 'ltr';
let resizeObserver: () => void;
const capture = new Set<number>();
const pointerTarget = {
  setPointerCapture: (id: number) => capture.add(id),
  hasPointerCapture: (id: number) => capture.has(id),
  releasePointerCapture: (id: number) => capture.delete(id),
};
const pointer = (x: number, pointerType = 'mouse', pointerId = 1) => ({
  button: 0,
  isPrimary: true,
  pointerId,
  pointerType,
  clientX: x,
  currentTarget: pointerTarget,
  preventDefault: vi.fn(),
});

const renderPanel = (screenSize = ScreenSize.Desktop) => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <ScreenSizeProvider value={screenSize}>
        <ResizablePageNav>
          <span>Room list</span>
        </ResizablePageNav>
      </ScreenSizeProvider>,
      {
        createNodeMock: () => ({
          parentElement: {
            get clientWidth() {
              return availableWidth;
            },
          },
        }),
      }
    );
  });
  const handle = () => renderer!.root.findByProps({ role: 'separator' });
  const width = () =>
    renderer!.root.findByProps({ 'data-testid': 'resizable-page-nav' }).props.style.width;
  return { renderer: renderer!, handle, width };
};

beforeEach(() => {
  storage.clear();
  capture.clear();
  availableWidth = 1000;
  direction = 'ltr';
  vi.stubGlobal('getComputedStyle', () => ({ direction }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeObserver = callback;
      }

      observe() {}

      disconnect() {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('ResizablePageNav', () => {
  it('expands toward the content in right-to-left layouts', () => {
    direction = 'rtl';
    const { renderer, handle, width } = renderPanel();
    act(() => handle().props.onPointerDown(pointer(800)));
    act(() => handle().props.onPointerMove(pointer(700)));
    act(() => handle().props.onPointerUp(pointer(700)));
    expect(width()).toBe(356);
    act(() => handle().props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() }));
    expect(width()).toBe(376);
    act(() => renderer.unmount());
  });
  it.each(['mouse', 'touch', 'pen'])('resizes with %s and saves only on release', (pointerType) => {
    const { renderer, handle, width } = renderPanel();
    expect(width()).toBe(256);
    act(() => handle().props.onPointerDown(pointer(256, pointerType)));
    act(() => handle().props.onPointerMove(pointer(356, pointerType)));
    expect(width()).toBe(356);
    expect(storage.has(storageKey)).toBe(false);
    act(() => handle().props.onPointerUp(pointer(356, pointerType)));
    expect(storage.get(storageKey)).toBe('356');
    expect(capture.size).toBe(0);
    act(() => renderer.unmount());
    const restored = renderPanel();
    expect(restored.width()).toBe(356);
    act(() => restored.renderer.unmount());
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'])(
    'discards an interrupted drag on %s',
    (event) => {
      const { renderer, handle, width } = renderPanel();
      act(() => handle().props.onPointerDown(pointer(256)));
      act(() => handle().props.onPointerMove(pointer(400)));
      act(() => handle().props[event](pointer(400)));
      expect(width()).toBe(256);
      expect(storage.has(storageKey)).toBe(false);
      act(() => renderer.unmount());
    }
  );

  it('ignores secondary pointers and right-button drags', () => {
    const { renderer, handle, width } = renderPanel();
    act(() => handle().props.onPointerDown({ ...pointer(256), button: 2 }));
    act(() => handle().props.onPointerMove(pointer(400)));
    expect(width()).toBe(256);
    act(() => handle().props.onPointerDown(pointer(256)));
    act(() => handle().props.onPointerDown({ ...pointer(256, 'touch', 2), isPrimary: false }));
    act(() => handle().props.onPointerMove(pointer(400, 'touch', 2)));
    act(() => handle().props.onPointerUp(pointer(400, 'touch', 2)));
    expect(width()).toBe(256);
    expect(capture.has(1)).toBe(true);
    act(() => handle().props.onPointerMove(pointer(300)));
    act(() => handle().props.onPointerUp(pointer(300)));
    expect(width()).toBe(300);
    act(() => renderer.unmount());
  });

  it('clamps to available space without overwriting the saved width on viewport changes', () => {
    storage.set(storageKey, '500');
    const { renderer, width } = renderPanel();
    expect(width()).toBe(500);
    availableWidth = 700;
    act(() => resizeObserver());
    expect(width()).toBe(380);
    expect(storage.get(storageKey)).toBe('500');
    availableWidth = 1000;
    act(() => resizeObserver());
    expect(width()).toBe(500);
    act(() => renderer.unmount());
  });

  it.each([undefined, '220', '600'])(
    'has no resize handle on phones with saved width %s',
    (saved) => {
      availableWidth = 309;
      if (saved) storage.set(storageKey, saved);
      const { renderer } = renderPanel(ScreenSize.Mobile);
      expect(renderer.root.findAllByProps({ role: 'separator' })).toHaveLength(0);
      expect(storage.get(storageKey)).toBe(saved);
      act(() => renderer.unmount());
    }
  );

  it('discards a drag when switching to mobile and restores the saved split-layout width', () => {
    storage.set(storageKey, '300');
    const { renderer, handle, width } = renderPanel(ScreenSize.Tablet);
    act(() => handle().props.onPointerDown(pointer(300)));
    act(() => handle().props.onPointerMove(pointer(400)));
    expect(width()).toBe(400);
    const changeScreen = (screenSize: ScreenSize) =>
      act(() => {
        renderer.update(
          <ScreenSizeProvider value={screenSize}>
            <ResizablePageNav>
              <span>Room list</span>
            </ResizablePageNav>
          </ScreenSizeProvider>
        );
      });
    changeScreen(ScreenSize.Mobile);
    expect(renderer.root.findAllByProps({ role: 'separator' })).toHaveLength(0);
    expect(storage.get(storageKey)).toBe('300');
    changeScreen(ScreenSize.Tablet);
    expect(width()).toBe(300);
    act(() => handle().props.onPointerDown(pointer(300)));
    act(() => handle().props.onPointerMove(pointer(320)));
    act(() => handle().props.onPointerUp(pointer(320)));
    expect(width()).toBe(320);
    expect(storage.get(storageKey)).toBe('320');
    act(() => renderer.unmount());
  });

  it('supports bounded keyboard resizing and reset', () => {
    const { renderer, handle, width } = renderPanel();
    const key = (value: string) =>
      act(() => handle().props.onKeyDown({ key: value, preventDefault: vi.fn() }));
    key('ArrowRight');
    expect(width()).toBe(276);
    key('Home');
    expect(width()).toBe(200);
    key('End');
    expect(width()).toBe(600);
    expect(handle().props['aria-valuenow']).toBe(600);
    key('ArrowLeft');
    expect(width()).toBe(580);
    key('Enter');
    expect(width()).toBe(256);
    expect(storage.get(storageKey)).toBe('256');
    act(() => renderer.unmount());
  });

  it.each(['"wide"', 'null', '-10', '100000', '{broken'])(
    'handles malformed or out-of-range saved widths: %s',
    (value) => {
      storage.set(storageKey, value);
      const { renderer, width } = renderPanel();
      expect(width()).toBeGreaterThanOrEqual(200);
      expect(width()).toBeLessThanOrEqual(600);
      act(() => renderer.unmount());
    }
  );
});
