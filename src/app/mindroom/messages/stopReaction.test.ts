import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import {
  STOP_REACTION_KEYS,
  getRenderableAnnotationsByKey,
  isStaleStopReactionKey,
} from './stopReaction';

const makeTargetEvent = (content: Record<string, unknown>): MatrixEvent =>
  ({ getContent: () => content } as MatrixEvent);

const makeReactionEvent = (): MatrixEvent =>
  ({
    getSender: () => '@agent:mindroom.chat',
    getRelation: () => ({ rel_type: 'm.annotation' }),
    isRedacted: () => false,
  } as MatrixEvent);

const makeRelations = (keys: string[]): Relations =>
  ({
    getSortedAnnotationsByKey: () => keys.map((key) => [key, new Set([makeReactionEvent()])]),
  } as unknown as Relations);

describe('isStaleStopReactionKey', () => {
  it.each(['🛑', '⏹️', '⏹'])('hides the %s stop chip when stream_status is terminal', (key) => {
    const target = makeTargetEvent({ 'io.mindroom.stream_status': 'completed' });
    expect(isStaleStopReactionKey(key, target)).toBe(true);
  });

  it.each(['completed', 'cancelled', 'interrupted', 'error'])(
    'treats backend terminal status %s as stale',
    (status) => {
      const target = makeTargetEvent({ 'io.mindroom.stream_status': status });
      expect(isStaleStopReactionKey('🛑', target)).toBe(true);
    }
  );

  it('prefers m.new_content status over a stale top-level status', () => {
    const target = makeTargetEvent({
      'io.mindroom.stream_status': 'streaming',
      'm.new_content': { 'io.mindroom.stream_status': 'completed' },
    });
    expect(isStaleStopReactionKey('🛑', target)).toBe(true);
  });

  it('hides the stop chip when ai_run metadata proves a terminal run', () => {
    const target = makeTargetEvent({
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
    });
    expect(isStaleStopReactionKey('🛑', target)).toBe(true);
  });

  it('keeps the stop chip while the stream is active', () => {
    for (const status of ['pending', 'streaming']) {
      const target = makeTargetEvent({ 'io.mindroom.stream_status': status });
      expect(isStaleStopReactionKey('🛑', target)).toBe(false);
    }
  });

  it('keeps a stop-key reaction on messages without stream metadata', () => {
    expect(isStaleStopReactionKey('🛑', makeTargetEvent({ body: 'hello' }))).toBe(false);
  });

  it('keeps the stop chip when the target event is unavailable', () => {
    expect(isStaleStopReactionKey('🛑', undefined)).toBe(false);
  });

  it('never hides non-stop keys, even on terminal messages', () => {
    const target = makeTargetEvent({ 'io.mindroom.stream_status': 'completed' });
    expect(isStaleStopReactionKey('👍', target)).toBe(false);
  });

  it('covers the current and legacy backend stop keys', () => {
    expect(STOP_REACTION_KEYS.has('🛑')).toBe(true);
    expect(STOP_REACTION_KEYS.has('⏹️')).toBe(true);
  });
});

describe('getRenderableAnnotationsByKey', () => {
  it('filters only the stale stop key from a mixed reaction set', () => {
    const target = makeTargetEvent({ 'io.mindroom.stream_status': 'completed' });
    const entries = getRenderableAnnotationsByKey(makeRelations(['👍', '🛑']), target);
    expect(entries.map(([key]) => key)).toEqual(['👍']);
  });

  it('keeps all keys when the target has no terminal metadata', () => {
    const entries = getRenderableAnnotationsByKey(
      makeRelations(['👍', '🛑']),
      makeTargetEvent({ 'io.mindroom.stream_status': 'streaming' })
    );
    expect(entries.map(([key]) => key)).toEqual(['👍', '🛑']);
  });

  it('keeps ordinary reactions on a terminal message', () => {
    const entries = getRenderableAnnotationsByKey(
      makeRelations(['👍']),
      makeTargetEvent({ 'io.mindroom.stream_status': 'completed' })
    );
    expect(entries.map(([key]) => key)).toEqual(['👍']);
  });
});
