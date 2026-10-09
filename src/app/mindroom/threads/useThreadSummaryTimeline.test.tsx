// @vitest-environment jsdom
import React from 'react';
import { EventEmitter } from 'events';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { useThreadSummaryTimeline } from './useThreadSummaryTimeline';
import type { ThreadSummaryTimelinePlan } from './threadSummaryTimeline';

const summaryContent = (text: string) => ({
  msgtype: 'm.notice',
  body: text,
  'io.mindroom.thread_summary': { version: 1, summary: text, message_count: 1 },
});
const summary = (id: string, text: string) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: '!room:example.org',
    sender: '@code:example.org',
    content: summaryContent(text),
  });

// Stands in for an event the SDK has not decrypted yet.
class EncryptedEvent extends EventEmitter {
  type = 'm.room.encrypted';

  content: Record<string, unknown> = { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' };

  status = null;

  constructor(private readonly id: string) {
    super();
  }

  getId = () => this.id;

  getType = () => this.type;

  getContent = () => this.content;

  getRelation = () => null;

  decryptAs(content: Record<string, unknown>) {
    this.type = 'm.room.message';
    this.content = content;
    this.emit(MatrixEventEvent.Decrypted, this);
  }
}

const history = { sdkLoaded: true, canPaginateBack: false, hasMoreCachedBack: false };

const renderPlan = (events: readonly MatrixEvent[]) => {
  const plans: ThreadSummaryTimelinePlan[] = [];
  function Harness() {
    plans.push(useThreadSummaryTimeline(events, { history }));
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness />);
  });
  return { plans, renderer };
};

describe('useThreadSummaryTimeline', () => {
  it('plans a summary again once it decrypts', () => {
    const encrypted = new EncryptedEvent('$s2');
    const { plans, renderer } = renderPlan([
      summary('$s1', 'Push bug'),
      encrypted as unknown as MatrixEvent,
    ]);
    expect(plans.at(-1)!.hiddenEventIds.size).toBe(0);

    act(() => encrypted.decryptAs(summaryContent('Push bug')));

    expect([...plans.at(-1)!.hiddenEventIds]).toEqual(['$s2']);
    act(() => renderer.unmount());
    expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });
});
