import { describe, expect, it } from 'vitest';
import type { CommandPaletteRoomItem } from './commandPaletteTypes';
import { commandPaletteSearchConfig, searchCommandPaletteSection } from './commandPaletteSearch';

const room = (id: string, name: string, boost = 0): CommandPaletteRoomItem => ({
  id,
  kind: 'room',
  name,
  topic: 'Talk about the plan',
  boost,
});

describe('searchCommandPaletteSection room names', () => {
  it('ranks a room whose name matches above unread rooms that match only by topic', () => {
    const items = [
      room('!a:example.org', 'Team room 1', 25),
      room('!b:example.org', 'Team room 2', 25),
      room('!named:example.org', 'Quarterly planning for the customer onboarding redesign'),
    ];

    const results = searchCommandPaletteSection({
      items,
      query: 'plan',
      config: commandPaletteSearchConfig.rooms,
    });

    expect(results[0]?.id).toBe('!named:example.org');
    expect(results).toHaveLength(3);
  });

  it('keeps the boost order among rooms that match the same way', () => {
    const items = [room('!a:example.org', 'Team room 1'), room('!b:example.org', 'Team room 2', 25)];

    const results = searchCommandPaletteSection({
      items,
      query: 'plan',
      config: commandPaletteSearchConfig.rooms,
    });

    expect(results.map((item) => item.id)).toEqual(['!b:example.org', '!a:example.org']);
  });
});
