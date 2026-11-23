// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Icon, Icons } from 'folds';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogCloseButton, SheetScrollArea } from './DialogChrome';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DialogCloseButton', () => {
  it('renders an accessible pill close button and handles clicks', () => {
    const onClick = vi.fn();
    render(<DialogCloseButton label="Close sheet" onClick={onClick} className="extra-close" />);

    const button = screen.getByRole('button', { name: 'Close sheet' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('dialog-close-touch-icon');
    expect(button.className).toContain('extra-close');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('forwards ref, iconSize, and button attributes', () => {
    const buttonRef = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    const { container } = render(
      <>
        <DialogCloseButton
          ref={buttonRef}
          label="Close tour"
          iconSize="100"
          data-tour-action="close"
          disabled
          onClick={onClick}
        />
        <span data-testid="ref-icon-100">
          <Icon size="100" src={Icons.Cross} />
        </span>
        <span data-testid="ref-icon-200">
          <Icon size="200" src={Icons.Cross} />
        </span>
      </>
    );

    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Close tour' });
    expect(buttonRef.current).toBe(button);
    expect(button.getAttribute('data-tour-action')).toBe('close');
    expect(button.disabled).toBe(true);

    const buttonIconClass = button.querySelector('svg')?.getAttribute('class');
    const icon100Class = container
      .querySelector('[data-testid="ref-icon-100"] svg')
      ?.getAttribute('class');
    const icon200Class = container
      .querySelector('[data-testid="ref-icon-200"] svg')
      ?.getAttribute('class');
    expect(buttonIconClass).toBe(icon100Class);
    expect(buttonIconClass).not.toBe(icon200Class);

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('SheetScrollArea', () => {
  it('forwards object and callback refs to the scrollable viewport and wires InsetScrollbar', () => {
    const scrollRef = createRef<HTMLDivElement>();
    const onKeyDown = vi.fn();
    render(
      <SheetScrollArea
        scrollRef={scrollRef}
        id="results-panel"
        role="tabpanel"
        aria-labelledby="results-tab"
        onKeyDown={onKeyDown}
        className="custom-frame"
        viewportClassName="custom-viewport"
      >
        <p>Item row</p>
      </SheetScrollArea>
    );

    const viewport = screen.getByRole('tabpanel');
    expect(scrollRef.current).toBe(viewport);
    expect(viewport.id).toBe('results-panel');
    expect(viewport.getAttribute('aria-labelledby')).toBe('results-tab');
    expect(viewport.getAttribute('data-y-scrollbar-width')).toBe('0');
    expect(viewport.className).toContain('dialog-scroll-viewport');
    expect(viewport.className).toContain('custom-viewport');
    expect(viewport.className).not.toContain('dialog-scroll-chain');
    expect(viewport.parentElement?.className).toContain('dialog-scroll-frame');
    expect(viewport.parentElement?.className).toContain('custom-frame');

    const scrollbar = screen.getByRole('scrollbar');
    expect(scrollbar.getAttribute('tabindex')).toBe('-1');
    expect(scrollbar.getAttribute('aria-controls')).toBe('results-panel');
    expect(scrollbar.className).toContain('dialog-scrollbar');
    expect(viewport.contains(scrollbar)).toBe(true);

    fireEvent.keyDown(viewport, { key: 'ArrowDown' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    cleanup();

    const callbackRef = vi.fn();
    render(
      <SheetScrollArea scrollRef={callbackRef} chainOverscroll>
        <p>Chained row</p>
      </SheetScrollArea>
    );

    const chainedViewport = screen.getByText('Chained row').parentElement?.parentElement;
    expect(callbackRef).toHaveBeenCalledWith(chainedViewport);
    expect(chainedViewport?.className).toContain('dialog-scroll-chain');
    expect(screen.getByRole('scrollbar').getAttribute('aria-controls')).toBe(chainedViewport?.id);
  });
});
