// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MindroomAiRunCostButton,
  MindroomReplyCostLabels,
  useMindroomReplyCostLabels,
} from './MindroomAiRunCost';
import { ThreadConversationCostProvider } from '../threads/useThreadConversationCost';
import { ThreadCostChip } from '../threads/ThreadCostChip';
import type { ThreadConversationCost } from '../threads/threadConversationCost';
import type { MindroomAiRunInfo } from './aiRun';

vi.mock('../../hooks/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));
vi.mock('folds', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const threadCost = (complete: boolean): ThreadConversationCost => ({
  total: { usd: 1.234, replyCount: 14 },
  complete,
  byEventId: new Map([['$r2', { usd: 0.03, replyCount: 2 }]]),
});
const priced: MindroomAiRunInfo = { status: 'completed', costUsd: 0.042 };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode, cost?: ThreadConversationCost) =>
  act(() => {
    root.render(
      <ThreadConversationCostProvider value={cost}>{node}</ThreadConversationCostProvider>
    );
  });

const labelsFor = (info: MindroomAiRunInfo, eventId?: string, cost?: ThreadConversationCost) => {
  let labels: MindroomReplyCostLabels | undefined;
  function Harness() {
    labels = useMindroomReplyCostLabels(info, eventId);
    return null;
  }
  render(<Harness />, cost);
  return labels;
};

describe('useMindroomReplyCostLabels', () => {
  it("labels a priced reply's cost", () => {
    expect(labelsFor(priced)).toEqual({
      cost: '$0.042',
      conversation: undefined,
      title: 'This reply: $0.042',
    });
  });

  it('gives no labels for a reply without cost, which keeps the info icon', () => {
    expect(labelsFor({ status: 'completed' }, '$r2', threadCost(true))).toBeUndefined();
  });

  it('adds the conversation so far inside a thread', () => {
    expect(labelsFor(priced, '$r2', threadCost(true))).toEqual({
      cost: '$0.042',
      conversation: '$0.03 across 2 replies',
      title: 'This reply: $0.042 · Conversation so far: $0.03 across 2 replies',
    });
  });

  it('says at least while older replies are not loaded', () => {
    expect(labelsFor(priced, '$r2', threadCost(false))?.conversation).toBe(
      'at least $0.03 across 2 replies'
    );
  });

  it('leaves out the conversation for a reply the thread did not count', () => {
    expect(labelsFor(priced, '$other', threadCost(true))?.conversation).toBeUndefined();
  });
});

describe('MindroomAiRunCostButton', () => {
  it('shows the cost and opens the run details', () => {
    const onOpen = vi.fn();
    render(
      <MindroomAiRunCostButton
        labels={{ cost: '$0.042', title: 'This reply: $0.042' }}
        open={false}
        onOpen={onOpen}
      />
    );
    const button = container.querySelector('button') as HTMLButtonElement;

    expect(button.textContent).toBe('$0.042');
    expect(button.getAttribute('aria-label')).toBe('This reply: $0.042');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    act(() => button.click());
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('ThreadCostChip', () => {
  it('shows nothing outside a priced thread', () => {
    render(<ThreadCostChip />);

    expect(container.innerHTML).toBe('');
  });

  it("shows the thread's total", () => {
    render(<ThreadCostChip />, threadCost(true));
    const chip = container.querySelector('[role="note"]') as HTMLElement;

    expect(chip.textContent).toBe('$1.23');
    expect(chip.getAttribute('aria-label')).toBe('Conversation cost: $1.23 across 14 replies');
  });

  it('marks a total that may miss older replies', () => {
    render(<ThreadCostChip />, threadCost(false));
    const chip = container.querySelector('[role="note"]') as HTMLElement;

    expect(chip.textContent).toBe('≥ $1.23');
    expect(chip.getAttribute('aria-label')).toBe(
      'Conversation cost: at least $1.23 across 14 replies'
    );
  });
});
