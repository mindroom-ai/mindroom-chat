import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Scroll, Text } from 'folds';
import { describe, expect, it, vi } from 'vitest';
import { CanvasHeaderButton, CanvasMenu } from './CanvasHeaderButton';
import { Trigger } from './CanvasHeaderButton.css';
import type { CanvasListEntry } from './canvasIndexStore';

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? content : null,
  TooltipProvider: ({
    tooltip,
    children,
  }: {
    tooltip: React.ReactNode;
    children: (ref: () => void) => React.ReactNode;
  }) => (
    <>
      {tooltip}
      {children(() => undefined)}
    </>
  ),
}));

const canvas = (id: string, title: string, updatedTs: number): CanvasListEntry => ({
  canvasId: id,
  roomId: '!room:mindroom.test',
  threadId: '$thread',
  agentUserId: '@mindroom_planner:mindroom.test',
  title,
  createdTs: 1,
  revisionId: id,
  updatedTs,
  shared: false,
});

const budget = canvas('$c1', 'Budget', 3_000);
const roadmap = canvas('$c2', 'Roadmap', 2_000);
const survey = canvas('$c3', 'Survey', 1_000);

const anchor = { x: 0, y: 0, width: 32, height: 32 };
const anchorEvent = { currentTarget: { getBoundingClientRect: () => anchor } };

type ButtonProps = React.ComponentProps<typeof CanvasHeaderButton>;

const renderButton = (props: Partial<ButtonProps> = {}) => {
  const handlers = { onOpen: vi.fn(), onClose: vi.fn() };
  const all: ButtonProps = {
    canvases: [budget],
    chooser: { open: false, onOpen: vi.fn() },
    ...handlers,
    ...props,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<CanvasHeaderButton {...all} />);
  });
  return {
    renderer,
    ...handlers,
    update: (next: Partial<ButtonProps>) =>
      act(() => renderer.update(<CanvasHeaderButton {...all} {...next} />)),
  };
};

type MenuProps = React.ComponentProps<typeof CanvasMenu>;

const renderMenu = (props: Partial<MenuProps> = {}) => {
  const onChoose = vi.fn();
  const all: MenuProps = {
    anchor,
    canvases: [budget, roadmap],
    onChoose,
    requestClose: vi.fn(),
    ...props,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<CanvasMenu {...all} />);
  });
  return {
    renderer,
    onChoose,
    update: (next: Partial<MenuProps>) =>
      act(() => renderer.update(<CanvasMenu {...all} {...next} />)),
  };
};

const trigger = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'])[0]!;

const menuItems = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && !node.props['aria-label']);

const nodeText = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : nodeText(child))).join('');

/** The menu's titles in order: each item's first text is the title, the second its update time. */
const titles = (renderer: ReactTestRenderer) =>
  menuItems(renderer).map((item) => nodeText(item.findAllByType(Text)[0]!));

describe('CanvasHeaderButton', () => {
  it('renders nothing without canvases', () => {
    expect(renderButton({ canvases: [] }).renderer.toJSON()).toBeNull();
  });

  it('applies the expanded touch-target class to the canvas button', () => {
    const { renderer } = renderButton();
    expect(String(trigger(renderer).props.className).split(' ')).toContain(Trigger);
  });

  it('toggles a single canvas', async () => {
    const { renderer, onOpen, onClose, update } = renderButton({ canvases: [budget] });

    expect(trigger(renderer).props['aria-label']).toBe('Show Canvas');
    expect(trigger(renderer).props['aria-pressed']).toBe(false);
    await act(() => trigger(renderer).props.onClick(anchorEvent));
    expect(onOpen).toHaveBeenCalledWith('$c1');
    expect(onClose).not.toHaveBeenCalled();

    update({ openCanvasId: '$c1' });
    expect(trigger(renderer).props['aria-label']).toBe('Hide Canvas');
    expect(trigger(renderer).props['aria-pressed']).toBe(true);
    await act(() => trigger(renderer).props.onClick(anchorEvent));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('passes the opener to the parent and reflects its chooser state', async () => {
    const onOpen = vi.fn();
    const { renderer, update } = renderButton({
      canvases: [budget, roadmap],
      chooser: { onOpen, open: false },
    });
    expect(trigger(renderer).props).toMatchObject({
      'aria-label': 'Canvases',
      'aria-expanded': false,
    });
    await act(() => trigger(renderer).props.onClick(anchorEvent));
    expect(onOpen).toHaveBeenCalledWith(anchorEvent.currentTarget);
    update({ chooser: { onOpen, open: true } });
    expect(trigger(renderer).props['aria-expanded']).toBe(true);
  });

  it('is not pressed while the open canvas is not one of this conversation’s', () => {
    const { renderer } = renderButton({ canvases: [budget, roadmap], openCanvasId: '$elsewhere' });
    expect(trigger(renderer).props['aria-pressed']).toBe(false);
  });
});

describe('CanvasMenu', () => {
  it('lists canvases in the given order and marks the open one', () => {
    const { renderer } = renderMenu({ canvases: [budget, roadmap, survey], openCanvasId: '$c2' });
    const items = menuItems(renderer);
    expect(titles(renderer)).toEqual(['Budget', 'Roadmap', 'Survey']);
    expect(items.map((item) => item.props['aria-current'])).toEqual([undefined, 'true', undefined]);
    // The update time is there for telling same-named canvases apart.
    const time = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
    expect(nodeText(items[0]!)).toBe(`Budget${time.format(3_000)}`);
  });

  it('keeps a long menu inside the viewport and scrolls its choices', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      canvas(`$many${index}`, `Canvas ${index}`, 30_000 - index)
    );
    const { renderer } = renderMenu({ canvases: many });
    const scroll = renderer.root.findByType(Scroll);
    expect(scroll.findAll((node) => menuItems(renderer).includes(node))).toHaveLength(30);
    let bounded: ReactTestInstance | null = scroll.parent;
    while (bounded && !bounded.props.style?.maxHeight) bounded = bounded.parent;
    expect(bounded?.props.style).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      maxHeight: expect.stringContaining('100vh'),
      maxWidth: expect.anything(),
    });
  });

  it('reports the chosen canvas to the parent', async () => {
    const { renderer, onChoose } = renderMenu();
    await act(() => menuItems(renderer)[1]!.props.onClick());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('$c2');
  });

  it('keeps the open mark on the same canvas when the list is reordered', () => {
    const { renderer, update } = renderMenu({
      canvases: [budget, roadmap, survey],
      openCanvasId: '$c2',
    });
    update({ canvases: [{ ...survey, updatedTs: 9_000, title: 'Survey v2' }, budget, roadmap] });
    expect(titles(renderer)).toEqual(['Survey v2', 'Budget', 'Roadmap']);
    expect(menuItems(renderer).map((item) => item.props['aria-current'])).toEqual([
      undefined,
      undefined,
      'true',
    ]);
  });
});
