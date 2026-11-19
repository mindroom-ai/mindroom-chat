import {
  createContext,
  useContext,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  MINDROOM_SECRET_REQUEST_KEY,
  parseSecretRequestContent,
  type SecretRequest,
} from '../matrix/protocol/secretRequest';

/** A done secret request the reply whose tool call asked may draw, at that call's line. */
export type InlineSecretRequest = {
  /** The card's event, whose own row hides while the line is mounted. */
  eventId: string;
  request: SecretRequest;
  /** The card's sender, the agent that asked. */
  agentUserId: string;
};

/**
 * The lines mounted now, by their card's event ID: the one thing that hides a card's row. A line
 * takes its card as it mounts and gives it back as it unmounts, both before the browser paints,
 * so no paint shows the card twice or not at all.
 */
export type DrawnSecretRequests = {
  subscribe: (listener: () => void) => () => void;
  /** The cards with a mounted line; a new set after each change. */
  getIds: () => ReadonlySet<string>;
  /** Who mounted the card's line. */
  drawerOf: (cardId: string) => object | undefined;
  /** Whether the card's mounted line shows, not kept hidden with its reply's calls. */
  shows: (cardId: string) => boolean;
  /**
   * `drawer` mounted the card's line, `hidden` with its reply's calls or not. False when another
   * drawer's line is mounted (one per card), unless that one is hidden and this one shows.
   */
  take: (cardId: string, drawer: object, hidden?: boolean) => boolean;
  /** `drawer` unmounted it. */
  release: (cardId: string, drawer: object) => void;
};

export const createDrawnSecretRequests = (): DrawnSecretRequests => {
  const drawers = new Map<string, object>();
  const hiddenIds = new Set<string>();
  const listeners = new Set<() => void>();
  let ids: ReadonlySet<string> = new Set();
  const changed = () => {
    ids = new Set(drawers.keys());
    [...listeners].forEach((listener) => listener());
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getIds: () => ids,
    drawerOf: (cardId) => drawers.get(cardId),
    shows: (cardId) => drawers.has(cardId) && !hiddenIds.has(cardId),
    take: (cardId, drawer, hidden = false) => {
      const current = drawers.get(cardId);
      if (current === drawer) return true;
      if (current && (hidden || !hiddenIds.has(cardId))) return false;
      drawers.set(cardId, drawer);
      if (hidden) hiddenIds.add(cardId);
      else hiddenIds.delete(cardId);
      changed();
      return true;
    },
    release: (cardId, drawer) => {
      if (drawers.get(cardId) !== drawer) return;
      drawers.delete(cardId);
      hiddenIds.delete(cardId);
      changed();
    },
  };
};

export type InlineSecretRequestPlan = {
  /** The requests each reply may draw, by the reply's event ID, then by the ID of the call. */
  byReply: ReadonlyMap<string, ReadonlyMap<string, InlineSecretRequest>>;
  /** Replies with a request not done yet (its card a row of its own): their work stays unfolded. */
  waitingReplyIds: ReadonlySet<string>;
  drawn: DrawnSecretRequests;
};

export const NO_INLINE_SECRET_REQUESTS: InlineSecretRequestPlan = {
  byReply: new Map(),
  waitingReplyIds: new Set(),
  drawn: createDrawnSecretRequests(),
};

/** The agent cards among `events` that carry a request, the ones a plan reads. */
export const secretRequestCards = (
  events: readonly MatrixEvent[],
  isAgent: (userId: string | undefined) => boolean
): MatrixEvent[] =>
  events.filter(
    (event) =>
      // A card's first content has the key too.
      MINDROOM_SECRET_REQUEST_KEY in event.getOriginalContent() && isAgent(event.getSender())
  );

/**
 * Which secret request cards a thread's replies may draw at their tool calls, and nothing about
 * whether they do: a reply draws a request where the body it shows has the named call's line
 * (HtmlBlocks.tsx `ToolRun`), and the card's row hides while that line is mounted (`drawn`). Only
 * a request the agent's edit marked done may move: one still open keeps its row, the form in it,
 * right under the reply its call blocks. A done card may move to the reply it names, loaded in
 * the thread from the card's agent, at the call it names. Not the thread's root, an ignored
 * sender's card or one the route or a jump opened (`revealed`), and one card per call: a later
 * card that names the same call keeps its row.
 */
export const planInlineSecretRequests = ({
  cards,
  getEvent,
  getContent,
  ignored,
  revealed,
  threadId,
}: {
  cards: readonly MatrixEvent[];
  getEvent: (eventId: string) => MatrixEvent | undefined;
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
  threadId?: string;
}): Omit<InlineSecretRequestPlan, 'drawn'> => {
  const waitingReplyIds = new Set<string>();
  const byReply = new Map<string, Map<string, InlineSecretRequest>>();
  cards.forEach((card) => {
    const eventId = card.getId();
    const agentUserId = card.getSender();
    if (!eventId || !agentUserId || card.isRedacted() || ignored.has(agentUserId)) return;
    const request = parseSecretRequestContent(getContent(card));
    const anchor = request?.anchor;
    if (!request || !anchor || eventId === threadId) return;
    const replyId = anchor.responseEventId;
    const reply = getEvent(replyId);
    if (!reply || reply === card || reply.isRedacted() || reply.getSender() !== agentUserId) return;
    if (request.status === 'pending') {
      waitingReplyIds.add(replyId);
      return;
    }
    if (revealed.has(eventId)) return;
    const calls = byReply.get(replyId) ?? new Map<string, InlineSecretRequest>();
    if (calls.has(anchor.toolCallId)) return;
    calls.set(anchor.toolCallId, { eventId, request, agentUserId });
    byReply.set(replyId, calls);
  });
  return { byReply, waitingReplyIds };
};

/** Plain data the same, as parsed requests are: objects, arrays and primitives. */
const sameData = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) =>
      sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  );
};

/** Whether two plans allow the same: the timeline keeps the older, so its replies do not redraw. */
export const sameInlineSecretRequestPlan = (
  a: Omit<InlineSecretRequestPlan, 'drawn'>,
  b: Omit<InlineSecretRequestPlan, 'drawn'>
): boolean =>
  a.waitingReplyIds.size === b.waitingReplyIds.size &&
  [...a.waitingReplyIds].every((id) => b.waitingReplyIds.has(id)) &&
  a.byReply.size === b.byReply.size &&
  [...a.byReply].every(([replyId, calls]) => {
    const others = b.byReply.get(replyId);
    return (
      others?.size === calls.size &&
      [...calls].every(([callId, drawn]) => {
        const other = others.get(callId);
        return other?.eventId === drawn.eventId && sameData(other.request, drawn.request);
      })
    );
  });

/** The timeline's inline secret requests (planInlineSecretRequests), for its replies to draw. */
export const InlineSecretRequestsContext =
  createContext<InlineSecretRequestPlan>(NO_INLINE_SECRET_REQUESTS);

const NO_CALLS: ReadonlyMap<string, InlineSecretRequest> = new Map();

/** The requests a reply may draw, by call ID; none outside a timeline that plans them. */
export const useInlineSecretRequests = (
  replyEventId: string | undefined
): ReadonlyMap<string, InlineSecretRequest> => {
  const { byReply } = useContext(InlineSecretRequestsContext);
  return (replyEventId && byReply.get(replyEventId)) || NO_CALLS;
};

/** Whether a request of the reply's tool calls is not done yet, its card a row under the reply. */
export const useSecretRequestWaiting = (replyEventId: string | undefined): boolean => {
  const { waitingReplyIds } = useContext(InlineSecretRequestsContext);
  return !!replyEventId && waitingReplyIds.has(replyEventId);
};

/** The cards whose rows hide: those with a mounted line, read anew as lines mount and unmount. */
export const useDrawnSecretRequestIds = ({ drawn }: InlineSecretRequestPlan): ReadonlySet<string> =>
  useSyncExternalStore(drawn.subscribe, drawn.getIds);

/**
 * For the place a reply would draw a card's line (`wanted`), kept `hidden` while its reply hides
 * its calls: whether to mount the line, on `lineRef`, and whether the place is not the line's
 * (`taken`), which leaves it an ordinary tool line: another place has the line mounted (and
 * shown, unless this one is hidden too), or this one is in a `<details>` of the page, which
 * would hide the line while closed and the card's row with it. The line is the card's from the
 * commit that mounts it to the one that unmounts it; of two that mount in one commit the first
 * keeps it, and the other, as one in a `<details>`, gives way before the paint. A shown line
 * takes the card from a hidden one, which gives way.
 */
export const useSecretRequestLine = (
  cardId: string,
  wanted: boolean,
  hidden = false
): { line: boolean; taken: boolean; lineRef: RefObject<HTMLDivElement> } => {
  const { drawn } = useContext(InlineSecretRequestsContext);
  const [self] = useState(() => ({}));
  const lineRef = useRef<HTMLDivElement>(null);
  const [inDetails, setInDetails] = useState(false);
  const [, giveWay] = useReducer((count: number) => count + 1, 0);
  const drawer = useSyncExternalStore(drawn.subscribe, () => drawn.drawerOf(cardId));
  const holderShows = useSyncExternalStore(drawn.subscribe, () => drawn.shows(cardId));
  const taken = inDetails || (drawer !== undefined && drawer !== self && (hidden || holderShows));
  const line = wanted && !taken;
  useLayoutEffect(() => {
    if (!line) return undefined;
    if (lineRef.current?.closest('details')) {
      setInDetails(true);
      return undefined;
    }
    if (!drawn.take(cardId, self, hidden)) giveWay();
    return () => drawn.release(cardId, self);
  }, [cardId, drawn, hidden, line, self]);
  return { line, taken, lineRef };
};
