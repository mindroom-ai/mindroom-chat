import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { RoomThreadOverview } from './RoomThreadOverview';

const { passthrough } = vi.hoisted(() => ({
  passthrough: 'div',
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Box: passthrough,
    Chip: passthrough,
    Text: passthrough,
  };
});

vi.mock('./RoomThreadOverview.css', () => ({
  Overview: 'Overview',
  FilterRow: 'FilterRow',
}));

describe('RoomThreadOverview', () => {
  it('uses the controlled filter state for chip selection and callbacks', () => {
    const onFilterChange = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        counts: {
          unresolved: 1,
          resolved: 1,
          all: 2,
        },
        filter: 'resolved',
        onFilterChange,
      })
    );

    const unresolvedChip = renderer.root.find(
      (node) => node.props['aria-label'] === 'Show unresolved threads (1)'
    );
    const resolvedChip = renderer.root.find(
      (node) => node.props['aria-label'] === 'Show resolved threads (1)'
    );
    const allChip = renderer.root.find((node) => node.props['aria-label'] === 'Show all threads (2)');

    expect(unresolvedChip.props['aria-pressed']).toBe(false);
    expect(resolvedChip.props['aria-pressed']).toBe(true);
    expect(allChip.props['aria-pressed']).toBe(false);

    act(() => {
      unresolvedChip.props.onClick();
    });

    expect(onFilterChange).toHaveBeenCalledWith('unresolved');

    renderer.unmount();
  });

  it('shows the provided visible thread counts', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        counts: {
          unresolved: 0,
          resolved: 0,
          all: 0,
        },
        filter: 'all',
        onFilterChange: vi.fn(),
      })
    );

    expect(renderer.root.findAll((node) => node.children.includes('Unresolved (0)'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Resolved (0)'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('All (0)'))).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('Filter the room timeline by thread status.');

    renderer.unmount();
  });
});
