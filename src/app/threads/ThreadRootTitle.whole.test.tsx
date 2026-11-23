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

const mountResizable = (initialText: string, initialWidth: number) => {
  vi.useFakeTimers();
  let notifyResize: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }

      observe() {}

      disconnect() {
        notifyResize = undefined;
      }
    }
  );
  stubMeasureText();

  let text = initialText;
  let rowWidth = initialWidth;
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
  return {
    renderer,
    get fitReads() {
      return fitReads;
    },
    resetFitReads: () => {
      fitReads = 0;
    },
    setWidth: (next: number) => {
      rowWidth = next;
    },
    resizeTo: (next: number) => {
      rowWidth = next;
      act(() => notifyResize?.());
    },
    update: (nextText: string, whole?: boolean) => {
      text = nextText;
      act(() => renderer.update(<ThreadRootTitle text={nextText} whole={whole} />));
    },
  };
};

it('coalesces rapid row resizes into one re-fit after settling', () => {
  const host = mountResizable('Notes from the upload review of the second floor', 240);
  expect(shown(host.renderer)).toBe('Notes from the upload…');
  host.resetFitReads();

  for (const nextWidth of [220, 190, 160, 130]) {
    host.resizeTo(nextWidth);
    act(() => {
      vi.advanceTimersByTime(40);
    });
  }
  expect(host.fitReads).toBe(0);
  expect(shown(host.renderer)).toBe('Notes from the upload…');

  act(() => {
    vi.advanceTimersByTime(60);
  });
  expect(host.fitReads).toBe(1);
  expect(shown(host.renderer)).toBe('Notes from…');
  act(() => host.renderer.unmount());
});

it('re-measures after returning from whole mode at a new width and re-fits wide first words', () => {
  const title = 'Notes from the upload review of the second floor';
  const host = mountResizable(title, 130);
  expect(shown(host.renderer)).toBe('Notes from…');

  host.update(title, true);
  expect(shown(host.renderer)).toBe(title);
  // Row grows while ResizeObserver is disconnected in whole mode.
  host.setWidth(240);
  host.update(title, false);
  expect(shown(host.renderer)).toBe('Notes from the upload…');

  act(() => host.renderer.unmount());

  const wideFirstWord = 'Supercalifragilistic expialidocious';
  const wideHost = mountResizable(wideFirstWord, 150);
  expect(shown(wideHost.renderer)).toBe(wideFirstWord);

  wideHost.resizeTo(220);
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(shown(wideHost.renderer)).toBe('Supercalifragilistic…');
  act(() => wideHost.renderer.unmount());
});
