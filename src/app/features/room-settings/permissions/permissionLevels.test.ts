import { describe, expect, it } from 'vitest';
import { levelIn, withLevel } from './permissionLevels';

describe('levelIn', () => {
  it('reads what the room sets and the specification defaults otherwise', () => {
    const levels = { events: { 'm.room.name': 75 }, invite: 10, users_default: 5 };
    expect(levelIn(levels, { kind: 'state', type: 'm.room.name' })).toBe(75);
    // Unset state events need 50, unset message events need events_default (0).
    expect(levelIn(levels, { kind: 'state', type: 'm.room.topic' })).toBe(50);
    expect(levelIn(levels, { kind: 'event', type: 'm.reaction' })).toBe(0);
    expect(levelIn(levels, { kind: 'action', action: 'invite' })).toBe(10);
    expect(levelIn(levels, { kind: 'action', action: 'ban' })).toBe(50);
    expect(levelIn(levels, { kind: 'notification', key: 'room' })).toBe(50);
    expect(levelIn(levels, { kind: 'field', field: 'users_default' })).toBe(5);
    expect(levelIn({}, { kind: 'field', field: 'state_default' })).toBe(50);
  });
});

describe('withLevel', () => {
  const stored = {
    users: { '@admin:example.org': 100 },
    events: { 'm.room.name': 50 },
    notifications: { room: 50 },
    ban: 50,
  };

  it('changes one slot and keeps the rest of the stored content', () => {
    expect(withLevel(stored, { kind: 'state', type: 'm.room.topic' }, 75)).toEqual({
      ...stored,
      events: { 'm.room.name': 50, 'm.room.topic': 75 },
    });
    expect(withLevel(stored, { kind: 'notification', key: 'room' }, 100).notifications).toEqual({
      room: 100,
    });
    expect(withLevel(stored, { kind: 'action', action: 'kick' }, 25)).toMatchObject({
      kick: 25,
      ban: 50,
    });
    expect(withLevel(stored, { kind: 'field', field: 'users_default' }, 1)).toMatchObject({
      users_default: 1,
      users: stored.users,
    });
  });

  it('starts the events map when the room has none, and leaves the input untouched', () => {
    const bare = { ban: 50 };
    expect(withLevel(bare, { kind: 'event', type: 'm.sticker' }, 10)).toEqual({
      ban: 50,
      events: { 'm.sticker': 10 },
    });
    expect(bare).toEqual({ ban: 50 });
  });
});
