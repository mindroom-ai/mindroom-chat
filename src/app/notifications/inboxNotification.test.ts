import { describe, expect, it } from 'vitest';
import type { INotification, PushRuleAction } from 'matrix-js-sdk';
import { isHighlightNotification, isMessageNotification } from './inboxNotification';

const withActions = (actions: unknown[]) => ({ actions: actions as PushRuleAction[] });

describe('isHighlightNotification', () => {
  it('is a highlight when the highlight tweak is set without a value or to true', () => {
    expect(isHighlightNotification(withActions(['notify', { set_tweak: 'highlight' }]))).toBe(true);
    expect(
      isHighlightNotification(withActions(['notify', { set_tweak: 'highlight', value: true }]))
    ).toBe(true);
  });

  it('is no highlight without the tweak or with it set to false', () => {
    expect(isHighlightNotification(withActions(['notify']))).toBe(false);
    expect(
      isHighlightNotification(
        withActions(['notify', { set_tweak: 'sound', value: 'default' }, 'dont_notify'])
      )
    ).toBe(false);
    expect(
      isHighlightNotification(withActions(['notify', { set_tweak: 'highlight', value: false }]))
    ).toBe(false);
  });
});

describe('isMessageNotification', () => {
  const event = (fields: Record<string, unknown>) => ({
    event: {
      event_id: '$event',
      room_id: '!room:example.org',
      sender: '@peer:example.org',
      origin_server_ts: 1,
      content: {},
      ...fields,
    } as INotification['event'],
  });

  it('lists messages, encrypted messages and stickers', () => {
    expect(isMessageNotification(event({ type: 'm.room.message' }))).toBe(true);
    expect(isMessageNotification(event({ type: 'm.room.encrypted' }))).toBe(true);
    expect(isMessageNotification(event({ type: 'm.sticker' }))).toBe(true);
  });

  it('leaves out state events, such as the invite into a direct chat already joined', () => {
    expect(
      isMessageNotification(
        event({
          type: 'm.room.member',
          state_key: '@me:example.org',
          content: { membership: 'invite' },
        })
      )
    ).toBe(false);
    expect(isMessageNotification(event({ type: 'm.room.tombstone', state_key: '' }))).toBe(false);
  });
});
