/* eslint-disable react/prop-types */
import { readFileSync } from 'node:fs';
import React from 'react';
import { create, ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ThreadSummaryCard } from './ThreadSummaryCard';
import { getThreadSummaryInfo } from '../../matrix/protocol/threadSummary';

const cssSource = () =>
  readFileSync(new URL('./ThreadSummaryCard.css.ts', import.meta.url), 'utf8');

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

vi.mock('../content/FallbackContent', () => ({
  MessageEditedContent: () => React.createElement('span', null, 'edited'),
}));

vi.mock('../layout/layout', () => ({
  MessageTextBody: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('p', props, children),
}));

vi.mock('../Time', () => ({
  Time: (props: { ts: number }) => timeMock(props),
}));

vi.mock('./ThreadSummaryCard.css', () => ({
  ThreadSummaryCard: 'ThreadSummaryCard',
  ThreadSummaryHeader: 'ThreadSummaryHeader',
  ThreadSummaryLabel: 'ThreadSummaryLabel',
  ThreadSummaryBody: 'ThreadSummaryBody',
  ThreadSummaryBodyCompact: 'ThreadSummaryBodyCompact',
}));

const getNodeText = (value: ReactTestInstance | string): string => {
  if (typeof value === 'string') return value;
  return value.children.map(getNodeText).join('');
};

describe('ThreadSummaryCard', () => {
  it('labels a manually authored summary without claiming AI generation', () => {
    const renderer = create(
      React.createElement(ThreadSummaryCard, {
        summaryInfo: getThreadSummaryInfo({
          msgtype: 'm.notice',
          body: 'Handwritten summary',
          'io.mindroom.thread_summary': {
            version: 1,
            model: 'manual',
            summary: 'Handwritten summary',
          },
        })!,
        renderBody: ({ body }) => React.createElement('span', null, body),
      })
    );
    expect(getNodeText(renderer.root)).toContain('Manually edited summary');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('AI');
    renderer.unmount();
  });
  it('renders compact non-interactive AI summary provenance', () => {
    const renderer = create(
      React.createElement(ThreadSummaryCard, {
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

    expect(text).toContain('AI summary of last 3 messages');
    expect(text).not.toContain('Generated from last 3 messages');
    expect(text).toContain('Deployment completed and health checks passed.');
    expect(chipMock).not.toHaveBeenCalled();
    expect(timeMock).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('keeps the summary card visually compact', () => {
    const source = cssSource();

    expect(source).toContain('toRem(420)');
    expect(source).not.toContain('toRem(560)');
    expect(source).toContain('fontSize: toRem(15)');
    expect(source).toContain('lineHeight: toRem(22)');
  });
});
