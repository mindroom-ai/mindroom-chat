import { describe, expect, it } from 'vitest';
import type { CallParticipant, CallVideoTrack } from './RoomCall';
import { SPEAKER_VIEW_MIN_TILE, fitTiles, hasVideo, pickFocus } from './stageLayout';

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

describe('pickFocus', () => {
  it('puts the first shared screen in focus, before any speaker', () => {
    const sharing = { ...me, screen: track };
    const speaking = { ...mind, speaking: true };

    expect(pickFocus([sharing, speaking, { ...ada, screen: track }], undefined)).toBe(
      `${me.key}:screen`
    );
  });

  it('follows the first remote speaker, not this device', () => {
    const participants = [{ ...me, speaking: true }, mind, { ...ada, speaking: true }];

    expect(pickFocus(participants, mind.key)).toBe(ada.key);
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
