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
    Spinner: passthrough,
    Text: passthrough,
    color: {
      ...actual.color,
      Critical: {
        ...actual.color.Critical,
        Main: '#f00',
      },
    },
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

  it('renders exact count labels from props', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        counts: {
          unresolved: 0,
          resolved: 2,
          all: 2,
        },
        filter: 'all',
        onFilterChange: vi.fn(),
      })
    );

    const renderedText = JSON.stringify(renderer.toJSON());

    expect(renderedText).toContain('Counts reflect currently loaded thread roots.');
    expect(renderedText).toContain('Unresolved (0)');
    expect(renderedText).toContain('Resolved (2)');
    expect(renderedText).toContain('All (2)');

    renderer.unmount();
  });
});
