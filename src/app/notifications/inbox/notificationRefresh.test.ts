import type { INotification } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { mergeRefreshedNotifications } from './notificationRefresh';

const notification = (id: string, read = false): INotification =>
  ({
    room_id: '!room:example.org',
    read,
    ts: 1,
    actions: ['notify'],
    event: { event_id: id, type: 'm.room.message', content: { body: id } },
  } as unknown as INotification);

const ids = (notifications: INotification[]) => notifications.map(({ event }) => event.event_id);

describe('mergeRefreshedNotifications', () => {
  it('takes the server’s read flags and keeps the objects of rows that did not change', () => {
    const held = [notification('$c'), notification('$b'), notification('$a')];
    const merged = mergeRefreshedNotifications(
      { notifications: held },
      [notification('$c', true), notification('$b'), notification('$a')],
      undefined
    );
    expect(merged.notifications.map(({ read }) => read)).toEqual([true, false, false]);
    expect(merged.notifications[0]).not.toBe(held[0]);
    // The changed row keeps its event, so the row does not resolve and decrypt it again.
    expect(merged.notifications[0]?.event).toBe(held[0]?.event);
    expect(merged.notifications[1]).toBe(held[1]);
    expect(merged.notifications[2]).toBe(held[2]);
  });

  it('puts new notifications on top and keeps the older rows loaded past the answer', () => {
    const held = ['$d', '$c', '$b', '$a'].map((id) => notification(id));
    const merged = mergeRefreshedNotifications(
      { notifications: held, nextToken: 'after-a' },
      [notification('$e'), notification('$d'), notification('$c')],
      'after-c'
    );
    expect(ids(merged.notifications)).toEqual(['$e', '$d', '$c', '$b', '$a']);
    expect(merged.nextToken).toBe('after-a');
    expect(merged.notifications[3]).toBe(held[2]);
  });

  it('drops rows the server no longer lists, such as a deleted message', () => {
    const merged = mergeRefreshedNotifications(
      { notifications: ['$c', '$b', '$a'].map((id) => notification(id)) },
      [notification('$c'), notification('$a')],
      undefined
    );
    expect(ids(merged.notifications)).toEqual(['$c', '$a']);
    expect(merged.nextToken).toBeUndefined();
  });

  it('replaces the rows when the answer does not reach them', () => {
    const merged = mergeRefreshedNotifications(
      { notifications: [notification('$b'), notification('$a')], nextToken: 'after-a' },
      [notification('$d'), notification('$c')],
      'after-c'
    );
    expect(ids(merged.notifications)).toEqual(['$d', '$c']);
    expect(merged.nextToken).toBe('after-c');
  });
});
