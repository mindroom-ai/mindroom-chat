import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { RoomThreadSwipePreview } from './RoomThreadSwipePreview';

vi.mock('./MindroomRoomViewSwipe.css', () => ({
  PreviewAvatar: 'PreviewAvatar',
  PreviewBody: 'PreviewBody',
  PreviewChrome: 'PreviewChrome',
  PreviewHeader: 'PreviewHeader',
  PreviewLine: 'PreviewLine',
  PreviewLineLong: 'PreviewLineLong',
  PreviewLineMedium: 'PreviewLineMedium',
  PreviewLineShort: 'PreviewLineShort',
  PreviewTitleColumn: 'PreviewTitleColumn',
}));

describe('RoomThreadSwipePreview', () => {
  it('renders an inert presentational left-edge overview preview', () => {
    const renderer = create(
      React.createElement(RoomThreadSwipePreview, {
        direction: 'left',
        roomName: 'MindRoom',
        targetLabel: 'Overview',
      })
    );
    const aside = renderer.root.findByType('aside');

    expect(aside.props['aria-hidden']).toBe('true');
    expect(aside.props.inert).toBe('');
    expect(aside.props['data-room-thread-swipe-preview']).toBe('true');
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
  });

  it('renders a passive right-edge thread label without mounting live thread content', () => {
    const renderer = create(
      React.createElement(RoomThreadSwipePreview, {
        direction: 'right',
        roomName: 'MindRoom',
        targetLabel: 'Agent run',
        targetThreadId: '$thread',
      })
    );

    expect(renderer.toJSON()).toMatchObject({
      type: 'aside',
      props: expect.objectContaining({
        'aria-hidden': 'true',
        inert: '',
      }),
    });
    expect(renderer.root.findAllByProps({ 'data-room-thread-overview': 'true' })).toHaveLength(0);
  });
});
