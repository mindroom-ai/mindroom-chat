// @vitest-environment jsdom
/* eslint-disable react/prop-types */
import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKER_DETAILS_CLOSE_DELAY_MS, ThreadSummaryMarker } from './ThreadSummaryMarker';

vi.mock('folds', () => ({
  Box: ({ as: Tag = 'div', children, ...props }: any) => React.createElement(Tag, props, children),
  Text: ({ as: Tag = 'span', children, size, priority, ...props }: any) =>
    React.createElement(Tag, props, children),
  Tooltip: React.forwardRef(({ children, ...props }: any, ref) =>
    React.createElement('div', { ...props, ref, 'data-tooltip': true }, children)
  ),
  PopOut: ({ anchor, content, position, align, offset, ...props }: any) =>
    anchor
      ? React.createElement('div', { ...props, 'data-popout': true, 'data-top': anchor.y }, content)
      : null,
}));

vi.mock('@tabler/icons-react', () => ({
  IconSparkles: () => React.createElement('svg'),
}));

vi.mock('./ThreadSummaryMarker.css', () => ({
  Marker: 'Marker',
  MarkerTrigger: 'MarkerTrigger',
  MarkerDetails: 'MarkerDetails',
  MarkerSettingsLink: 'MarkerSettingsLink',
}));

const text = (value: ReactTestInstance | string): string =>
  typeof value === 'string' ? value : value.children.map(text).join('');

const summaryInfo = { summaryText: 'Fixing token refresh', messageCount: 21 };
const triggerRect = { x: 10, y: 20, width: 100, height: 16 };
const renderers: ReactTestRenderer[] = [];
// Real elements stand in for the rendered ones, so a test can point events at them; the card
// holds its link as the real card does.
let nodes: { trigger?: HTMLElement; card?: HTMLElement; link?: HTMLElement } = {};
const nodeMock = (element: React.ReactElement<Record<string, unknown>>) => {
  const node = document.createElement(typeof element.type === 'string' ? element.type : 'div');
  node.getBoundingClientRect = () => ({ ...triggerRect } as DOMRect);
  vi.spyOn(node, 'focus');
  if (element.props.className === 'MarkerTrigger') nodes.trigger = node;
  if (element.props.className === 'MarkerSettingsLink') nodes.link = node;
  if (element.props.role === 'dialog') {
    nodes.card = node;
    if (nodes.link) node.append(nodes.link);
    document.body.append(node);
  }
  return node;
};
const render = (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element, { createNodeMock: nodeMock });
  });
  renderers.push(renderer);
  return renderer;
};
const trigger = (renderer: ReactTestRenderer) =>
  renderer.root.findByProps({ className: 'MarkerTrigger' });
const popout = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-popout'] === true);

afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
  nodes.card?.remove();
  nodes = {};
  vi.useRealTimers();
});

describe('ThreadSummaryMarker', () => {
  it('says the AI titled the thread for its first summary', () => {
    const renderer = render(
      <ThreadSummaryMarker summaryInfo={summaryInfo} plan={{ first: true }} />
    );

    expect(text(trigger(renderer))).toBe('AI titled this thread');
  });

  it('says the AI updated the title for a later summary', () => {
    const renderer = render(
      <ThreadSummaryMarker summaryInfo={summaryInfo} plan={{ first: false }} />
    );

    expect(text(trigger(renderer))).toBe('AI title updated');
  });

  it('says the title was edited for a manual summary', () => {
    const renderer = render(
      <ThreadSummaryMarker
        summaryInfo={{ ...summaryInfo, isManual: true }}
        plan={{ first: false }}
      />
    );

    expect(text(trigger(renderer))).toBe('Title edited');
  });

  it('keeps the full title out of view until opened', () => {
    const renderer = render(<ThreadSummaryMarker summaryInfo={summaryInfo} />);

    expect(text(trigger(renderer))).toBe('AI title updated');
    expect(popout(renderer)).toHaveLength(0);
    expect(trigger(renderer).props['aria-expanded']).toBe(false);
  });

  it('shows the new title, its provenance and the old title when tapped', async () => {
    const renderer = render(
      <ThreadSummaryMarker
        summaryInfo={summaryInfo}
        plan={{ first: false, previousSummaryText: 'Push bug' }}
      />
    );

    await act(() => trigger(renderer).props.onClick());

    const details = text(popout(renderer)[0]!);
    expect(details).toContain('AI summary of last 21 messages');
    expect(details).toContain('Fixing token refresh');
    expect(details).toContain('Was: Push bug');
    expect(trigger(renderer).props['aria-expanded']).toBe(true);

    await act(() => trigger(renderer).props.onClick());
    expect(popout(renderer)).toHaveLength(0);
  });

  it('lets the pointer through to the marker and timeline while open', async () => {
    const renderer = render(<ThreadSummaryMarker summaryInfo={summaryInfo} />);

    await act(() => trigger(renderer).props.onClick());

    // folds' PopOut layer covers the screen; a tooltip must not take input.
    const [layer] = popout(renderer);
    expect(layer!.props.style).toEqual({ pointerEvents: 'none' });
    // The tooltip inside has the role, not the layer in the body, which index.css hides on
    // touch screens.
    expect(layer?.props.role).toBeUndefined();
    const card = layer!.findByProps({ 'data-tooltip': true });
    expect(card.props.role).toBe('tooltip');
    expect(card.props.style).toBeUndefined();
    expect(renderer.root.findAllByType('button')).toHaveLength(1);
    expect(trigger(renderer).props['aria-haspopup']).toBeUndefined();
    expect(layer!.props['data-owns-focus']).toBeUndefined();
  });

  it('opens while a mouse hovers and closes when it leaves', async () => {
    const renderer = render(<ThreadSummaryMarker summaryInfo={summaryInfo} />);

    await act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' }));
    expect(popout(renderer)).toHaveLength(1);

    await act(() => trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' }));
    expect(popout(renderer)).toHaveLength(0);
  });

  it('does not open from a touch pointer entering, only from the tap', async () => {
    const renderer = render(<ThreadSummaryMarker summaryInfo={summaryInfo} />);

    await act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'touch' }));
    expect(popout(renderer)).toHaveLength(0);
  });

  it('closes on Escape and on a tap elsewhere', async () => {
    const renderer = render(<ThreadSummaryMarker summaryInfo={summaryInfo} />);

    await act(() => trigger(renderer).props.onClick());
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      document.dispatchEvent(escape);
    });
    expect(popout(renderer)).toHaveLength(0);
    // The room's Escape (focus the composer) still runs.
    expect(escape.defaultPrevented).toBe(false);

    await act(() => trigger(renderer).props.onClick());
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(popout(renderer)).toHaveLength(0);
  });

  it('closes when keyboard focus moves on', async () => {
    const renderer = render(<ThreadSummaryMarker summaryInfo={summaryInfo} />);

    await act(() => trigger(renderer).props.onClick());
    await act(() => trigger(renderer).props.onBlur({ relatedTarget: document.body }));

    expect(popout(renderer)).toHaveLength(0);
  });

  it('stays open and follows the marker when the timeline moves it', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const renderer = render(<ThreadSummaryMarker summaryInfo={summaryInfo} />);

    await act(() => trigger(renderer).props.onClick());
    expect(popout(renderer)[0]!.props['data-top']).toBe(20);
    triggerRect.y = 140;
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(popout(renderer)).toHaveLength(1);
    expect(popout(renderer)[0]!.props['data-top']).toBe(140);
    triggerRect.y = 20;
  });

  it('describes the marker with the full title for screen readers', () => {
    const renderer = render(
      <ThreadSummaryMarker
        summaryInfo={summaryInfo}
        plan={{ first: false, previousSummaryText: 'Push bug' }}
      />
    );

    const describedBy = trigger(renderer).props['aria-describedby'];
    const description = renderer.root.find((node) => node.props.id === describedBy);
    expect(text(description)).toContain('Fixing token refresh');
    expect(text(description)).toContain('Was: Push bug');
  });

  describe('with a way to open the title settings', () => {
    const renderWithSettings = (onOpenSettings = vi.fn()) =>
      render(<ThreadSummaryMarker summaryInfo={summaryInfo} onOpenSettings={onOpenSettings} />);
    const card = (renderer: ReactTestRenderer) =>
      renderer.root.findByProps({ 'data-tooltip': true });
    const link = (renderer: ReactTestRenderer) =>
      renderer.root.findByProps({ className: 'MarkerSettingsLink' });
    const keyDown = (key: string, shiftKey = false) => ({ key, shiftKey, preventDefault: vi.fn() });
    // A real Tab pressed in the card, which bubbles to the card's document listener.
    const tabIn = (target: HTMLElement, shiftKey = false) => {
      const evt = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        target.dispatchEvent(evt);
      });
      return evt;
    };
    const mouse = { pointerType: 'mouse' };

    it('shows no button beside the marker, only the marker itself', () => {
      const renderer = renderWithSettings();

      expect(renderer.root.findAllByType('button')).toHaveLength(1);
      expect(text(trigger(renderer))).toBe('AI title updated');
    });

    it('opens a card the pointer can enter, a dialog with a Title settings link', async () => {
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onClick());

      const [layer] = popout(renderer);
      // The layer still lets the pointer through; only the card takes it.
      expect(layer!.props.style).toEqual({ pointerEvents: 'none' });
      expect(card(renderer).props.style).toEqual({ pointerEvents: 'auto' });
      expect(card(renderer).props.role).toBe('dialog');
      // The marker moves this focus itself; the app's overlay focus must not move it into the
      // link as the card opens from Enter, which made Tab go on from the link (lib/overlayFocus).
      expect(layer!.props['data-owns-focus']).toBe('');
      expect(card(renderer).props['aria-label']).toBe('AI title updated');
      expect(trigger(renderer).props['aria-haspopup']).toBe('dialog');
      expect(trigger(renderer).props['aria-controls']).toBe(card(renderer).props.id);
      // A native button, so Enter and Space press it as a click does.
      expect(link(renderer).props.type).toBe('button');
      expect(text(link(renderer))).toBe('Title settings…');
    });

    it('closes the card and opens the settings from the link', async () => {
      const onOpenSettings = vi.fn();
      const renderer = renderWithSettings(onOpenSettings);

      await act(() => trigger(renderer).props.onClick());
      await act(() => link(renderer).props.onClick());

      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      expect(popout(renderer)).toHaveLength(0);
    });

    it('waits for the pointer to reach the card before closing', async () => {
      vi.useFakeTimers();
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onPointerEnter(mouse));
      await act(() => trigger(renderer).props.onPointerLeave(mouse));
      act(() => {
        vi.advanceTimersByTime(MARKER_DETAILS_CLOSE_DELAY_MS - 1);
      });
      expect(popout(renderer)).toHaveLength(1);

      // The card cancels the close while the pointer is on it.
      await act(() => card(renderer).props.onPointerEnter(mouse));
      act(() => {
        vi.advanceTimersByTime(MARKER_DETAILS_CLOSE_DELAY_MS * 4);
      });
      expect(popout(renderer)).toHaveLength(1);

      await act(() => card(renderer).props.onPointerLeave(mouse));
      act(() => {
        vi.advanceTimersByTime(MARKER_DETAILS_CLOSE_DELAY_MS - 1);
      });
      expect(popout(renderer)).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(popout(renderer)).toHaveLength(0);
    });

    it('stays pinned after a click when the pointer leaves', async () => {
      vi.useFakeTimers();
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onPointerEnter(mouse));
      await act(() => trigger(renderer).props.onClick());
      await act(() => trigger(renderer).props.onPointerLeave(mouse));
      act(() => {
        vi.advanceTimersByTime(MARKER_DETAILS_CLOSE_DELAY_MS * 4);
      });

      expect(popout(renderer)).toHaveLength(1);
    });

    it('takes Tab from the marker into the link without closing', async () => {
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onClick());
      const tab = keyDown('Tab');
      act(() => {
        trigger(renderer).props.onKeyDown(tab);
      });
      expect(tab.preventDefault).toHaveBeenCalled();
      expect(nodes.link!.focus).toHaveBeenCalled();
      await act(() => trigger(renderer).props.onBlur({ relatedTarget: nodes.link }));
      expect(popout(renderer)).toHaveLength(1);

      // Shift+Tab from the link goes back to the marker, which keeps the card.
      const back = tabIn(nodes.link!, true);
      expect(back.defaultPrevented).toBe(true);
      expect(nodes.trigger!.focus).toHaveBeenCalled();
      await act(() => card(renderer).props.onBlur({ relatedTarget: nodes.trigger }));
      expect(popout(renderer)).toHaveLength(1);

      // Focus that leaves both closes it.
      await act(() => card(renderer).props.onBlur({ relatedTarget: document.body }));
      expect(popout(renderer)).toHaveLength(0);
    });

    it('goes on from the marker on a plain Tab from the link', async () => {
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onClick());
      const tab = tabIn(nodes.link!);

      // The browser's own Tab then moves on from the marker, past the card in the body.
      expect(nodes.trigger!.focus).toHaveBeenCalled();
      expect(tab.defaultPrevented).toBe(false);
    });

    it('keeps the card when Tab reaches the link while a pointer close is pending', async () => {
      vi.useFakeTimers();
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onPointerEnter(mouse));
      await act(() => trigger(renderer).props.onPointerLeave(mouse));
      act(() => {
        trigger(renderer).props.onKeyDown(keyDown('Tab'));
      });
      expect(nodes.link!.focus).toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(MARKER_DETAILS_CLOSE_DELAY_MS * 4);
      });
      expect(popout(renderer)).toHaveLength(1);

      // Pinned now: the pointer leaving the card does not start another close.
      await act(() => card(renderer).props.onPointerLeave(mouse));
      act(() => {
        vi.advanceTimersByTime(MARKER_DETAILS_CLOSE_DELAY_MS * 4);
      });
      expect(popout(renderer)).toHaveLength(1);
    });

    it('keeps the card while its link has focus and the pointer leaves', async () => {
      vi.useFakeTimers();
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onPointerEnter(mouse));
      await act(() => trigger(renderer).props.onPointerLeave(mouse));
      await act(() => card(renderer).props.onPointerEnter(mouse));
      await act(() => card(renderer).props.onFocus());
      await act(() => card(renderer).props.onPointerLeave(mouse));
      act(() => {
        vi.advanceTimersByTime(MARKER_DETAILS_CLOSE_DELAY_MS * 4);
      });

      expect(popout(renderer)).toHaveLength(1);
    });

    it('counts a press in the card as inside and keeps focus where it is', async () => {
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onClick());
      act(() => {
        nodes.link!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(popout(renderer)).toHaveLength(1);

      // Without the focus moving, the marker does not blur to nothing under the press (Safari).
      const press = { preventDefault: vi.fn() };
      card(renderer).props.onMouseDown(press);
      expect(press.preventDefault).toHaveBeenCalled();

      act(() => {
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(popout(renderer)).toHaveLength(0);
    });

    it('closes on Escape and gives focus in the card back to the marker', async () => {
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onClick());
      act(() => {
        nodes.link!.focus();
      });
      expect(document.activeElement).toBe(nodes.link);
      const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      act(() => {
        document.dispatchEvent(escape);
      });

      expect(popout(renderer)).toHaveLength(0);
      expect(nodes.trigger!.focus).toHaveBeenCalled();
      // The room's Escape (focus the composer) skips it, or it would take that focus away.
      expect(escape.defaultPrevented).toBe(true);

      // With the card closed, Escape is the room's again.
      const later = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      document.dispatchEvent(later);
      expect(later.defaultPrevented).toBe(false);
    });

    it('closes a hovered card on Escape and leaves the room its Escape', async () => {
      const renderer = renderWithSettings();

      await act(() => trigger(renderer).props.onPointerEnter(mouse));
      expect(popout(renderer)).toHaveLength(1);
      const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      act(() => {
        document.dispatchEvent(escape);
      });

      expect(popout(renderer)).toHaveLength(0);
      // Focus is not in the card, so nothing goes back to the marker, and the room's Escape
      // (focus the composer) runs as it did for the plain tooltip.
      expect(escape.defaultPrevented).toBe(false);
      expect(nodes.trigger!.focus).not.toHaveBeenCalled();
    });
  });
});
