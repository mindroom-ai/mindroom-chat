// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from './ImageViewer';

vi.mock('../../matrix/matrix', () => ({ downloadMedia: async () => new Blob(['picture']) }));
const saveFile = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../native/nativeFileSave', () => ({ saveFile }));

// jsdom has no pointer events.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
  }
}

beforeEach(() => vi.stubGlobal('PointerEvent', TestPointerEvent));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const imageArea = () => screen.getByRole('img').parentElement!;

/** A one-finger drag over the image area, from x 300 to `toX`. */
const swipe = (toX: number, toY = 200) => {
  const area = imageArea();
  const pointer = { pointerId: 1, pointerType: 'touch', button: 0 };
  fireEvent.pointerDown(area, { ...pointer, clientX: 300, clientY: 200 });
  fireEvent.pointerMove(area, { ...pointer, clientX: (300 + toX) / 2, clientY: (200 + toY) / 2 });
  fireEvent.pointerUp(area, { ...pointer, clientX: toX, clientY: toY });
};

describe('ImageViewer paging', () => {
  it.each([
    ['no position', undefined],
    ['a single picture', { index: 0, count: 1 }],
  ])('shows no counter or arrows for %s', (_label, position) => {
    render(
      <ImageViewer
        src="blob:a"
        alt="a.png"
        requestClose={vi.fn()}
        position={position}
        onStep={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Previous image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull();
    expect(screen.queryByText('1 / 1')).toBeNull();
  });

  it('shows where the picture sits and steps with its arrows, which stay focusable at the ends', () => {
    const onStep = vi.fn();
    render(
      <ImageViewer
        src="blob:a"
        alt="a.png"
        requestClose={vi.fn()}
        position={{ index: 0, count: 5 }}
        onStep={onStep}
      />
    );
    expect(screen.getByText('1 / 5').getAttribute('aria-live')).toBe('polite');

    const previous = screen.getByRole('button', { name: 'Previous image' });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    expect(previous.hasAttribute('disabled')).toBe(false);
    fireEvent.click(previous);
    expect(onStep).not.toHaveBeenCalled();

    const next = screen.getByRole('button', { name: 'Next image' });
    expect(next.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(next);
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('steps with the arrow keys without modifiers, and keeps them from the page', () => {
    const onStep = vi.fn();
    render(
      <ImageViewer
        src="blob:b"
        alt="b.png"
        requestClose={vi.fn()}
        position={{ index: 1, count: 3 }}
        onStep={onStep}
      />
    );
    const right = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(right);
    expect(onStep).toHaveBeenLastCalledWith(1);
    expect(right.defaultPrevented).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    expect(onStep).toHaveBeenLastCalledWith(-1);

    onStep.mockClear();
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, [modifier]: true })
      );
    }
    expect(onStep).not.toHaveBeenCalled();
  });

  // A picture may have arrived past the end it knows of: its owner stops at the real ends.
  it('asks its owner for a key step past the end it knows of', () => {
    const onStep = vi.fn();
    render(
      <ImageViewer
        src="blob:c"
        alt="c.png"
        requestClose={vi.fn()}
        position={{ index: 2, count: 3 }}
        onStep={onStep}
      />
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    expect(onStep).toHaveBeenCalledWith(1);
  });

  describe('arrow keys aimed elsewhere', () => {
    const keyFrom = (target: Element) => {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        cancelable: true,
        bubbles: true,
      });
      target.dispatchEvent(event);
      return event;
    };
    const mount = (onStep: () => void) =>
      render(
        <>
          <button type="button">timeline picture</button>
          <input aria-label="composer" />
          <textarea aria-label="notes" />
          <select aria-label="choice" />
          <div contentEditable aria-label="editor" />
          <div role="dialog" aria-label="Settings">
            <button type="button">setting</button>
          </div>
          <div role="dialog" aria-label="viewer">
            <ImageViewer
              src="blob:b"
              alt="b.png"
              requestClose={vi.fn()}
              position={{ index: 1, count: 3 }}
              onStep={onStep}
            />
          </div>
        </>
      );

    it('leaves keys typed into an editable field alone', () => {
      const onStep = vi.fn();
      mount(onStep);
      for (const name of ['composer', 'notes', 'choice', 'editor']) {
        expect(keyFrom(screen.getByLabelText(name)).defaultPrevented).toBe(false);
      }
      expect(onStep).not.toHaveBeenCalled();
    });

    it('leaves keys inside another dialog alone', () => {
      const onStep = vi.fn();
      mount(onStep);
      expect(keyFrom(screen.getByRole('button', { name: 'setting' })).defaultPrevented).toBe(false);
      expect(onStep).not.toHaveBeenCalled();
    });

    it('steps from the timeline picture focus stayed on, and from inside its own dialog', () => {
      const onStep = vi.fn();
      mount(onStep);
      expect(
        keyFrom(screen.getByRole('button', { name: 'timeline picture' })).defaultPrevented
      ).toBe(true);
      keyFrom(screen.getByRole('button', { name: 'Next image' }));
      expect(onStep).toHaveBeenCalledTimes(2);
    });

    it('stops listening once closed', () => {
      const onStep = vi.fn();
      const { unmount } = mount(onStep);
      unmount();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
      expect(onStep).not.toHaveBeenCalled();
    });
  });

  it('reports a picture it cannot decode, and starts over with the next source', () => {
    const onImageError = vi.fn();
    const { rerender } = render(
      <ImageViewer src="blob:a" alt="a.png" requestClose={vi.fn()} onImageError={onImageError} />
    );
    fireEvent.error(screen.getByRole('img'));
    expect(onImageError).toHaveBeenCalledOnce();
    rerender(
      <ImageViewer src="blob:b" alt="a.png" requestClose={vi.fn()} onImageError={onImageError} />
    );
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:b');
  });

  it('steps on a horizontal swipe at fit, and pans instead once zoomed', () => {
    const onStep = vi.fn();
    render(
      <ImageViewer
        src="blob:b"
        alt="b.png"
        requestClose={vi.fn()}
        position={{ index: 1, count: 3 }}
        onStep={onStep}
      />
    );
    swipe(200);
    expect(onStep).toHaveBeenLastCalledWith(1);
    swipe(400);
    expect(onStep).toHaveBeenLastCalledWith(-1);

    onStep.mockClear();
    // Too short, and more vertical than horizontal.
    swipe(250);
    swipe(200, 400);
    expect(onStep).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    swipe(200);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('does not step on a pinch', () => {
    const onStep = vi.fn();
    render(
      <ImageViewer
        src="blob:b"
        alt="b.png"
        requestClose={vi.fn()}
        position={{ index: 1, count: 3 }}
        onStep={onStep}
      />
    );
    const area = imageArea();
    const touch = { pointerType: 'touch', button: 0 };
    fireEvent.pointerDown(area, { ...touch, pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerDown(area, { ...touch, pointerId: 2, clientX: 320, clientY: 200 });
    fireEvent.pointerUp(area, { ...touch, pointerId: 2, clientX: 400, clientY: 200 });
    fireEvent.pointerUp(area, { ...touch, pointerId: 1, clientX: 100, clientY: 200 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('goes back to fit when the picture changes', () => {
    const props = {
      alt: 'a.png',
      requestClose: vi.fn(),
      position: { index: 0, count: 2 },
      onStep: vi.fn(),
    };
    const { rerender } = render(<ImageViewer {...props} src="blob:a" />);
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByRole('button', { name: '200%' })).toBeTruthy();

    rerender(<ImageViewer {...props} src="blob:b" position={{ index: 1, count: 2 }} />);
    expect(screen.getByRole('button', { name: '100%' })).toBeTruthy();
  });
});

describe('ImageViewer loading', () => {
  it('shows a spinner without a picture yet, keeps its header, and offers no download', () => {
    render(<ImageViewer alt="a.png" requestClose={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download' }).hasAttribute('disabled')).toBe(true);
  });

  it('offers Retry when the picture failed to load', () => {
    const onRetry = vi.fn();
    render(<ImageViewer alt="a.png" requestClose={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByText('Failed to load image!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('ImageViewer download', () => {
  it('starts each picture with a plain Download, even after the last one failed to save', async () => {
    saveFile.mockRejectedValueOnce(new Error('disk full'));
    const { rerender } = render(<ImageViewer src="blob:a" alt="a.png" requestClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('button', { name: 'Retry Download' })).toBeTruthy();

    rerender(<ImageViewer src="blob:b" alt="b.png" requestClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
  });
});
