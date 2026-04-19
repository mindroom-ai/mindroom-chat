import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CommandPaletteList, type CommandPaletteListSection } from './CommandPaletteList';
import type { CommandPaletteItem } from './commandPaletteTypes';

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Box: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) => reactModule.createElement('div', props, children),
    Text: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement>) => reactModule.createElement('span', props, children),
    Line: (props: React.HTMLAttributes<HTMLHRElement>) => reactModule.createElement('hr', props),
    Icon: ({
      src,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement> & { src?: string }) =>
      reactModule.createElement('span', { ...props, 'data-icon-src': src }),
    Icons: {
      Terminal: 'terminal',
      Message: 'message',
      Hash: 'hash',
      Space: 'space',
      User: 'user',
      Search: 'search',
    },
    color: {
      Warning: { Main: 'warning-main' },
      Primary: { Main: 'primary-main' },
      Success: { Main: 'success-main' },
      Secondary: { Main: 'secondary-main' },
      SurfaceVariant: {
        OnContainer: 'surface-variant-on-container',
        ContainerHover: 'surface-variant-container-hover',
      },
    },
  };
});

const ROOM_SECTION: CommandPaletteListSection = {
  id: 'rooms',
  title: 'Rooms',
  items: [
    {
      id: '!general:example.org',
      kind: 'room',
      name: 'General',
      topic: 'Team chat',
    },
  ],
};

const renderList = (props: Partial<React.ComponentProps<typeof CommandPaletteList>> = {}) =>
  create(
    React.createElement(CommandPaletteList, {
      sections: [ROOM_SECTION],
      onSelect: vi.fn(),
      ...props,
    })
  );

describe('CommandPaletteList', () => {
  it('labels room rows with the shared rooms category metadata', () => {
    const renderer = renderList();
    const row = renderer.root.findByProps({ 'data-item-id': '!general:example.org' });
    const icon = renderer.root.findByProps({ 'data-icon-src': 'hash' });

    expect(row.props['data-category']).toBe('rooms');
    expect(row.props.style.borderLeft).toBe('4px solid success-main');
    expect(icon.props['data-icon-src']).toBe('hash');
  });

  it('keeps the selected-row background while preserving the category accent', () => {
    const renderer = renderList({ selectedItemId: '!general:example.org' });
    const row = renderer.root.findByProps({ 'data-item-id': '!general:example.org' });

    expect(row.props['data-selected']).toBe(true);
    expect(row.props.style.backgroundColor).toBe('surface-variant-container-hover');
    expect(row.props.style.borderLeft).toBe('4px solid success-main');
  });

  it('drops redundant section-title text while keeping the room row content', () => {
    const renderer = renderList();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('General');
    expect(text).toContain('Team chat');
    expect(text).not.toContain('Rooms');
  });

  it('falls back cleanly when an item kind has no mapped category presentation', () => {
    const unknownItem = {
      id: 'custom-item',
      kind: 'custom',
      title: 'Custom row',
      description: 'Fallback rendering',
    } as unknown as CommandPaletteItem;
    const renderer = renderList({
      sections: [
        {
          id: 'actions',
          title: 'Actions',
          items: [unknownItem],
        },
      ],
    });
    const row = renderer.root.findByProps({ 'data-item-id': 'custom-item' });

    expect(row.props['data-category']).toBe('unknown');
    expect(row.props.style.borderLeft).toBeUndefined();
    expect(renderer.root.findAllByProps({ 'data-category-icon': 'custom' })).toHaveLength(0);
  });
});
