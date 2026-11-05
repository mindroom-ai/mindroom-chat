// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteAutocompleteMenu } from './InviteAutocompleteMenu';

// The pop-out the menu last rendered, and how often; it portals its content like folds' does,
// so the list sits outside the trap's element.
const popOut = vi.hoisted(() => ({ renders: 0, props: {} as Record<string, unknown> }));

vi.mock('folds', async (original) => {
  const { createPortal } = await import('react-dom');
  return {
    ...(await original<typeof import('folds')>()),
    PopOut: ({ content, ...props }: { content?: ReactNode; anchor?: unknown }) => {
      popOut.renders += 1;
      popOut.props = props;
      return props.anchor ? createPortal(content, document.body) : null;
    },
  };
});
// The real focus trap, so its deactivation reports come as late as they do in the app. jsdom lays
// nothing out, so every element counts as shown for it.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});
vi.mock('../../ui/page/PageScroll', () => ({
  PageScroll: (props: {
    header?: ReactNode;
    children?: ReactNode;
    scrollbarTabIndex?: number;
    onKeyDown?: React.KeyboardEventHandler;
  }) => (
    <div data-scrollbar-tab-index={props.scrollbarTabIndex} onKeyDown={props.onKeyDown}>
      {props.header}
      {props.children}
    </div>
  ),
}));
vi.mock('./InviteAutocompleteMenu.css', () => ({
  InviteAutocompleteMenuRoot: 'InviteAutocompleteMenuRoot',
  InviteAutocompletePopOut: 'InviteAutocompletePopOut',
  InviteAutocompleteMenuContainer: 'InviteAutocompleteMenuContainer',
  InviteAutocompleteMenu: 'InviteAutocompleteMenu',
  InviteAutocompleteMenuHeader: 'InviteAutocompleteMenuHeader',
}));

type Box = { x: number; y: number; width: number; height: number };
// Where the search field's box is; tests move it.
let field: Box;
let fieldReads: number;

type MenuProps = { open: boolean; requestClose?: () => void; input?: ReactNode };

function People({ open, requestClose = vi.fn(), input }: MenuProps) {
  return (
    <InviteAutocompleteMenu
      open={open}
      requestClose={requestClose}
      input={input ?? <input aria-label="Invite search" />}
      headerContent="2 matching users"
      menuId="invite-people"
      menuLabel="People"
    >
      <button type="button" role="option" aria-selected>
        Alice Adams
      </button>
      <button type="button" role="option" aria-selected={false}>
        Bea Novak
      </button>
    </InviteAutocompleteMenu>
  );
}

const listbox = () => screen.queryByRole('listbox', { name: 'People' });
const anchor = () => popOut.props.anchor as Box | undefined;
/** Runs focus-trap's deactivation reports, which wait one macrotask. */
const runTrapReports = () =>
  act(() => {
    vi.runOnlyPendingTimers();
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  popOut.renders = 0;
  popOut.props = {};
  field = { x: 24, y: 100, width: 320, height: 40 };
  fieldReads = 0;
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => 768,
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function read(
    this: Element
  ) {
    const box = this.classList.contains('InviteAutocompleteMenuRoot')
      ? field
      : { x: 0, y: 0, width: 0, height: 0 };
    if (box === field) fieldReads += 1;
    const { x, y, width, height } = box;
    return { ...box, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => box };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
});

describe('InviteAutocompleteMenu', () => {
  it('floats the list under the field at its width and no taller than the room below', () => {
    render(<People open />);

    expect(popOut.props).toMatchObject({
      anchor: { x: 24, y: 100, width: 320, height: 40 },
      position: 'Bottom',
      align: 'Start',
      offset: 8,
      className: 'InviteAutocompletePopOut',
    });
    const list = listbox();
    expect(list?.id).toBe('invite-people');
    expect(list?.classList).toContain('InviteAutocompleteMenu');
    expect(list?.classList).toContain('glass-dense-over-backdrop');
    // 628 px below the field, but at most 52% of the 768 px viewport.
    expect(list?.style.maxHeight).toBe('399px');
    expect(list?.parentElement?.className).toBe('InviteAutocompleteMenuContainer');
    expect(list?.parentElement?.style.width).toBe('320px');
    expect(screen.getByText('2 matching users').closest('header')?.className).toContain(
      'InviteAutocompleteMenuHeader'
    );
    const scroll = list?.querySelector('[data-scrollbar-tab-index]');
    expect(scroll?.getAttribute('data-scrollbar-tab-index')).toBe('-1');
    const rows = screen.getAllByRole('option');
    expect(rows.map((row) => row.textContent)).toEqual(['Alice Adams', 'Bea Novak']);
    // Arrow keys inside the list scroll nothing; the field keeps them. The key test reads the
    // key code, as browsers set it.
    const alice = screen.getByRole('option', { name: 'Alice Adams' });
    expect(fireEvent.keyDown(alice, { key: 'ArrowDown', keyCode: 40, which: 40 })).toBe(false);
  });

  it('opens above the field when only that side has room', () => {
    field = { ...field, y: 700 };
    render(<People open />);

    expect(popOut.props.position).toBe('Top');
  });

  it('renders no list and gives the pop-out no anchor while closed', () => {
    const { rerender } = render(<People open={false} />);

    expect(anchor()).toBeUndefined();
    expect(listbox()).toBeNull();

    rerender(<People open />);
    expect(listbox()).not.toBeNull();

    rerender(<People open={false} />);
    expect(anchor()).toBeUndefined();
    expect(listbox()).toBeNull();
  });

  it('follows the field through scrolling containers and resizes, and stops once closed', () => {
    const { rerender } = render(<People open />);
    const scroller = document.createElement('div');
    document.body.append(scroller);

    // A container's scroll event does not bubble: only a capturing window listener hears it.
    field = { ...field, y: 60 };
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(anchor()).toMatchObject({ y: 60 });

    field = { ...field, y: 40 };
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(anchor()).toMatchObject({ y: 40 });

    rerender(<People open={false} />);
    const reads = fieldReads;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    });
    expect(fieldReads).toBe(reads);
    scroller.remove();
  });

  it('stops listening when unmounted while open', () => {
    const { unmount } = render(<People open />);
    unmount();
    const reads = fieldReads;

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));

    expect(fieldReads).toBe(reads);
  });

  it('keeps the anchor and renders nothing when a scroll moves nothing', () => {
    render(<People open />);
    const before = anchor();
    const renders = popOut.renders;

    act(() => {
      listbox()?.dispatchEvent(new Event('scroll'));
    });

    expect(fieldReads).toBeGreaterThan(1);
    expect(anchor()).toBe(before);
    expect(popOut.renders).toBe(renders);
  });

  it('asks to close after Escape and keeps the key from the dialog around it', () => {
    const requestClose = vi.fn();
    const outerEscape = vi.fn();
    window.addEventListener('keydown', outerEscape);
    render(<People open requestClose={requestClose} />);

    fireEvent.keyDown(screen.getByLabelText('Invite search'), { key: 'Escape' });
    expect(outerEscape).not.toHaveBeenCalled();
    expect(requestClose).not.toHaveBeenCalled();
    runTrapReports();

    expect(requestClose).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', outerEscape);
  });

  it.each([
    ['the field used it', { key: 'Escape' }, true],
    ['an input method is composing', { key: 'Escape', isComposing: true }, false],
  ])('leaves Escape alone when %s', (_case, init, fieldUsesKey) => {
    const requestClose = vi.fn();
    const outerEscape = vi.fn();
    window.addEventListener('keydown', outerEscape);
    const input = (
      <input
        aria-label="Invite search"
        onKeyDown={(event) => {
          if (fieldUsesKey) event.preventDefault();
        }}
      />
    );
    render(<People open requestClose={requestClose} input={input} />);

    fireEvent.keyDown(screen.getByLabelText('Invite search'), init);
    runTrapReports();

    expect(outerEscape).toHaveBeenCalledTimes(1);
    expect(requestClose).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outerEscape);
  });

  it('asks to close after a press outside, which still reaches its target', () => {
    const requestClose = vi.fn();
    const outside = document.createElement('button');
    document.body.append(outside);
    render(<People open requestClose={requestClose} />);

    expect(fireEvent.mouseDown(outside)).toBe(true);
    runTrapReports();

    expect(requestClose).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it('counts a press in the portaled list as inside', () => {
    const requestClose = vi.fn();
    render(<People open requestClose={requestClose} />);

    expect(fireEvent.mouseDown(screen.getByRole('option', { name: 'Bea Novak' }))).toBe(true);
    runTrapReports();

    expect(requestClose).not.toHaveBeenCalled();
  });

  it('calls the newest requestClose', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<People open requestClose={first} />);
    rerender(<People open requestClose={second} />);

    fireEvent.keyDown(screen.getByLabelText('Invite search'), { key: 'Escape' });
    runTrapReports();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not ask to close when the parent closes or unmounts the list', () => {
    const requestClose = vi.fn();
    const { rerender, unmount } = render(<People open requestClose={requestClose} />);

    rerender(<People open={false} requestClose={requestClose} />);
    runTrapReports();
    rerender(<People open requestClose={requestClose} />);
    unmount();
    runTrapReports();

    expect(requestClose).not.toHaveBeenCalled();
  });

  it('keeps a list the parent reopened before the late report of its close', () => {
    const requestClose = vi.fn();
    const { rerender } = render(<People open requestClose={requestClose} />);

    rerender(<People open={false} requestClose={requestClose} />);
    rerender(<People open requestClose={requestClose} />);
    runTrapReports();

    expect(requestClose).not.toHaveBeenCalled();
    expect(listbox()).not.toBeNull();

    // The reopened list still reports its own dismissal.
    fireEvent.keyDown(screen.getByLabelText('Invite search'), { key: 'Escape' });
    runTrapReports();
    expect(requestClose).toHaveBeenCalledTimes(1);
  });
});
