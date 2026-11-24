// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasRenderableAiRunDetails } from '../agent-run/aiRunDisplay';
import { ReplyDetails } from './ReplyDetails';
import { ThreadConversationCostProvider } from '../../event-store/threads/useThreadConversationCost';
import type { ThreadConversationCost } from '../../event-store/threads/threadConversationCost';
import {
  AI_RUN_TOKEN_KINDS,
  type AiRunInfo,
  type AiRunTokenCounts,
} from '../../matrix/protocol/aiRun';

vi.mock('../../i18n/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));

const reply: AiRunInfo = {
  status: 'completed',
  runId: 'run-123',
  sessionId: 'session-456',
  modelConfig: 'luna',
  modelDisplayName: 'Luna',
  modelId: 'gpt-6-luna',
  modelProvider: 'openai',
  inputTokens: 1674,
  outputTokens: 31,
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

/** A thread whose third of `costs` is the reply shown, its replies having used `tokens`. */
const thread = (
  costs: number[],
  complete = true,
  tokens: AiRunTokenCounts[] = []
): ThreadConversationCost => {
  let total = 0;
  const byEventId = new Map<string, { usd: number; replyCount: number }>();
  const replies = costs.map((usd, index) => {
    total += usd;
    byEventId.set(`$r${index + 1}`, { usd: total, replyCount: index + 1 });
    return { eventId: `$r${index + 1}`, usd };
  });
  let counts: AiRunTokenCounts = {};
  const tokensByEventId = new Map(
    tokens.map((reply, index) => {
      counts = { ...counts };
      AI_RUN_TOKEN_KINDS.forEach((kind) => {
        if (reply[kind]) counts[kind] = (counts[kind] ?? 0) + reply[kind]!;
      });
      return [`$r${index + 1}`, { counts, replyCount: index + 1 }] as const;
    })
  );
  return { complete, byEventId, replies, tokensByEventId };
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

const render = (info: AiRunInfo, eventId?: string, cost?: ThreadConversationCost) =>
  act(() => {
    root.render(
      <ThreadConversationCostProvider value={cost}>
        <ReplyDetails info={info} eventId={eventId} />
      </ThreadConversationCostProvider>
    );
  });

const text = () => container.textContent ?? '';
const costCard = () => container.querySelector('[aria-label="Cost"]');
const histogram = () =>
  container.querySelector('ol[aria-label="Cost of each reply in this conversation"]');
const bars = () => [...(histogram()?.querySelectorAll('li') ?? [])];
const caption = () =>
  [...(histogram()?.nextElementSibling?.children ?? [])].map((part) => part.textContent);
/** A pointer event as React reads it, which jsdom cannot construct with a pointer type. */
const pointer = (target: Element, type: string, clientX: number, pointerType: string) => {
  const event = new MouseEvent(type, { bubbles: true, clientX, relatedTarget: document.body });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  act(() => {
    target.dispatchEvent(event);
  });
};
const section = (heading: string) =>
  [...container.querySelectorAll('section')].find(
    (element) => element.querySelector('h3')?.textContent === heading
  );

describe('ReplyDetails', () => {
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

  it('keeps a lower bound numeric for tiny totals', () => {
    render(reply, '$r2', thread([0.00001, 0.00003], false));

    expect(costCard()?.textContent).toContain('≥ $0.00004');
  });

  it('shows only the reply cost outside a thread', () => {
    render(reply, '$r3');

    expect(costCard()?.textContent).toBe('This reply$0.0051');
    expect(histogram()).toBeNull();
  });

  it("adds the subagents' cost under the reply's own cost", () => {
    render({ ...reply, subagentsCostUsd: 0.42 }, '$r3');

    expect(costCard()?.textContent).toBe('This reply$0.0051Sub-agents$0.42');
  });

  it("shows no subagents' cost for a reply that ran none", () => {
    render(reply, '$r3');

    expect(costCard()?.textContent).not.toContain('Sub-agents');
  });

  it("shows the subagents' cost of a reply without a cost of its own", () => {
    render({ ...reply, costUsd: undefined, subagentsCostUsd: 0.42 }, '$r3');

    expect(costCard()?.textContent).toBe('Sub-agents$0.42');
  });

  it('leaves out the cost card without a cost', () => {
    render({ ...reply, costUsd: undefined }, '$r3', thread([0.0012, 0.0034, 0.0051]));

    expect(costCard()).toBeNull();
  });

  it("draws each reply's cost with this reply highlighted", () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051, 0.0026]));

    expect(
      bars().map((bar) => [
        bar.textContent,
        bar.getAttribute('data-position'),
        bar.getAttribute('aria-current'),
      ])
    ).toEqual([
      ['Reply 1: $0.0012', 'earlier', null],
      ['Reply 2: $0.0034', 'earlier', null],
      ['Reply 3: $0.0051', 'current', 'true'],
      ['Reply 4: $0.0026', 'later', null],
    ]);
    expect(caption()).toEqual(['This reply · 3 of 4']);
  });

  /** Bars 8px wide with 2px gaps, the first at the left or, right to left, at the right. */
  const placeBars = (direction: 'ltr' | 'rtl') =>
    bars().forEach((bar, offset) => {
      const left = direction === 'ltr' ? offset * 10 : 30 - offset * 10;
      bar.getBoundingClientRect = () => ({ left, right: left + 8 }) as DOMRect;
    });

  it('names the reply under the pointer in the caption', () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051, 0.0026]));
    placeBars('ltr');

    pointer(histogram()!, 'pointermove', 15, 'mouse');
    expect(caption()).toEqual(['Reply 2: $0.0034']);
    expect(bars().map((bar) => bar.hasAttribute('data-pointed'))).toEqual([
      false,
      true,
      false,
      false,
    ]);

    pointer(histogram()!, 'pointerout', 15, 'mouse');
    expect(caption()).toEqual(['This reply · 3 of 4']);

    // A tap keeps its reply named after the finger lifts, until it points past the bars.
    pointer(histogram()!, 'pointerdown', 35, 'touch');
    pointer(histogram()!, 'pointerout', 35, 'touch');
    expect(caption()).toEqual(['Reply 4: $0.0026']);
    pointer(histogram()!, 'pointermove', 45, 'touch');
    expect(caption()).toEqual(['This reply · 3 of 4']);

    // A finger that starts scrolling the dialog over the bars leaves none named.
    pointer(histogram()!, 'pointerdown', 15, 'touch');
    pointer(histogram()!, 'pointercancel', 15, 'touch');
    expect(caption()).toEqual(['This reply · 3 of 4']);
  });

  it('keeps naming the pointed reply as the thread changes, and forgets a redacted one', () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051, 0.0026]));
    placeBars('ltr');
    pointer(histogram()!, 'pointerdown', 35, 'touch');
    expect(caption()).toEqual(['Reply 4: $0.0026']);

    // A new reply arrives: the tapped reply stays named.
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051, 0.0026, 0.0018]));
    expect(caption()).toEqual(['Reply 4: $0.0026']);

    // The tapped reply is redacted: the caption falls back to this reply.
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051]));
    expect(caption()).toEqual(['This reply · 3 of 3']);
  });

  it('names the pointed reply when the bars run right to left', () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051, 0.0026]));
    placeBars('rtl');

    pointer(histogram()!, 'pointermove', 3, 'mouse');
    expect(caption()).toEqual(['Reply 4: $0.0026']);
    pointer(histogram()!, 'pointermove', 31, 'mouse');
    expect(caption()).toEqual(['Reply 1: $0.0012']);
  });

  it('numbers no replies while older ones are not loaded', () => {
    render(reply, '$r3', thread([0.0012, 0.0034, 0.0051, 0.0026], false));

    expect(bars().map((bar) => bar.textContent)).toEqual([
      '$0.0012',
      '$0.0034',
      '$0.0051',
      '$0.0026',
    ]);
    expect(caption()).toEqual(['This reply']);
  });

  it('draws no histogram for the only priced reply', () => {
    render(reply, '$r1', thread([0.0051]));

    expect(histogram()).toBeNull();
  });

  it('draws a window of bars around this reply in long threads', () => {
    render(reply, '$r50', thread(Array.from({ length: 60 }, () => 0.001)));

    expect(bars()).toHaveLength(40);
    expect(bars()[0]!.textContent).toBe('Reply 21: $0.001');
    expect(bars()[39]!.textContent).toBe('Reply 60: $0.001');
    expect(caption()).toEqual(['This reply · 50 of 60', '21–60']);
  });

  it('shows what the tokens were spent on', () => {
    render(reply);
    const tokens = section('Tokens');

    expect(tokens?.textContent).toContain('This reply1,705');
    expect(tokens?.querySelector('[role="group"]')).toBeNull();
    expect([...(tokens?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'From cache 1,408',
      'New input 266',
      'Output 31',
    ]);
  });

  it('splits the new input into cache writes and the rest when the writes are counted', () => {
    render({ ...reply, cacheWriteTokens: 200 });
    const tokens = section('Tokens');

    expect(tokens?.textContent).toContain('This reply1,705');
    expect([...(tokens?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'From cache 1,408',
      'Written to cache 200',
      'Not cached 66',
      'Output 31',
    ]);
  });

  it("switches between this reply's tokens and the conversation's through it", () => {
    const earlier = { cacheRead: 52_000_000, cacheWrite: 8_000_000, input: 1_000_000 };
    const shown = { cacheRead: 100_000, cacheWrite: 300_000, newInput: 100_000, output: 200_000 };
    render(reply, '$r2', thread([0.01, 0.02], true, [earlier, shown]));
    const tokens = () => section('Tokens');
    const total = () => tokens()?.querySelector('.reply-details-token-total')?.textContent;
    const legend = () => [...(tokens()?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
    const button = (name: string) =>
      [...(tokens()?.querySelectorAll('button') ?? [])].find((item) => item.textContent === name)!;

    // It opens on this reply.
    expect(button('This reply').getAttribute('aria-pressed')).toBe('true');
    expect(total()).toBe('This reply1,705');
    act(() => button('Conversation').click());
    expect(button('Conversation').getAttribute('aria-pressed')).toBe('true');
    // The same parts, summed over the conversation through this reply, add up to its total.
    expect(total()).toBe('Conversation so far · 2 replies61.7M');
    expect(legend()).toEqual([
      'From cache 52.1M',
      'Written to cache 8.3M',
      'New input 100K',
      'Input 1M',
      'Output 200K',
    ]);
  });

  it("gives the conversation's tokens exactly, as a lower bound, while older replies are not loaded", () => {
    render(reply, '$r2', thread([0.01, 0.02], false, [{ input: 1_000_000 }, { output: 499_999 }]));
    const tokens = section('Tokens');
    act(() => [...(tokens?.querySelectorAll('button') ?? [])][1]!.click());

    expect(tokens?.querySelector('.reply-details-token-total')?.textContent).toBe(
      'Conversation so far · 2 loaded replies≥ 1,499,999'
    );
    expect([...(tokens?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'Input 1,000,000',
      'Output 499,999',
    ]);
  });

  it("shows only this reply's tokens outside a thread or without a conversation count", () => {
    render(reply);
    expect(section('Tokens')?.querySelector('[role="group"]')).toBeNull();

    render(reply, '$r3', thread([0.01, 0.02, 0.03], true, [{ output: 5 }, { output: 5 }]));
    expect(section('Tokens')?.querySelector('[role="group"]')).toBeNull();
  });

  it('shows how full the context window was', () => {
    render(reply);

    expect(section('Context window')?.textContent).toContain('51,663 of 258,000 · 20.0%');
    // Without a legend, the bar names its parts to screen readers.
    expect(
      section('Context window')?.querySelector('[role="img"]')?.getAttribute('aria-label')
    ).toBe('From cache 49,886 · 19.3%, New input 1,777 · 0.7%');
    expect(section('Tokens')?.querySelector('[role="img"]')).toBeNull();
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

  it('reports whether an AiRunInfo has at least one renderable detail section', () => {
    expect(hasRenderableAiRunDetails({})).toBe(false);
    expect(hasRenderableAiRunDetails({ status: 'completed' })).toBe(false);
    expect(hasRenderableAiRunDetails({ status: 'cached' })).toBe(false);
    expect(hasRenderableAiRunDetails({ status: 'interrupted' })).toBe(false);
    expect(hasRenderableAiRunDetails({ inputTokens: 0, outputTokens: 0 })).toBe(false);

    expect(
      hasRenderableAiRunDetails({
        modelDisplayName: 'Gemini 4 Neon',
        modelProvider: 'openrouter',
        modelId: 'google/gemini-4-neon',
        modelConfig: 'gemini4_neon',
      })
    ).toBe(true);
    expect(hasRenderableAiRunDetails({ status: 'error' })).toBe(true);
    expect(hasRenderableAiRunDetails({ status: 'cancelled' })).toBe(true);
    expect(hasRenderableAiRunDetails({ costUsd: 0 })).toBe(true);
    expect(hasRenderableAiRunDetails({ subagentsCostUsd: 0.01 })).toBe(true);
    expect(hasRenderableAiRunDetails({ outputTokens: 12 })).toBe(true);
    expect(hasRenderableAiRunDetails({ contextInputTokens: 100, contextWindowTokens: 4000 })).toBe(
      true
    );
    expect(hasRenderableAiRunDetails({ toolCount: 0 })).toBe(true);
    expect(hasRenderableAiRunDetails({ timeToFirstToken: 0.42 })).toBe(true);
    expect(hasRenderableAiRunDetails({ modelConfig: 'default' })).toBe(true);
    expect(hasRenderableAiRunDetails({ runId: 'run-1' })).toBe(true);
    expect(hasRenderableAiRunDetails({ sessionId: 'session-1' })).toBe(true);
  });
});
