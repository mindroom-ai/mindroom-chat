// @vitest-environment jsdom
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadRootTitle } from './ThreadRootTitle';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shown = (renderer: ReturnType<typeof create>) =>
  renderer.root
    .findByProps({ 'data-thread-context-root-title': 'true' })
    .findAll((node) => typeof node.children[0] === 'string')
    .map((node) => node.children.join(''))
    .at(-1);

const stubMeasureText = () =>
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (candidate: string) => ({ width: candidate.length * 10 }),
  } as unknown as CanvasRenderingContext2D);

// A title its line cuts at a word, then shown whole on a phone at the same width (a layout switch
// that leaves the banner as wide as it was): the phone shows every word.
it('shows the whole title once whole, though its line had cut it at the same width', () => {
  const text = 'Notes from the upload review of the second floor';
  stubMeasureText();
  const createNodeMock = () => {
    const span = document.createElement('span');
    Object.defineProperty(span, 'scrollWidth', { value: text.length * 10 });
    Object.defineProperty(span, 'clientWidth', { value: 200 });
    return span;
  };

  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<ThreadRootTitle text={text} />, { createNodeMock });
  });
  expect(shown(renderer)).toBe('Notes from the…');

  act(() => renderer.update(<ThreadRootTitle text={text} whole />));
  expect(shown(renderer)).toBe(text);
});

it('coalesces rapid row resizes into one re-fit and skips widening an already-fitting title', () => {
  vi.useFakeTimers();
  let notifyResize: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }

      observe() {}

      disconnect() {}
    }
  );
  stubMeasureText();

  let text = 'Notes from the upload review of the second floor';
  let rowWidth = 240;
  let fitReads = 0;
  const row = document.createElement('div');
  Object.defineProperty(row, 'clientWidth', { get: () => rowWidth });
  const createNodeMock = () => {
    const span = document.createElement('span');
    Object.defineProperty(span, 'scrollWidth', {
      get: () => {
        fitReads += 1;
        return text.length * 10;
      },
    });
    Object.defineProperty(span, 'clientWidth', { get: () => rowWidth });
    row.append(span);
    return span;
  };

  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<ThreadRootTitle text={text} />, { createNodeMock });
  });
  expect(shown(renderer)).toBe('Notes from the upload…');
  fitReads = 0;

  for (const nextWidth of [220, 190, 160, 130]) {
    rowWidth = nextWidth;
    act(() => {
      notifyResize?.();
      vi.advanceTimersByTime(40);
    });
  }
  expect(fitReads).toBe(0);
  expect(shown(renderer)).toBe('Notes from the upload…');

  act(() => {
    vi.advanceTimersByTime(60);
  });
  expect(fitReads).toBe(1);
  expect(shown(renderer)).toBe('Notes from…');

  text = 'Short title';
  rowWidth = 200;
  act(() => renderer.update(<ThreadRootTitle text={text} />));
  expect(shown(renderer)).toBe('Short title');
  fitReads = 0;

  for (const nextWidth of [240, 280, 320]) {
    rowWidth = nextWidth;
    act(() => notifyResize?.());
  }
  act(() => {
    vi.runAllTimers();
  });
  expect(fitReads).toBe(0);

  act(() => renderer.unmount());
});
