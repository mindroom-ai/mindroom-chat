// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { getDefaultStore } from 'jotai';
import type { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { parseSecretRequestContent } from '../matrix/protocol/secretRequest';
import { SecretRequestCard } from '../approvals/SecretRequestCard';
import { secretRequestAnswersAtom } from '../approvals/secretRequestStatus';
import type { InlineSecretRequestPlan } from './inlineSecretRequests';
import { useInlineSecretRequestPlan } from './useInlineSecretRequestPlan';
import { AGENT, cardEvent, markers, replyEvent } from './test-utils/secretRequestEvents';

const env = vi.hoisted(() => ({ send: vi.fn() }));
const mx = vi.hoisted(() => ({
  getUserId: () => '@bas:example.org',
  getRoom: () => ({ getMember: () => null, getJoinedMembers: () => [] }),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../computer/useAgentServers', () => ({
  useOpenIdBinding: () => true,
  useRoomAgentServers: () => [],
}));
vi.mock('../computer/clientSessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../computer/clientSessions')>()),
  clientSessions: () => ({ send: env.send }),
}));

const NONE = new Set<string>();

// What each row shows now and the edit it shows, as RoomTimeline reads them.
let contents: Map<MatrixEvent, Record<string, unknown>>;
let revisions: Map<MatrixEvent, string>;
const getContent = (event: MatrixEvent) => contents.get(event) ?? event.getContent();
const getRevision = (event: MatrixEvent) => revisions.get(event);

let plans: InlineSecretRequestPlan[];

/** A thread's rows as RoomTimeline lays them out: a card shows as its row unless planned away. */
function Thread({ events }: { events: MatrixEvent[] }) {
  const plan = useInlineSecretRequestPlan({
    events,
    getContent,
    getRevision,
    ignored: NONE,
    viewerId: '@bas:example.org',
    threadId: '$root',
  });
  plans.push(plan);
  return (
    <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: 'https://mr.example.org' } } }}>
      {events.map((event) => {
        const request = parseSecretRequestContent(getContent(event));
        const id = event.getId()!;
        return request && !plan.hiddenEventIds.has(id) ? (
          <SecretRequestCard key={id} request={request} roomId="!room:x" agentUserId={AGENT} />
        ) : null;
      })}
    </ClientConfigProvider>
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  contents = new Map();
  revisions = new Map();
  plans = [];
  env.send.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  getDefaultStore().set(secretRequestAnswersAtom, new Map());
});

const render = (events: MatrixEvent[]) => act(() => root.render(<Thread events={events} />));
const field = () => host.querySelector<HTMLInputElement>('input:not([type="radio"])');
const type = (value: string) => {
  const input = field()!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const send = () =>
  act(async () => {
    field()!
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

describe('useInlineSecretRequestPlan', () => {
  it('draws a card in its reply from the first plan when both are there', () => {
    render([replyEvent(), cardEvent()]);
    expect([...plans.at(-1)!.hiddenEventIds]).toEqual(['$card']);
    expect(field()).toBeNull();
  });

  it('plans again only when a card or its reply gets a newer edit', () => {
    const events = [replyEvent(), cardEvent()];
    render(events);
    const first = plans.at(-1);
    render(events);
    render([...events]);
    expect(plans.at(-1)).toBe(first);

    revisions.set(events[0]!, '$edit');
    render([...events]);
    expect(plans.at(-1)).not.toBe(first);
  });

  describe('a waiting card that showed as a row keeps its field when its reply catches up', () => {
    // The trace has the call before the body has its marker: the card shows as a row.
    const reply = replyEvent('$reply', { body: markers(1) });
    const card = cardEvent();
    const catchUp = () => {
      contents.set(reply, replyEvent().getContent());
      revisions.set(reply, '$edit');
      render([reply, card]);
    };

    it('with what was typed and the keep chosen', () => {
      render([reply, card]);
      const input = field();
      type('hunter2');
      act(() => host.querySelector<HTMLInputElement>('input[value="disk"]')!.click());

      catchUp();

      expect(plans.at(-1)!.hiddenEventIds.size).toBe(0);
      expect(field()).toBe(input);
      expect(input?.value).toBe('hunter2');
      expect(host.querySelector<HTMLInputElement>('input[value="disk"]')?.checked).toBe(true);
    });

    it('while its answer is on its way and after the server took it, until the agent edits it', async () => {
      let answer!: (response: Response) => void;
      env.send.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
      render([reply, card]);
      const input = field();
      type('hunter2');
      await send();

      catchUp();
      expect(field()).toBe(input);
      // A second Send while the first is on its way sends nothing.
      await send();
      expect(env.send).toHaveBeenCalledTimes(1);

      await act(async () => answer(new Response(null, { status: 204 })));
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        'Sent, waiting for the agent'
      );
      catchUp();
      expect(plans.at(-1)!.hiddenEventIds.size).toBe(0);
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        'Sent, waiting for the agent'
      );

      // Done, it moves into its reply.
      contents.set(card, cardEvent('$card', { status: 'saved' }).getContent());
      revisions.set(card, '$card-edit');
      render([reply, card]);
      expect([...plans.at(-1)!.hiddenEventIds]).toEqual(['$card']);
    });
  });
});
