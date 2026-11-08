import { describe, expect, it } from 'vitest';
import type { CallParticipant, CallVideoTrack } from './RoomCall';
import {
  SPEAKER_VIEW_MIN_TILE,
  byPerson,
  fitTiles,
  hasVideo,
  pickFocus,
  sharedScreens,
} from './stageLayout';

const track = {} as CallVideoTrack;

const person = (name: string, rest: Partial<CallParticipant> = {}): CallParticipant => ({
  key: `@${name}:stage.test:DEVICE`,
  userId: `@${name}:stage.test`,
  deviceId: 'DEVICE',
  local: false,
  connected: true,
  speaking: false,
  microphone: true,
  ...rest,
});

const me = person('me', { local: true });
const mind = person('mind');
const ada = person('ada');

describe('fitTiles', () => {
  it('picks the columns that make tiles biggest at 4:3, then lets each stretch toward 16:9', () => {
    const fit = fitTiles(4, 384, 189, 6);

    expect(fit.columns).toBe(2);
    expect(fit.tileWidth).toBeCloseTo(162.7, 1);
    expect(fit.tileHeight).toBeCloseTo(91.5, 1);
  });

  it('keeps a lone tile in a wide stage no wider than 16:9', () => {
    const fit = fitTiles(1, 600, 200, 6);

    expect(fit.columns).toBe(1);
    expect(fit.tileWidth).toBeCloseTo(355.6, 1);
    expect(fit.tileHeight).toBe(200);
  });

  it('keeps a tile in a tall stage no taller than square', () => {
    const fit = fitTiles(1, 300, 600, 6);

    expect(fit.tileWidth).toBe(300);
    expect(fit.tileHeight).toBe(300);
  });

  // The column count each stage gives one to six tiles: a wide stage lays them in a row (two
  // rows from four), a tall one stacks them, a tiny one packs them as best it can.
  const STAGES = {
    wide: { width: 800, height: 300, columns: [1, 2, 3, 2, 3, 3] },
    tall: { width: 300, height: 800, columns: [1, 1, 1, 1, 1, 1] },
    tiny: { width: 200, height: 120, columns: [1, 2, 2, 2, 3, 3] },
  } as const;
  const cases = Object.entries(STAGES).flatMap(([stage, { width, height, columns }]) =>
    columns.map((expected, index) => ({ stage, count: index + 1, width, height, expected }))
  );

  it.each(cases)(
    '$stage stage: $count tiles in $expected columns, inside the stage, between square and 16:9',
    ({ count, width, height, expected }) => {
      const gap = 6;
      const fit = fitTiles(count, width, height, gap);
      const rows = Math.ceil(count / fit.columns);

      expect(fit.columns).toBe(expected);
      expect(fit.columns * fit.tileWidth + (fit.columns - 1) * gap).toBeLessThanOrEqual(
        width + 1e-9
      );
      expect(rows * fit.tileHeight + (rows - 1) * gap).toBeLessThanOrEqual(height + 1e-9);
      expect(fit.tileWidth / fit.tileHeight).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(fit.tileWidth / fit.tileHeight).toBeLessThanOrEqual(16 / 9 + 1e-9);
    }
  );

  it('reports tiles under the speaker-view threshold in a small stage', () => {
    expect(fitTiles(4, 300, 120, 6).size).toBeLessThan(SPEAKER_VIEW_MIN_TILE);
    expect(fitTiles(2, 384, 300, 6).size).toBeGreaterThanOrEqual(SPEAKER_VIEW_MIN_TILE);
  });
});

describe('hasVideo', () => {
  it('is on while anyone shares a camera or a screen', () => {
    expect(hasVideo([me, mind])).toBe(false);
    expect(hasVideo([me, { ...mind, video: track }])).toBe(true);
    expect(hasVideo([{ ...me, screen: track }, mind])).toBe(true);
  });
});

describe('byPerson', () => {
  const phone = (who: CallParticipant, rest: Partial<CallParticipant> = {}): CallParticipant => ({
    ...who,
    key: `${who.userId}:PHONE`,
    deviceId: 'PHONE',
    local: false,
    ...rest,
  });

  it("gives one entry per person, in the order they joined, with their devices' states", () => {
    const quietLaptop = { ...ada, connected: false, microphone: false };
    const people = byPerson([quietLaptop, mind, phone(ada, { speaking: true }), phone(mind)]);
    expect(people.map(({ userId }) => userId)).toEqual([ada.userId, mind.userId]);
    expect(people[0]).toMatchObject({
      key: ada.key,
      connected: true,
      speaking: true,
      microphone: true,
      local: false,
    });
    expect(people[1]).toEqual(mind);
  });

  it("counts this person's other device as this device's person", () => {
    expect(byPerson([phone(me), mind, me])).toEqual([{ ...phone(me), local: true }, mind]);
  });
});

describe('sharedScreens', () => {
  it("lists the sharers in the call's order, this device's own last", () => {
    const sharers = [{ ...me, screen: track }, mind, { ...ada, screen: track }];

    expect(sharedScreens(sharers).map(({ key }) => key)).toEqual([ada.key, me.key]);
    expect(sharedScreens([me, mind])).toEqual([]);
  });
});

describe('pickFocus', () => {
  it('puts a shared screen in focus, before any speaker', () => {
    const speaking = { ...mind, speaking: true };

    expect(pickFocus([{ ...me, screen: track }, speaking], undefined)).toBe(`${me.key}:screen`);
    expect(pickFocus([me, speaking, { ...ada, screen: track }], mind.key)).toBe(
      `${ada.key}:screen`
    );
  });

  it("puts someone else's screen in focus over this device's own", () => {
    const participants = [{ ...me, screen: track }, mind, { ...ada, screen: track }];

    expect(pickFocus(participants, undefined)).toBe(`${ada.key}:screen`);
  });

  it('follows the first remote speaker, not this device', () => {
    const participants = [{ ...me, speaking: true }, mind, { ...ada, speaking: true }];

    expect(pickFocus(participants, mind.key)).toBe(ada.key);
  });

  it('keeps the remote in focus while it still speaks, though an earlier one speaks too', () => {
    const participants = [me, { ...mind, speaking: true }, { ...ada, speaking: true }];

    expect(pickFocus(participants, ada.key)).toBe(ada.key);
  });

  it('keeps the last remote in focus while nobody speaks', () => {
    expect(pickFocus([me, mind, ada], ada.key)).toBe(ada.key);
  });

  it('falls back to the first remote once the last one left', () => {
    expect(pickFocus([me, mind, ada], person('gone').key)).toBe(mind.key);
    expect(pickFocus([me, mind, ada], `${ada.key}:screen`)).toBe(mind.key);
  });

  it('leaves this device for the first remote that joins', () => {
    expect(pickFocus([me], undefined)).toBe(me.key);
    expect(pickFocus([me, mind], me.key)).toBe(mind.key);
  });

  it('has nothing to focus in an empty call', () => {
    expect(pickFocus([], undefined)).toBeUndefined();
  });
});
