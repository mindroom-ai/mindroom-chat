// @vitest-environment jsdom

import React from 'react';
import { EventEmitter } from 'events';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MatrixEvent, MatrixEventEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasPanelProps } from './CanvasPanel';
import { RoomCanvasPanel } from './RoomCanvasPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const panels = vi.hoisted(() => ({ props: undefined as CanvasPanelProps | undefined }));

vi.mock('./CanvasPanel', () => ({
  CanvasPanel: (props: CanvasPanelProps) => {
    panels.props = props;
    return null;
  },
}));
// Uploaded pages download through the media API; these requests carry their page inline.
vi.mock('./useCanvasPage', () => ({
  useCanvasPage: (_mx: unknown, _roomId: string, _revision: string, canvas: { html?: string }) =>
    canvas.html === undefined ? { status: 'loading' } : { status: 'ready', html: canvas.html },
}));
vi.mock('../sidebar/ResizablePanel', () => ({
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../hooks/useTheme', () => ({
  ThemeKind: { Light: 'light', Dark: 'dark' },
  useTheme: () => ({ id: 'light-theme', kind: 'light' }),
}));
vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop', Tablet: 'Tablet', Mobile: 'Mobile' },
  useScreenSizeContext: () => 'Desktop',
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

const ROOM_ID = '!room:example.org';
const AGENT = '@mindroom_planner:example.org';
const VIEWER = '@alice:example.org';

const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) => ({ userId, membership: 'join', rawDisplayName: 'Planner' }),
} as unknown as Room;

const metadata = (html: string) => ({
  version: 1,
  action: 'show_canvas',
  requester_id: VIEWER,
  agent_user_id: AGENT,
  room_id: ROOM_ID,
  thread_id: '$thread',
  canvas: { title: 'Plans', html },
});

const request = () =>
  new MatrixEvent({
    event_id: '$canvas',
    room_id: ROOM_ID,
    sender: AGENT,
    type: 'm.room.message',
    origin_server_ts: 1,
    content: {
      msgtype: 'm.notice',
      body: 'Interactive panel: Plans.',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
      'io.mindroom.ui_action': metadata('<p>Step 1</p>'),
    },
  });

const edit = (html = '<p>Step 2</p>', { id = '$edit', ts = 2, sender = AGENT } = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.notice',
      body: '* Interactive panel: Plans.',
      'm.new_content': {
        msgtype: 'm.notice',
        body: 'Interactive panel: Plans.',
        'io.mindroom.ui_action': metadata(html),
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$canvas' },
    },
  });

let container: HTMLDivElement;
let root: Root;
let mx: MatrixClient;

const render = (event: MatrixEvent, onClose = vi.fn()) =>
  act(() => {
    root.render(
      <RoomCanvasPanel
        mx={mx}
        room={room}
        event={event}
        onClose={onClose}
        expanded={false}
        onToggleExpanded={() => undefined}
      />
    );
  });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  panels.props = undefined;
  mx = Object.assign(new EventEmitter(), {
    getSafeUserId: () => VIEWER,
  }) as unknown as MatrixClient;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('RoomCanvasPanel', () => {
  it('shows the request and follows its edits', () => {
    const event = request();
    render(event);
    expect(panels.props?.canvas.html).toBe('<p>Step 1</p>');
    act(() => event.makeReplaced(edit()));
    expect(panels.props?.canvas.html).toBe('<p>Step 2</p>');
    expect(panels.props?.canvas.revisionEventId).toBe('$edit');
  });

  it('follows an edit that lands on another copy of the request', () => {
    render(request());
    // A reset timeline or cached thread page can hold a different object for the same event.
    const copy = request();
    copy.makeReplaced(edit());
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, copy);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 2</p>');
  });

  it('never rolls back to an older edit or an edit from someone else on another copy', () => {
    const event = request();
    render(event);
    act(() => event.makeReplaced(edit('<p>Step 3</p>', { id: '$edit-3', ts: 300 })));
    const older = request();
    older.makeReplaced(edit('<p>Step 2</p>', { id: '$edit-2', ts: 200 }));
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, older);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 3</p>');
    const foreign = request();
    foreign.makeReplaced(
      edit('<p>Forged</p>', { id: '$forged', ts: 400, sender: '@mindroom_other:example.org' })
    );
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, foreign);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 3</p>');
    expect(panels.props?.canvas.revisionEventId).toBe('$edit-3');
  });

  it('ignores edits of other events', () => {
    render(request());
    const other = new MatrixEvent({ ...request().event, event_id: '$other' });
    other.makeReplaced(edit());
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, other);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 1</p>');
  });

  it('closes when the request is deleted', async () => {
    const onClose = vi.fn();
    const event = request();
    render(event, onClose);
    await act(async () => {
      event.emit(
        MatrixEventEvent.BeforeRedaction,
        event,
        new MatrixEvent({ type: 'm.room.redaction' })
      );
      event.makeRedacted(
        new MatrixEvent({ type: 'm.room.redaction', redacts: '$canvas', content: {} }),
        room
      );
    });
    expect(onClose).toHaveBeenCalled();
  });
});
