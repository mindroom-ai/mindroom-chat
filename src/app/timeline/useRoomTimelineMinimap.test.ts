// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomTimelineMinimap } from './useRoomTimelineMinimap';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const message = (id: string, body: string) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender: '@alice:example.org',
    content: { msgtype: 'm.text', body },
  });

const events = [message('$one', 'First question'), message('$two', 'Second question')];

const minimapItems = (inThread: boolean) =>
  renderHook(() =>
    useRoomTimelineMinimap({
      minimapEvents: events,
      inThread,
      scrollRef: { current: null },
      handleOpenEvent: async () => undefined,
    })
  ).result.current.minimapItems;

describe('useRoomTimelineMinimap', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: fine)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the minimap in a thread', () => {
    expect(minimapItems(true).map((item) => item.id)).toEqual(['$one', '$two']);
  });

  it('never shows it in a flat room timeline', () => {
    expect(minimapItems(false)).toEqual([]);
  });
});
