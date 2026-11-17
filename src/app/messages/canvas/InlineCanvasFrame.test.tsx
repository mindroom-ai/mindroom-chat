// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { makeUiEvent, makeUiRoom } from '../../ui-actions/testUtils';
import { InlineCanvasFrame, inlineCanvasScale } from './InlineCanvasFrame';
import { canvasFrameWindow, CANVAS_WRAPPER_SANDBOX } from './canvasDocument';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const download = vi.hoisted(() => vi.fn());
vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: download,
}));
const windows = vi.hoisted(() => new WeakMap<object, Window>());
vi.mock('./canvasDocument', async (original) => ({
  ...(await original<typeof import('./canvasDocument')>()),
  canvasFrameWindow: (frame: HTMLIFrameElement | null) => {
    if (!frame) return undefined;
    if (!windows.has(frame)) windows.set(frame, {} as Window);
    return windows.get(frame);
  },
}));
vi.mock('../../theme/useTheme', () => ({
  ThemeKind: { Dark: 'dark' },
  useTheme: () => ({ kind: 'light', id: 'light' }),
}));

let root: Root;
let container: HTMLDivElement;
let fixture: ReturnType<typeof makeUiRoom>;
const canvas = { title: 'A mockup', html: '<p>Preview</p>' };
const event = () => makeUiEvent({ action: 'show_canvas', inline: true, canvas });
const render = (request = event(), enabled = true, remoteAssets = false) =>
  act(() =>
    root.render(
      <MatrixClientProvider value={fixture.mx}>
        <ClientConfigProvider value={{ mindroom: { canvas: { enabled, remoteAssets } } }}>
          <InlineCanvasFrame event={request} />
        </ClientConfigProvider>
      </MatrixClientProvider>
    )
  );
const frame = () => container.querySelector('iframe')!;
const post = (data: unknown, source = canvasFrameWindow(frame()), origin = 'null') =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source, origin }));
  });
beforeEach(() => {
  fixture = makeUiRoom();
  vi.spyOn(fixture.mx, 'getRoom').mockReturnValue(fixture.room);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('InlineCanvasFrame', () => {
  it('starts at 160 pixels in the existing opaque sandbox with no saved state', () => {
    render();
    expect(frame().title).toBe(canvas.title);
    expect(frame().getAttribute('sandbox')).toBe(CANVAS_WRAPPER_SANDBOX);
    expect(frame().style.height).toBe('160px');
    expect(frame().srcdoc).toContain('state: undefined');
    expect(frame().srcdoc).toContain('padding:8px;background:transparent');
  });
  it('fits only its own opaque page and clamps the height', () => {
    render();
    for (const [height, expected] of [
      [412.3, 413],
      [10, 80],
      [50000, 20000],
    ]) {
      post({ type: 'mindroom.canvas.size', version: 1, height });
      expect(frame().style.height).toBe(`${expected}px`);
    }
    post({ type: 'mindroom.canvas.size', version: 1, height: 100 }, {} as Window);
    post(
      { type: 'mindroom.canvas.size', version: 1, height: 100 },
      windows.get(frame()),
      'https://example.org'
    );
    expect(frame().style.height).toBe('20000px');
  });
  it('ignores submit, state, and error messages', () => {
    const send = vi.spyOn(fixture.mx, 'sendEvent');
    render();
    for (const type of ['submit', 'state', 'error'])
      post({
        type: `mindroom.canvas.${type}`,
        version: 1,
        data: { answer: 1 },
        json: '{}',
        message: 'oops',
      });
    expect(send).not.toHaveBeenCalled();
    expect(container.querySelector('button')).toBeNull();
    expect(frame().style.height).toBe('160px');
  });
  it('renders neither panel canvases nor disabled canvases', () => {
    render(makeUiEvent({ action: 'show_canvas', canvas }));
    expect(container.querySelector('iframe')).toBeNull();
    render(event(), false);
    expect(container.querySelector('iframe')).toBeNull();
  });
  it('loads an uploaded page and offers a retry after failure', async () => {
    download.mockRejectedValueOnce(new Error('offline'));
    const request = makeUiEvent({
      action: 'show_canvas',
      inline: true,
      canvas: {
        title: 'Uploaded',
        document: { mimetype: 'text/html', size: 40, url: 'mxc://example.org/page' },
      },
    });
    await act(async () => {
      render(request);
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    download.mockResolvedValueOnce({ text: () => Promise.resolve('<p>Downloaded</p>') });
    await act(async () => {
      container.querySelector('button')?.click();
    });
    expect(frame().srcdoc).toContain('Downloaded');
    expect(download).toHaveBeenCalledTimes(2);
  });
  it('remounts at the initial height for the latest accepted revision', () => {
    const request = event();
    render(request);
    const previous = frame();
    post({ type: 'mindroom.canvas.size', version: 1, height: 500 });
    const content = {
      ...request.getOriginalContent(),
      'io.mindroom.ui_action': {
        ...request.getOriginalContent()['io.mindroom.ui_action'],
        canvas: { title: 'Updated', html: '<p>Latest</p>' },
      },
    };
    const edit = new MatrixEvent({
      event_id: '$edit',
      sender: request.getSender(),
      type: 'm.room.message',
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: request.getId() },
        'm.new_content': content,
      },
    });
    act(() => request.makeReplaced(edit));
    expect(frame()).not.toBe(previous);
    expect(frame().title).toBe('Updated');
    expect(frame().style.height).toBe('160px');
    expect(frame().srcdoc).toContain('Latest');
  });

  it('renders a page with its own width at that width, shrunk to fit the column', () => {
    const observed: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observed.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );
    const page = { title: 'Site', html: '<p>Site</p>', raw: true, width: 1440 };
    render(makeUiEvent({ action: 'show_canvas', inline: true, canvas: page }), true, true);
    act(() =>
      observed.forEach((callback) =>
        callback([{ contentRect: { width: 720 } } as ResizeObserverEntry], {} as ResizeObserver)
      )
    );
    expect(frame().style.width).toBe('1440px');
    expect(frame().style.transform).toBe('scale(0.5)');
    expect(frame().style.background).toContain('rgb(255, 255, 255)');
    post({ type: 'mindroom.canvas.size', version: 1, height: 1000 });
    expect(frame().style.height).toBe('1000px');
    expect((frame().parentElement as HTMLElement).style.height).toBe('500px');
    // A raw page carries none of Chat's styles, and the deployment's remote assets are allowed.
    expect(frame().srcdoc).not.toContain('padding:8px');
    expect(frame().srcdoc).toContain('img-src data: blob: https:');
    vi.unstubAllGlobals();
  });
  it('gives a page that follows its viewport a window and fits it no more', () => {
    const observed: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observed.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );
    const column = (width: number) =>
      act(() =>
        observed.forEach((callback) =>
          callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
        )
      );
    render();
    post({ type: 'mindroom.canvas.size', version: 1, height: 256 });
    expect(frame().style.height).toBe('256px');
    post({ type: 'mindroom.canvas.size', version: 1, height: 352, viewport: true });
    // A window for the column's width: 16:10, at least 568 pixels.
    expect(frame().style.height).toBe('568px');
    column(1600);
    expect(frame().style.height).toBe('1000px');
    post({ type: 'mindroom.canvas.size', version: 1, height: 5000 });
    expect(frame().style.height).toBe('1000px');
    // A page with its own width gets the window of that width, shrunk with it.
    const page = { title: 'Site', html: '<p>Site</p>', raw: true, width: 1440 };
    render(makeUiEvent({ action: 'show_canvas', inline: true, canvas: page }));
    column(720);
    post({ type: 'mindroom.canvas.size', version: 1, height: 1200, viewport: true });
    expect(frame().style.height).toBe('900px');
    expect((frame().parentElement as HTMLElement).style.height).toBe('450px');
    vi.unstubAllGlobals();
  });
  it('starts a page again when it escapes its frame, until it keeps escaping', () => {
    render();
    const escaped = { type: 'mindroom.canvas.escaped' };
    // The wrapper around the page reports that the page tried to load something else.
    const escape = () => post(escaped, frame().contentWindow!);
    post({ type: 'mindroom.canvas.size', version: 1, height: 500 });
    const first = frame();
    // Only the page's own wrapper reports an escape.
    post(escaped);
    post(escaped, first.contentWindow!, 'https://example.org');
    expect(frame()).toBe(first);
    escape();
    expect(frame()).not.toBe(first);
    expect(frame().srcdoc).toBe(first.srcdoc);
    expect(frame().style.height).toBe('500px');
    escape();
    escape();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // A page that escapes every time it loads stops reloading until the user asks.
    escape();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    act(() => container.querySelector('button')!.click());
    expect(container.querySelector('iframe')).not.toBeNull();
  });
  it('shrinks a wide page to its column and never enlarges a narrow one', () => {
    expect(inlineCanvasScale(720, 1440)).toBe(0.5);
    expect(inlineCanvasScale(720, 390)).toBe(1);
    expect(inlineCanvasScale(720, undefined)).toBe(1);
    expect(inlineCanvasScale(0, 1440)).toBe(1);
  });
});
