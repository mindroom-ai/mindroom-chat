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

  it('ranks a name that holds the typed text above names that only resemble it', () => {
    const items = [
      room('!fuzzy:example.org', 'Weekly sync with the platform crew', 25),
      room('!space:example.org', 'Platform reliability', 25),
      room('!named:example.org', 'Quarterly planning for the customer onboarding redesign'),
    ];

    const results = searchCommandPaletteSection({
      items,
      query: 'Plan',
      config: commandPaletteSearchConfig.rooms,
    });

    expect(results[0]?.id).toBe('!named:example.org');
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
