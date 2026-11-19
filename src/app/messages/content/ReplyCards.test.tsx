// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { ChatUiActionContext } from '../../ui-actions/ChatUiActionProvider';
import type { ChatUiAction } from '../../matrix/protocol/chatUiProtocol';
import type { ParsedScheduledTask } from '../../matrix/protocol/scheduledTaskContract';
import { ReplyCards } from './ReplyCards';

const notice = new MatrixEvent({ event_id: '$canvas', type: 'm.room.message' });
const action = {
  action: 'show_canvas',
  eventId: '$canvas',
  agentUserId: '@mindroom_helper:example.org',
  canvas: { title: 'Project Alpha KPIs', html: '<p>KPIs</p>' },
  revisionEventId: '$canvas',
  event: notice,
  requesterId: '@alice:example.org',
} as ChatUiAction;
const reminder: ParsedScheduledTask = {
  taskId: 'task1234',
  status: 'pending',
  threadId: '$root',
  newThread: false,
  executeAt: '2026-11-20T09:30:00Z',
  description: 'Weekly planning review',
};

const renderCards = (enabled: boolean, unavailable?: string) => {
  const activate = vi.fn();
  render(
    <ClientConfigProvider value={{ mindroom: { canvas: { enabled } } }}>
      <ChatUiActionContext.Provider
        value={{ read: () => action, unavailable: () => unavailable, activate }}
      >
        <ReplyCards cards={[{ canvas: notice }, { reminder }]} />
      </ChatUiActionContext.Provider>
    </ClientConfigProvider>
  );
  return activate;
};

describe('ReplyCards', () => {
  afterEach(cleanup);

  it('opens the canvas from its card and shows the reminder beside it', () => {
    const activate = renderCards(true);
    fireEvent.click(screen.getByRole('button', { name: /Project Alpha KPIs/ }));

    expect(activate).toHaveBeenCalledWith(notice);
    expect(screen.getByText('Weekly planning review')).toBeTruthy();
    expect(screen.getByText(/^Reminder · /)).toBeTruthy();
  });

  it('draws no canvas card, not even a disabled one, with canvases turned off', () => {
    renderCards(false);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Weekly planning review')).toBeTruthy();
  });

  it('says why a canvas cannot open now', () => {
    renderCards(true, 'End the call to open interactive panels.');

    expect(screen.getByRole('button', { name: /End the call/ })).toBeTruthy();
  });
});
