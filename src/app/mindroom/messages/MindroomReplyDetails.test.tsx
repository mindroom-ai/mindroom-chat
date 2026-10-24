// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MindroomReplyDetails } from './MindroomReplyDetails';
import { ThreadConversationCostProvider } from '../threads/useThreadConversationCost';
import type { ThreadConversationCost } from '../threads/threadConversationCost';
import type { MindroomAiRunInfo } from './aiRun';

vi.mock('../../hooks/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));

const reply: MindroomAiRunInfo = {
  status: 'completed',
  runId: 'run-123',
  sessionId: 'session-456',
  modelConfig: 'luna',
  modelDisplayName: 'Luna',
  modelId: 'gpt-6-luna',
  modelProvider: 'openai',
  inputTokens: 1674,
  outputTokens: 31,
  totalTokens: 1705,
  cacheReadTokens: 1408,
  timeToFirstToken: 0.042,
  contextInputTokens: 65,
  contextWindowTokens: 100,
  contextCacheReadInputTokens: 20,
  contextCacheWriteInputTokens: 5,
  contextUncachedInputTokens: 45,
  toolCount: 3,
  costUsd: 0.0051,
};

const threadCost = (complete: boolean): ThreadConversationCost => ({
  total: { usd: 0.017, replyCount: 2 },
  complete,
  byEventId: new Map([['$r2', { usd: 0.017, replyCount: 2 }]]),
});

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

const render = (info: MindroomAiRunInfo, eventId?: string, cost?: ThreadConversationCost) =>
  act(() => {
    root.render(
      <ThreadConversationCostProvider value={cost}>
        <MindroomReplyDetails info={info} eventId={eventId} />
      </ThreadConversationCostProvider>
    );
  });

/** Each section's rows as label to value, keyed by the section's heading. */
const sections = () =>
  Object.fromEntries(
    [...container.querySelectorAll('section')].map((section) => [
      section.querySelector('h3')?.textContent,
      Object.fromEntries(
        [...section.querySelectorAll('dt')].map((term) => [
          term.textContent,
          term.nextElementSibling?.textContent,
        ])
      ),
    ])
  );

describe('MindroomReplyDetails', () => {
  it('leads with the model and leaves out a completed status', () => {
    render(reply);

    expect(container.querySelector('h3')?.textContent).not.toBe('Model');
    expect(container.textContent).toContain('Luna');
    expect(container.textContent).toContain('openai · gpt-6-luna');
    expect(container.textContent?.toLowerCase()).not.toContain('completed');
  });

  it.each([
    ['error', 'Failed'],
    ['cancelled', 'Stopped'],
  ])('flags a %s reply', (status, label) => {
    render({ ...reply, status });

    expect(container.textContent).toContain(label);
  });

  it('shows the reply cost and the conversation so far', () => {
    render(reply, '$r2', threadCost(true));

    expect(sections().Cost).toEqual({
      'This reply': '$0.0051',
      'Conversation so far': '$0.017 across 2 replies',
    });
  });

  it('says at least while older replies are not loaded', () => {
    render(reply, '$r2', threadCost(false));

    expect(sections().Cost['Conversation so far']).toBe('at least $0.017 across 2 replies');
  });

  it('shows only the reply cost outside a thread', () => {
    render(reply, '$r2');

    expect(sections().Cost).toEqual({ 'This reply': '$0.0051' });
  });

  it('leaves out the cost section without a cost', () => {
    render({ ...reply, costUsd: undefined }, '$r2', threadCost(true));

    expect(sections().Cost).toBeUndefined();
  });

  it('lists tokens by kind', () => {
    render(reply);

    expect(sections().Tokens).toEqual({
      Input: '1,674',
      'From cache': '1,408',
      Output: '31',
      Total: '1,705',
    });
  });

  it('shows the context window with a legend for its bar', () => {
    render(reply);
    const context = [...container.querySelectorAll('section')].find(
      (section) => section.querySelector('h3')?.textContent === 'Context window'
    );

    expect(context?.textContent).toContain('65 of 100 tokens · 65.0%');
    expect([...(context?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'From cache20',
      'New input45',
    ]);
  });

  it('lists the run activity', () => {
    render(reply);

    expect(sections().Activity).toEqual({ 'Tool calls': '3', 'Time to first token': '42 ms' });
  });

  it('keeps identifiers in collapsed technical details', () => {
    render(reply);
    const details = container.querySelector('details');

    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Technical details');
    expect(
      Object.fromEntries(
        [...(details?.querySelectorAll('dt') ?? [])].map((term) => [
          term.textContent,
          term.nextElementSibling?.textContent,
        ])
      )
    ).toEqual({
      'Configured model': 'luna',
      'Run ID': 'run-123',
      'Session ID': 'session-456',
    });
  });
});
