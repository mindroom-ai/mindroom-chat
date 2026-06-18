/* eslint-disable react/prop-types */
import React from 'react';
import { create, ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MindroomThreadSummaryCard } from './MindroomThreadSummaryCard';

const chipMock = vi.fn(({ children }: { children?: React.ReactNode }) =>
  React.createElement('button', { 'data-chip': true }, children)
);
const timeMock = vi.fn(({ ts }: { ts: number }) => React.createElement('time', null, `time-${ts}`));

vi.mock('folds', () => ({
  Box: ({
    as: Tag = 'div',
    children,
    ...props
  }: {
    as?: keyof JSX.IntrinsicElements;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement(Tag, props, children),
  Chip: (props: { children?: React.ReactNode }) => chipMock(props),
  Icon: ({ src }: { src?: string }) => React.createElement('span', null, src ?? 'icon'),
  Icons: {
    Bulb: 'Bulb',
  },
  Text: ({ as: Tag = 'span', children, ...props }: any) =>
    React.createElement(Tag, props, children),
}));

vi.mock('../../components/message/content', () => ({
  MessageEditedContent: () => React.createElement('span', null, 'edited'),
}));

vi.mock('../../components/message/layout', () => ({
  MessageTextBody: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('p', props, children),
}));

vi.mock('../../components/message/Time', () => ({
  Time: (props: { ts: number }) => timeMock(props),
}));

vi.mock('./MindroomThreadSummaryCard.css', () => ({
  ThreadSummaryCard: 'ThreadSummaryCard',
  ThreadSummaryHeader: 'ThreadSummaryHeader',
  ThreadSummaryLabel: 'ThreadSummaryLabel',
  ThreadSummaryMeta: 'ThreadSummaryMeta',
  ThreadSummaryBody: 'ThreadSummaryBody',
  ThreadSummaryBodyCompact: 'ThreadSummaryBodyCompact',
}));

const getNodeText = (value: ReactTestInstance | string): string => {
  if (typeof value === 'string') return value;
  return value.children.map((child) => getNodeText(child as ReactTestInstance | string)).join('');
};

describe('MindroomThreadSummaryCard', () => {
  it('renders compact non-interactive AI summary provenance', () => {
    const renderer = create(
      React.createElement(MindroomThreadSummaryCard, {
        summaryInfo: {
          summaryText: 'Deployment completed and health checks passed.',
          messageCount: 3,
          generatedTs: 1_775_000_000_000,
        },
        compact: true,
        renderBody: ({ body }: { body: string }) => React.createElement('span', null, body),
      })
    );

    const text = getNodeText(renderer.root);

    expect(text).toContain('AI summary');
    expect(text).toContain('Generated from last 3 messages');
    expect(text).toContain('Deployment completed and health checks passed.');
    expect(chipMock).not.toHaveBeenCalled();
    expect(timeMock).not.toHaveBeenCalled();

    renderer.unmount();
  });
});
