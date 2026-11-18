import React, { useState } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageViewerOpenAtom } from '../../navigation/imageViewerState';
import { ImageOverlay } from './ImageOverlay';

const IMAGE_VIEWER_HISTORY_MARKER = '__mindroomImageViewer';

const saveFile = vi.hoisted(() =>
  vi.fn<(source: Blob | string, fileName: string) => Promise<boolean>>(async () => true)
);

const passThrough = vi.hoisted(
  () =>
    ({ children }: { children?: React.ReactNode }) =>
      children
);

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  return {
    ...actual,
    Box: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    Icon: () => null,
    Overlay: passThrough,
    OverlayBackdrop: () => null,
    OverlayCenter: passThrough,
    Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});
vi.mock('focus-trap-react', () => ({ default: passThrough }));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  Header: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Modal: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));
vi.mock('./viewerFrame', () => ({
  useViewerFrame: () => ({}),
  viewerTrapOptions: () => ({}),
}));
vi.mock('../../matrix/matrix', () => ({ downloadMedia: async () => new Blob(['picture']) }));
vi.mock('../../native/nativeFileSave', () => ({ saveFile }));

type Listener = (event: Event) => void;

class MockEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;
    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener as Listener);
  }

  dispatch(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

type MockWindow = MockEventTarget & {
  history: History & {
    back: ReturnType<typeof vi.fn>;
    pushState: ReturnType<typeof vi.fn>;
    replaceState: ReturnType<typeof vi.fn>;
  };
  historyIndex: number;
  emitPageHide: () => void;
  emitPopState: () => void;
};

const createMockWindow = (): MockWindow => {
  const eventTarget = new MockEventTarget();
  const stack: unknown[] = [{ route: 'room' }];
  let index = 0;

  const history = {
    pushState: vi.fn((state: unknown) => {
      stack.splice(index + 1);
      stack.push(state);
      index = stack.length - 1;
    }),
    replaceState: vi.fn((state: unknown) => {
      stack[index] = state;
    }),
    back: vi.fn(() => {
      if (index === 0) return;
      index -= 1;
    }),
  } as MockWindow['history'];

  Object.defineProperty(history, 'state', {
    configurable: true,
    get: () => stack[index] ?? null,
  });

  const mockWindow = Object.assign(eventTarget, {
    history,
    emitPageHide: () => eventTarget.dispatch('pagehide', { type: 'pagehide' } as Event),
    emitPopState: () => {
      if (index > 0) index -= 1;
      eventTarget.dispatch('popstate', { type: 'popstate' } as Event);
    },
  });
  Object.defineProperty(mockWindow, 'historyIndex', { configurable: true, get: () => index });
  return mockWindow as MockWindow;
};

const originalWindow = globalThis.window;
let mockWindow: MockWindow;

beforeEach(() => {
  mockWindow = createMockWindow();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

// A link preview's picture is named after the page's title, which the page chose.
const TITLE = 'Quarterly report\u202efdp.exe';
const TITLE_SHOWN = 'Quarterly report<U+202E>fdp.exe';

it('names the picture viewer with the direction controls of its name as code points, and saves the file under the name as it is', async () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ImageOverlay src="https://media.example/picture" alt={TITLE} requestClose={vi.fn()} />
    );
  });

  const dialog = renderer.root.find((node) => node.props.role === 'dialog');
  expect(dialog.props['aria-label']).toBe(TITLE_SHOWN);
  expect(renderer.root.findByType('img').props.alt).toBe(TITLE_SHOWN);
  expect(renderer.root.findByType('header').findAllByType('span')[0]?.props.children).toBe(
    TITLE_SHOWN
  );

  const download = renderer.root
    .findAll((node) => node.type === 'button' && node.props['aria-label'] === undefined)
    .at(-1);
  await act(async () => {
    download?.props.onClick();
    await Promise.resolve();
  });
  expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), TITLE);
  act(() => renderer.unmount());
});

/** A picture that opens the viewer on its button, as an inline image or a link preview does. */
function Opener({ strict = false }: { strict?: boolean }) {
  const [open, setOpen] = useState(strict);
  return (
    <>
      <button type="button" data-role="open" onClick={() => setOpen(true)} />
      {open && (
        <ImageOverlay src="blob:picture" alt="picture.png" requestClose={() => setOpen(false)} />
      )}
    </>
  );
}

describe('ImageOverlay history', () => {
  let renderer: ReactTestRenderer | undefined;

  const mount = ({ strict = false } = {}) => {
    const store = createStore();
    const element = (
      <Provider store={store}>
        <Opener strict={strict} />
      </Provider>
    );
    act(() => {
      renderer = create(strict ? <React.StrictMode>{element}</React.StrictMode> : element);
    });
    return { tree: renderer!, store };
  };
  const open = (tree: ReactTestRenderer) =>
    act(() => {
      tree.root.findByProps({ 'data-role': 'open' }).props.onClick();
    });
  const close = (tree: ReactTestRenderer) =>
    act(() => {
      tree.root.findByProps({ 'aria-label': 'Close' }).props.onClick();
    });
  const dialogs = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => node.props.role === 'dialog');

  afterEach(() => {
    if (renderer)
      act(() => {
        renderer?.unmount();
      });
    renderer = undefined;
  });

  it('pushes one marked history entry when it opens, and tells the edge swipes', () => {
    const { tree, store } = mount();
    open(tree);

    expect(store.get(imageViewerOpenAtom)).toBe(true);
    expect(mockWindow.history.pushState).toHaveBeenCalledOnce();
    expect(mockWindow.history.state).toEqual({
      route: 'room',
      [IMAGE_VIEWER_HISTORY_MARKER]: true,
    });
    expect(mockWindow.historyIndex).toBe(1);
  });

  it('keeps its one entry when the page re-renders it', () => {
    const { tree, store } = mount();
    open(tree);
    act(() => {
      tree.update(
        <Provider store={store}>
          <Opener />
        </Provider>
      );
    });
    expect(mockWindow.history.pushState).toHaveBeenCalledOnce();
    expect(mockWindow.history.back).not.toHaveBeenCalled();
  });

  it('consumes its history entry when it closes from its back button', () => {
    const { tree, store } = mount();
    open(tree);
    close(tree);

    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(mockWindow.history.back).toHaveBeenCalledOnce();
    expect(mockWindow.historyIndex).toBe(0);
    expect(dialogs(tree)).toHaveLength(0);
  });

  it('closes on Back without a second history.back call', () => {
    const { tree, store } = mount();
    open(tree);
    act(() => {
      mockWindow.emitPopState();
    });

    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(mockWindow.history.back).not.toHaveBeenCalled();
    expect(mockWindow.historyIndex).toBe(0);
    expect(dialogs(tree)).toHaveLength(0);
  });

  it('pushes a fresh entry when it opens again after closing', () => {
    const { tree, store } = mount();
    open(tree);
    close(tree);
    open(tree);

    expect(store.get(imageViewerOpenAtom)).toBe(true);
    expect(mockWindow.history.pushState).toHaveBeenCalledTimes(2);
    expect(mockWindow.history.back).toHaveBeenCalledOnce();
    expect(mockWindow.history.state).toEqual({
      route: 'room',
      [IMAGE_VIEWER_HISTORY_MARKER]: true,
    });
    expect(mockWindow.historyIndex).toBe(1);
  });

  it('strips the marker on pagehide, so a reload does not come back to a stale viewer entry', () => {
    const { tree, store } = mount();
    open(tree);
    act(() => {
      mockWindow.emitPageHide();
      tree.unmount();
    });
    renderer = undefined;

    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(mockWindow.history.replaceState).toHaveBeenCalledOnce();
    expect(mockWindow.history.back).not.toHaveBeenCalled();
    expect(mockWindow.history.state).toEqual({ route: 'room' });
  });

  it('keeps strict-mode cleanup history-balanced', () => {
    const { store } = mount({ strict: true });
    expect(store.get(imageViewerOpenAtom)).toBe(true);
    const pushCount = mockWindow.history.pushState.mock.calls.length;
    expect(pushCount).toBeGreaterThanOrEqual(1);
    expect(mockWindow.historyIndex).toBe(1);

    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;

    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(mockWindow.history.back).toHaveBeenCalledTimes(pushCount);
    expect(mockWindow.historyIndex).toBe(0);
  });
});
