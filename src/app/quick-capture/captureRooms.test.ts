import { describe, expect, it } from 'vitest';
import {
  buildCaptureRooms,
  CaptureRoomSource,
  filterCaptureRooms,
  MAX_CAPTURE_ROOMS,
  MAX_PICKER_ROWS,
} from './captureRooms';

const source = (id: string, extra: Partial<CaptureRoomSource> = {}): CaptureRoomSource => ({
  id,
  name: id,
  direct: false,
  space: false,
  lastActiveTs: 0,
  ...extra,
});

describe('buildCaptureRooms', () => {
  it('leaves spaces out and orders by newest activity', () => {
    const rooms = buildCaptureRooms([
      source('old', { lastActiveTs: 1 }),
      source('space', { space: true, lastActiveTs: 9 }),
      source('new', { lastActiveTs: 5 }),
    ]);
    expect(rooms.map((room) => room.id)).toEqual(['new', 'old']);
  });

  it('keeps direct and drops the other source fields', () => {
    expect(
      buildCaptureRooms([source('a', { name: 'Ann', direct: true, lastActiveTs: 3 })])
    ).toEqual([{ id: 'a', name: 'Ann', direct: true }]);
  });

  it('keeps at most 500 rooms', () => {
    const many = Array.from({ length: 520 }, (_, index) =>
      source(`r${index}`, { lastActiveTs: index })
    );
    const rooms = buildCaptureRooms(many);
    expect(rooms).toHaveLength(MAX_CAPTURE_ROOMS);
    expect(rooms[0]?.id).toBe('r519');
  });
});

describe('filterCaptureRooms', () => {
  const rooms = ['Research', 'Core', 'Lab'].map((name) => ({ id: name, name, direct: false }));

  it('gives the first 50 rows for an empty query', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      id: `${index}`,
      name: `R${index}`,
      direct: false,
    }));
    expect(filterCaptureRooms(many, '')).toEqual(many.slice(0, MAX_PICKER_ROWS));
  });

  it('matches case-insensitively anywhere in the name', () => {
    expect(filterCaptureRooms(rooms, 're').map((room) => room.name)).toEqual(['Research', 'Core']);
    expect(filterCaptureRooms(rooms, 'RE').map((room) => room.name)).toEqual(['Research', 'Core']);
  });

  it('gives no rows when nothing matches', () => {
    expect(filterCaptureRooms(rooms, 'zzz')).toEqual([]);
  });
});
