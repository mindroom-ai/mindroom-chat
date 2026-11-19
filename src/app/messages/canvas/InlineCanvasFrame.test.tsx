// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { ChatUiActionContext } from '../../ui-actions/ChatUiActionProvider';
import { makeUiEvent, makeUiRoom } from '../../ui-actions/testUtils';
import { InlineCanvasFrame, inlineCanvasScale } from './InlineCanvasFrame';
import { canvasFrameWindow, CANVAS_WRAPPER_SANDBOX, type CanvasSaved } from './canvasDocument';
import { CANVAS_RESPONSE_KEY } from './canvasMessages';
import { CANVAS_SEND_ARM_DELAY_MS } from './useCanvasHost';

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
// Saved state is read from IndexedDB; these tests decide when it is ready and what it holds.
const saved = vi.hoisted(() => ({ ready: true, value: {} as CanvasSaved }));
vi.mock('./useCanvasSavedState', () => ({
  useCanvasSavedState: () => ({
    ready: saved.ready,
    read: () => saved.value,
    save: (change: CanvasSaved) => {
      saved.value = { ...saved.value, ...change };
    },
  }),
}));
// Sharing sends Matrix events; these tests check what the host asks it to share.
const shares = vi.hoisted(() => ({ enabled: [] as boolean[], saves: [] as CanvasSaved[] }));
vi.mock('./useCanvasStateShare', () => ({
  useCanvasStateShare: (_mx: unknown, _room: unknown, _canvasId: string, enabled: boolean) => {
    shares.enabled.push(enabled);
    return (record: CanvasSaved) => shares.saves.push(record);
  },
}));
const appTheme = vi.hoisted(() => ({ kind: 'light' }));
vi.mock('../../theme/useTheme', () => ({
  ThemeKind: { Dark: 'dark' },
  useTheme: () => ({ kind: appTheme.kind, id: appTheme.kind }),
}));

let root: Root;
let container: HTMLDivElement;
let fixture: ReturnType<typeof makeUiRoom>;
const canvas = { title: 'A mockup', html: '<p>Preview</p>' };
const event = () => makeUiEvent({ action: 'show_canvas', inline: true, canvas });
const render = (
  request = event(),
  enabled = true,
  remoteAssets = false,
  { readOnly = false, openCanvasId }: { readOnly?: boolean; openCanvasId?: string } = {}
) =>
  act(() =>
    root.render(
      <MatrixClientProvider value={fixture.mx}>
        <ClientConfigProvider value={{ mindroom: { canvas: { enabled, remoteAssets } } }}>
          <ChatUiActionContext.Provider
            value={{
              read: () => undefined,
              unavailable: () => undefined,
              activate: () => undefined,
              openCanvasId,
            }}
          >
            <InlineCanvasFrame event={request} readOnly={readOnly} />
          </ChatUiActionContext.Provider>
        </ClientConfigProvider>
      </MatrixClientProvider>
    )
  );
const frame = () => container.querySelector('iframe')!;
/** The canvas page, which the wrapper document carries as a script string. */
const pageSource = () => {
  const literal = /frame\.srcdoc = ("(?:[^"\\]|\\.)*");/.exec(frame().getAttribute('srcdoc') ?? '');
  return literal ? (JSON.parse(literal[1]!) as string) : '';
};
const post = (data: unknown, source = canvasFrameWindow(frame()), origin = 'null') =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source, origin }));
  });
beforeEach(() => {
  saved.ready = true;
  saved.value = {};
  shares.enabled = [];
  shares.saves = [];
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
  it('starts at 160 pixels in the existing opaque sandbox from the saved state', () => {
    saved.value = { json: '{"step":2}' };
    render();
    expect(frame().title).toBe(canvas.title);
    expect(frame().getAttribute('sandbox')).toBe(CANVAS_WRAPPER_SANDBOX);
    expect(frame().style.height).toBe('160px');
    expect(pageSource()).toContain('{\\"step\\":2}');
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
  it('keeps a read-only row display-only: no saved state, answers, saves, or error reports', () => {
    const send = vi.spyOn(fixture.mx, 'sendEvent');
    saved.value = { json: '{"step":2}' };
    render(event(), true, false, { readOnly: true });
    expect(frame().srcdoc).toContain('state: undefined');
    for (const type of ['submit', 'state', 'error'])
      post({
        type: `mindroom.canvas.${type}`,
        version: 1,
        data: { answer: 1 },
        json: '{}',
        message: 'oops',
        user: true,
      });
    expect(send).not.toHaveBeenCalled();
    expect(container.querySelector('button')).toBeNull();
    expect(saved.value).toEqual({ json: '{"step":2}' });
    expect(shares.enabled).toEqual([]);
    expect(frame().style.height).toBe('160px');
  });
  it('renders neither panel canvases nor disabled canvases', () => {
    render(makeUiEvent({ action: 'show_canvas', canvas }));
    expect(container.querySelector('iframe')).toBeNull();
    render(event(), false);
    expect(container.querySelector('iframe')).toBeNull();
  });
  it('runs no page made for another member, nor fetches it', async () => {
    const request = makeUiEvent({
      action: 'show_canvas',
      inline: true,
      requester_id: '@bob:example.org',
      canvas: {
        title: 'Uploaded',
        document: { mimetype: 'text/html', size: 40, url: 'mxc://example.org/page' },
      },
    });
    const downloads = download.mock.calls.length;
    await act(async () => {
      render(request, true, true);
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toBe('');
    expect(download.mock.calls.length).toBe(downloads);
    // Nothing of another member's page is kept or shared on this device.
    expect(shares.enabled).toEqual([]);
    render(
      makeUiEvent({ action: 'show_canvas', inline: true, canvas, requester_id: '@bob:example.org' })
    );
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
    post({ type: 'mindroom.canvas.size', version: 1, height: 800 });
    expect(frame().style.height).toBe('900px');
    expect((frame().parentElement as HTMLElement).style.height).toBe('400px');
    // A raw page carries none of Chat's styles, and the deployment's remote assets are allowed.
    expect(frame().srcdoc).not.toContain('padding:8px');
    expect(frame().srcdoc).toContain('img-src data: blob: https:');
    vi.unstubAllGlobals();
  });
  it('lays a website preview out in a fixed browser window and shows as much of it as the page fills', () => {
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
    const size = (height: number) => post({ type: 'mindroom.canvas.size', version: 1, height });
    const box = () => (frame().parentElement as HTMLElement).style.height;
    // A raw page without a width: a window of 16:10 of the column, at least 568 pixels. The frame,
    // and so the page's viewport, keeps that height whatever the page reports, so 50vh stays 284.
    render(makeUiEvent({ action: 'show_canvas', inline: true, canvas: { ...canvas, raw: true } }));
    expect([frame().style.height, box()]).toEqual(['568px', '568px']);
    size(300);
    expect([frame().style.height, box()]).toEqual(['568px', '300px']);
    // Taller content, such as a 100vh hero, shows the whole window and scrolls inside it.
    size(5000);
    expect([frame().style.height, box()]).toEqual(['568px', '568px']);
    column(1600);
    expect([frame().style.height, box()]).toEqual(['1000px', '1000px']);
    // A page with its own width takes the window of that width, shrunk with the page.
    const page = { title: 'Site', html: '<p>Site</p>', width: 1440 };
    render(makeUiEvent({ action: 'show_canvas', inline: true, canvas: page }));
    column(720);
    expect([frame().style.height, box()]).toEqual(['900px', '450px']);
    size(20000);
    expect([frame().style.height, box()]).toEqual(['900px', '450px']);
    size(836);
    expect([frame().style.height, box()]).toEqual(['900px', '418px']);
    vi.unstubAllGlobals();
  });
  it("keeps a raw page as it is when Chat's theme changes, and redraws a themed one", () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const raw = makeUiEvent({
      action: 'show_canvas',
      inline: true,
      canvas: { ...canvas, raw: true },
    });
    const srcdocs = (request: ReturnType<typeof event>, readOnly = true) =>
      ['light', 'dark'].map((kind) => {
        appTheme.kind = kind;
        render(request, true, false, { readOnly });
        return frame().srcdoc;
      });
    const [rawLight, rawDark] = srcdocs(raw);
    expect(rawDark).toBe(rawLight);
    const [themedLight, themedDark] = srcdocs(event());
    expect(themedDark).not.toBe(themedLight);
    // A page the user can work in keeps the theme it was shown with, as in the panel, so
    // switching themes cannot discard unsent work.
    act(() => root.render(<></>));
    const [liveLight, liveDark] = srcdocs(event(), false);
    expect(liveDark).toBe(liveLight);
    appTheme.kind = 'light';
    vi.unstubAllGlobals();
  });
  it('fits a themed page to its content, past any window', () => {
    render();
    post({ type: 'mindroom.canvas.size', version: 1, height: 5000 });
    expect(frame().style.height).toBe('5000px');
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

describe('InlineCanvasFrame as a host', () => {
  // Each send waits here until a test answers it, as a homeserver would.
  let requests: Array<{ resolve: (value: unknown) => void }>;
  let sendMessage: MockInstance;
  beforeEach(() => {
    vi.useFakeTimers();
    requests = [];
    vi.spyOn(fixture.mx.http, 'authedRequest').mockImplementation(
      () =>
        new Promise((resolve) => {
          requests.push({ resolve });
        }) as never
    );
    sendMessage = vi.spyOn(fixture.mx, 'sendMessage');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const submit = (user?: boolean, label = 'Pro plan', data: unknown = { plan: 'pro' }) => ({
    type: 'mindroom.canvas.submit',
    version: 1,
    data,
    label,
    ...(user === undefined ? {} : { user }),
  });
  const save = (json: string, user: boolean) =>
    post({ type: 'mindroom.canvas.state', version: 1, json, user });
  const later = (ms = 100) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });
  const sendButton = () => container.querySelector<HTMLButtonElement>('[data-canvas-send]');
  const status = () => container.querySelector('[data-canvas-status]')?.textContent ?? '';
  const buttonNamed = (name: string) =>
    [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === name);
  const edit = (request: MatrixEvent, html: string) =>
    new MatrixEvent({
      event_id: '$edit',
      sender: request.getSender(),
      type: 'm.room.message',
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: request.getId() },
        'm.new_content': {
          ...request.getOriginalContent(),
          'io.mindroom.ui_action': {
            ...request.getOriginalContent()['io.mindroom.ui_action'],
            canvas: { title: 'Step 2', html },
          },
        },
      },
    });

  it('offers an answer for Send, as the panel does, and sends it once armed', async () => {
    render();
    expect(status()).toBe('');
    // The user's Send in Chat's bar is the consent; nothing leaves before it.
    post(submit());
    expect(container.textContent).toContain('Pro plan');
    // The disclosure shows with the answer, not under every page.
    expect(container.textContent).toContain('what you enter here may leave this page');
    expect(sendButton()!.disabled).toBe(true);
    await later(CANVAS_SEND_ARM_DELAY_MS);
    expect(sendButton()!.disabled).toBe(false);
    await act(async () => sendButton()!.click());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![1]).toMatchObject({
      [CANVAS_RESPONSE_KEY]: { canvas_event_id: '$request', label: 'Pro plan' },
    });
    expect(sendButton()).toBeNull();
    await act(async () => requests.shift()?.resolve({ event_id: '$answer' }));
    expect(status()).toMatch(/^Sent to .+: Pro plan$/);
  });

  it('saves what the user enters without restarting the page, and starts from it again', () => {
    render();
    const shown = frame();
    save('{"step":3}', true);
    expect(saved.value).toEqual({ json: '{"step":3}' });
    expect(frame()).toBe(shown);
    // Scrolling away unmounts the row; scrolling back starts the page from what it saved.
    act(() => root.render(<></>));
    render();
    expect(pageSource()).toContain('{\\"step\\":3}');
  });

  it('waits for the saved state before it starts the page', () => {
    saved.ready = false;
    render();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading panel…');
    saved.ready = true;
    render();
    expect(frame()).not.toBeNull();
  });

  it("shares only the user's own changes, and says so before they type", () => {
    render(makeUiEvent({ action: 'show_canvas', inline: true, canvas, share_state: true }));
    expect(shares.enabled.at(-1)).toBe(true);
    // The notice comes before the page, so the user reads it before typing.
    const notice = container.querySelector('[data-canvas-shared]')!;
    expect(notice.compareDocumentPosition(frame()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // What the page saves before the user works in it is not theirs to share, as in the panel.
    save('{"defaults":true}', false);
    expect(shares.saves).toEqual([]);
    expect(saved.value).toEqual({ json: '{"defaults":true}' });
    save('{"step":3}', true);
    expect(shares.saves).toEqual([{ json: '{"step":3}' }]);
    act(() => root.render(<></>));
    shares.enabled = [];
    render();
    expect(shares.enabled.every((enabled) => !enabled)).toBe(true);
    expect(container.querySelector('[data-canvas-shared]')).toBeNull();
  });

  it('lets the user tell the agent about an error the page reported', async () => {
    render();
    post({ type: 'mindroom.canvas.error', version: 1, message: 'Chart is not defined' });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Chart is not defined'
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-canvas-report]')!.click()
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![1].body).toContain('Canvas error ($request');
  });

  it('holds an update behind Load update while the user works in the page', () => {
    const request = event();
    render(request);
    const shown = frame();
    post(submit());
    expect(sendButton()).not.toBeNull();
    act(() => request.makeReplaced(edit(request, '<p>Latest</p>')));
    expect(frame()).toBe(shown);
    expect(container.textContent).toContain('updated this page.');
    // The staged answer was for the page before the update.
    expect(sendButton()).toBeNull();
    act(() => buttonNamed('Load update')!.click());
    expect(frame()).not.toBe(shown);
    expect(frame().srcdoc).toContain('Latest');
  });

  it('names the panel instead of running a second copy while the panel shows the canvas', () => {
    render(event(), true, false, { openCanvasId: '$request' });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[data-canvas-in-panel]')?.textContent).toBe(
      'Shown in the panel'
    );
    // Closing the panel starts the page again, from what the panel saved.
    saved.value = { json: '{"step":4}' };
    render();
    expect(pageSource()).toContain('{\\"step\\":4}');
  });

  it('finishes sending a large answer after its row scrolled away', async () => {
    let finishUpload: () => void = () => undefined;
    vi.spyOn(fixture.mx, 'uploadContent').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = () => resolve({ content_uri: 'mxc://example.org/answer' });
        }) as never
    );
    render();
    post(submit(true, 'Draft', { text: 'A long paragraph. '.repeat(4000) }));
    await later(CANVAS_SEND_ARM_DELAY_MS);
    await act(async () => sendButton()!.click());
    expect(sendMessage).not.toHaveBeenCalled();
    act(() => root.render(<></>));
    await act(async () => finishUpload());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![1]).toMatchObject({
      msgtype: 'm.file',
      url: 'mxc://example.org/answer',
      [CANVAS_RESPONSE_KEY]: { canvas_event_id: '$request', label: 'Draft' },
    });
  });

  it('keeps an answer still uploading, and its Discard, when the page starts again', async () => {
    let failUpload: () => void = () => undefined;
    vi.spyOn(fixture.mx, 'uploadContent').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failUpload = () => reject(new Error('offline'));
        }) as never
    );
    render();
    post(submit(true, 'Draft', { text: 'A long paragraph. '.repeat(4000) }));
    await later(CANVAS_SEND_ARM_DELAY_MS);
    await act(async () => sendButton()!.click());
    const first = frame();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'mindroom.canvas.escaped' },
          source: first.contentWindow,
          origin: 'null',
        })
      );
    });
    expect(frame()).not.toBe(first);
    expect(container.querySelector('[data-canvas-discard]')).not.toBeNull();
    expect(container.textContent).toContain('Draft');
    // The upload fails: the answer is still there to send again.
    await act(async () => failUpload());
    expect(status()).toBe('Could not send your response. Try again.');
    expect(sendButton()!.disabled).toBe(false);
  });

  it('takes an answer that comes right after a size report', () => {
    render();
    post({ type: 'mindroom.canvas.size', version: 1, height: 300 });
    post(submit());
    expect(sendButton()).not.toBeNull();
  });

  it('keeps an answer staged while a held update finishes downloading', async () => {
    let finish: (html: string) => void = () => undefined;
    download.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = (html) => resolve({ text: () => Promise.resolve(html) });
        })
    );
    const request = event();
    render(request);
    post(submit(true, 'First'));
    const uploaded = new MatrixEvent({
      event_id: '$edit',
      sender: request.getSender(),
      type: 'm.room.message',
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: request.getId() },
        'm.new_content': {
          ...request.getOriginalContent(),
          'io.mindroom.ui_action': {
            ...request.getOriginalContent()['io.mindroom.ui_action'],
            canvas: {
              title: 'Step 2',
              document: { mimetype: 'text/html', size: 40, url: 'mxc://example.org/step' },
            },
          },
        },
      },
    });
    act(() => request.makeReplaced(uploaded));
    expect(container.textContent).toContain('updated this page.');
    expect(sendButton()).toBeNull();
    // The user answers again on the page still shown; the update's download then finishes.
    await later();
    post(submit(true, 'Second'));
    expect(container.textContent).toContain('Second');
    await act(async () => finish('<p>Step 2</p>'));
    expect(container.textContent).toContain('Second');
    expect(sendButton()).not.toBeNull();
    expect(container.textContent).toContain('updated this page.');
  });

  it('starts an escaped page again from what it saved since, without its staged answer', () => {
    render();
    save('{"step":5}', true);
    post(submit());
    expect(sendButton()).not.toBeNull();
    const first = frame();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'mindroom.canvas.escaped' },
          source: first.contentWindow,
          origin: 'null',
        })
      );
    });
    expect(frame()).not.toBe(first);
    expect(pageSource()).toContain('{\\"step\\":5}');
    expect(sendButton()).toBeNull();
  });

  it('still offers a held update after the page it holds starts again', () => {
    const request = event();
    render(request);
    post(submit());
    act(() => request.makeReplaced(edit(request, '<p>Latest</p>')));
    expect(container.textContent).toContain('updated this page.');
    const first = frame();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'mindroom.canvas.escaped' },
          source: first.contentWindow,
          origin: 'null',
        })
      );
    });
    expect(frame()).not.toBe(first);
    expect(container.textContent).toContain('updated this page.');
    act(() => buttonNamed('Load update')!.click());
    expect(frame().srcdoc).toContain('Latest');
  });
});
