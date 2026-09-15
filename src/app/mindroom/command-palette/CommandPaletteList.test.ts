import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CommandPaletteList, type CommandPaletteListSection } from './CommandPaletteList';

vi.mock('./CommandPalette.css', () => ({
  Palette: 'Palette',
  Search: 'Search',
  Input: 'Input',
  Close: 'Close',
  Filters: 'Filters',
  Filter: 'Filter',
  Prefix: 'Prefix',
  Results: 'Results',
  Group: 'Group',
  GroupTitle: 'GroupTitle',
  GroupCount: 'GroupCount',
  Row: 'Row',
  RowIcon: 'RowIcon',
  RowText: 'RowText',
  RowTitle: 'RowTitle',
  RowDescription: 'RowDescription',
  RowEnter: 'RowEnter',
  Key: 'Key',
  Footer: 'Footer',
  KeyboardHints: 'KeyboardHints',
  Hint: 'Hint',
  Empty: 'Empty',
  EmptyTitle: 'EmptyTitle',
  EmptyDescription: 'EmptyDescription',
}));

vi.mock('folds', () => ({ Icon: () => null, Icons: { Hash: 'hash', Terminal: 'terminal' } }));

const ROOM_SECTION: CommandPaletteListSection = {
  id: 'rooms',
  title: 'Rooms',
  items: [{ id: '!general:example.org', kind: 'room', name: 'General', topic: 'Team chat' }],
};
const renderList = (props: Partial<React.ComponentProps<typeof CommandPaletteList>> = {}) =>
  create(
    React.createElement(CommandPaletteList, {
      id: 'results',
      label: 'Search results',
      sections: [ROOM_SECTION],
      onSelect: vi.fn(),
      onHighlight: vi.fn(),
      ...props,
    })
  );

describe('CommandPaletteList', () => {
  it('gives each result group a visible accessible category label', () => {
    const renderer = renderList();
    const group = renderer.root.findByProps({ role: 'group' });
    const label = renderer.root.findByProps({ id: group.props['aria-labelledby'] });
    expect(label.children).toContain('Rooms');
    expect(JSON.stringify(renderer.toJSON())).toContain('Team chat');
  });

  it('exposes selection without putting every result in the Tab order', () => {
    const renderer = renderList({ selectedItemId: '!general:example.org' });
    const row = renderer.root.findByProps({ role: 'option' });
    expect(row.props['aria-selected']).toBe(true);
    expect(row.props.tabIndex).toBe(-1);
  });

  it('opens the clicked result', () => {
    const onSelect = vi.fn();
    const renderer = renderList({ onSelect });
    renderer.root.findByProps({ role: 'option' }).props.onClick();
    expect(onSelect).toHaveBeenCalledWith(ROOM_SECTION.items[0]);
  });

  it('does not change keyboard selection when a touch pointer scrolls the list', () => {
    const onHighlight = vi.fn();
    const renderer = renderList({ onHighlight });
    renderer.root.findByProps({ role: 'option' }).props.onPointerMove({ pointerType: 'touch' });
    expect(onHighlight).not.toHaveBeenCalled();
  });
});
