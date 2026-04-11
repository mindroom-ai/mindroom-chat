import React from 'react';
import { RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { useThreadRootEvent } from './useThreadRootEvent';

const makeEvent = (
  eventId: string,
  options?: {
    threadRootId?: string;
    txnId?: string;
    isSending?: boolean;
  }
) =>
  ({
    getId: () => eventId,
    getTxnId: () => options?.txnId,
    getUnsigned: () =>
      options?.txnId
        ? {
            transaction_id: options.txnId,
          }
        : {},
    isSending: () => options?.isSending ?? false,
    threadRootId: options?.threadRootId,
  }) as never;

const makeRoom = ({
  events = [],
  txnEvents = new Map<string, ReturnType<typeof makeEvent>>(),
}: {
  events?: ReturnType<typeof makeEvent>[];
  txnEvents?: Map<string, ReturnType<typeof makeEvent>>;
} = {}) => {
  const listeners = new Map<string | symbol, (...args: unknown[]) => void>();

  return {
    roomId: '!room:example.org',
    findEventById: (eventId: string) => events.find((event) => event.getId() === eventId),
    getEventForTxnId: (txnId: string) => txnEvents.get(txnId),
    getLiveTimeline: () => ({
      getEvents: () => events,
    }),
    getThread: () => null,
    on: (event: string | symbol, handler: (...args: unknown[]) => void) => {
      listeners.set(event, handler);
    },
    removeListener: (event: string | symbol) => {
      listeners.delete(event);
    },
    __listeners: listeners,
  } as never;
};

describe('useThreadRootEvent', () => {
  it('updates a pending local-echo thread root id when LocalEchoUpdated confirms it', async () => {
    const pendingRoot = makeEvent('~pending-root', {
      txnId: 'txn-1',
      isSending: true,
    });
    const confirmedRoot = makeEvent('$confirmed-root', {
      txnId: 'txn-1',
    });
    const events = [pendingRoot];
    const room = makeRoom({
      events,
      txnEvents: new Map([['txn-1', confirmedRoot]]),
    });
    const observedRootIds: Array<string | undefined> = [];

    const HookProbe = ({ threadId }: { threadId?: string }) => {
      const rootId = useThreadRootEvent(room, threadId);
      observedRootIds.push(rootId);
      return null;
    };

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(HookProbe, { threadId: '~pending-root' }));
    });

    events.splice(0, events.length, confirmedRoot);

    await act(async () => {
      room.__listeners.get(RoomEvent.LocalEchoUpdated)?.(
        confirmedRoot,
        room,
        '~pending-root'
      );
    });

    expect(observedRootIds.at(-1)).toBe('$confirmed-root');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('resolves a stale local-echo route id on mount when the confirmed event is already live', async () => {
    const confirmedRoot = makeEvent('$confirmed-root', {
      txnId: 'm1775932488410.3',
    });
    const room = makeRoom({
      events: [confirmedRoot],
    });
    const observedRootIds: Array<string | undefined> = [];

    const HookProbe = ({ threadId }: { threadId?: string }) => {
      const rootId = useThreadRootEvent(room, threadId);
      observedRootIds.push(rootId);
      return null;
    };

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(HookProbe, {
          threadId: '~!room:example.org:m1775932488410.3',
        })
      );
    });

    expect(observedRootIds.at(-1)).toBe('$confirmed-root');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('still resolves thread replies back to their thread root ids', async () => {
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
    });
    const room = makeRoom({
      events: [replyEvent],
    });
    const observedRootIds: Array<string | undefined> = [];

    const HookProbe = ({ threadId }: { threadId?: string }) => {
      const rootId = useThreadRootEvent(room, threadId);
      observedRootIds.push(rootId);
      return null;
    };

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(HookProbe, { threadId: '$reply' }));
    });

    expect(observedRootIds.at(-1)).toBe('$root');

    await act(async () => {
      room.__listeners.get(ThreadEvent.Update)?.();
      renderer?.unmount();
    });
  });
});
