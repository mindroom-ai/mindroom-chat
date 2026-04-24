import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('RoomTimeline architecture', () => {
  it('delegates thread badge JSX rendering to the MindRoom badge renderer', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('const renderThreadBadge');
    expect(source).toContain('ThreadBadgeRenderer');
  });

  it('keeps renderability and preload counting outside RoomTimeline', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('export const isRenderableEvent =');
    expect(source).not.toContain('export const getRoomPreloadCounts =');
    expect(source).toContain("from './roomTimelineEvents'");
  });

  it('delegates eager room preload orchestration outside RoomTimeline', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useRoomEagerPreload');
    expect(source).not.toContain('[eager-preload]');
  });
});
