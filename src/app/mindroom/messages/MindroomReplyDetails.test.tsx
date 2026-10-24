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
  uncachedInputTokens: 266,
  timeToFirstToken: 0.412,
  contextInputTokens: 51663,
  contextWindowTokens: 258000,
  contextCacheReadInputTokens: 49886,
  contextUncachedInputTokens: 1777,
  toolCount: 2,
  costUsd: 0.0051,
};

/** A thread whose third of `costs` is the reply shown. */
const thread = (costs: number[], complete = true): ThreadConversationCost => {
  let total = 0;
  const byEventId = new Map<string, { usd: number; replyCount: number }>();
  const replies = costs.map((usd, index) => {
    total += usd;
    byEventId.set(`$r${index + 1}`, { usd: total, replyCount: index + 1 });
    return { eventId: `$r${index + 1}`, usd };
  });
  return { total: { usd: total, replyCount: costs.length }, complete, byEventId, replies };
};

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

const text = () => container.textContent ?? '';
const costCard = () => container.querySelector('[aria-label="Cost"]');
const histogram = () => container.querySelector('[role="img"]');
const bars = () => [...(histogram()?.querySelectorAll('[data-position]') ?? [])];
const section = (heading: string) =>
  [...container.querySelectorAll('section')].find(
    (element) => element.querySelector('h3')?.textContent === heading
  );

describe('MindroomReplyDetails', () => {
  it('leads with the model and leaves out a completed status', () => {
    render(reply);

    expect(text()).toContain('Luna');
    expect(text()).toContain('openai · gpt-6-luna');
    expect(text().toLowerCase()).not.toContain('completed');
  });

  it.each([
    ['error', 'Failed'],
    ['cancelled', 'Stopped'],
  ])('flags a %s reply', (status, label) => {
    render({ ...reply, status });

    expect(text()).toContain(label);
  });

  it('shows the reply cost beside the conversation so far', () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051]));

    expect(costCard()?.textContent).toContain('This reply$0.0051');
    expect(costCard()?.textContent).toContain('Conversation so far$0.0097');
    expect(costCard()?.textContent).toContain('3 replies');
  });

  it('marks the conversation cost as a lower bound while older replies are not loaded', () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051], false));

    expect(costCard()?.textContent).toContain('≥ $0.0097');
    expect(costCard()?.textContent).toContain('3 loaded replies');
  });

  it('shows only the reply cost outside a thread', () => {
    render(reply, '$r3');

    expect(costCard()?.textContent).toBe('This reply$0.0051');
    expect(histogram()).toBeNull();
  });

  it('leaves out the cost card without a cost', () => {
    render({ ...reply, costUsd: undefined }, '$r3', thread([0.0012, 0.0034, 0.0051]));

    expect(costCard()).toBeNull();
  });

  it("draws each reply's cost with this reply highlighted", () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051, 0.0026]));

    expect(histogram()?.getAttribute('aria-label')).toBe('Cost of each reply in this conversation');
    expect(
      bars().map((bar) => [bar.getAttribute('title'), bar.getAttribute('data-position')])
    ).toEqual([
      ['Reply 1: $0.0012', 'earlier'],
      ['Reply 2: $0.0034', 'earlier'],
      ['Reply 3: $0.0051', 'current'],
      ['Reply 4: $0.0026', 'later'],
    ]);
    expect(costCard()?.textContent).toContain('Reply 1');
    expect(costCard()?.textContent).toContain('This reply · 3 of 4');
  });

  it('numbers no replies while older ones are not loaded', () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051, 0.0026], false));

    expect(costCard()?.textContent).not.toContain('3 of 4');
    expect(costCard()?.textContent).not.toContain('Reply 1');
  });

  it('draws no histogram for the only priced reply', () => {
    render(reply, '$r1', thread([0.0051]));

    expect(histogram()).toBeNull();
  });

  it('draws a window of bars around this reply in long threads', () => {
    render(reply, '$r50', thread(Array.from({ length: 60 }, () => 0.001)));

    expect(bars()).toHaveLength(40);
    expect(bars()[0].getAttribute('title')).toBe('Reply 21: $0.001');
    expect(bars()[39].getAttribute('title')).toBe('Reply 60: $0.001');
    expect(costCard()?.textContent).toContain('Reply 21');
  });

  it('shows what the tokens were spent on', () => {
    render(reply);
    const tokens = section('Tokens');

    expect(tokens?.textContent).toContain('Tokens1,705');
    expect([...(tokens?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'From cache 1,408',
      'New input 266',
      'Output 31',
    ]);
  });

  it('shows how full the context window was', () => {
    render(reply);

    expect(section('Context window')?.textContent).toContain('51,663 of 258,000 · 20.0%');
  });

  it('sums up the run activity in one line', () => {
    render(reply);

    expect(text()).toContain('2 tool calls');
    expect(text()).toContain('First token 412 ms');
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
