// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { createEditor, type Editor } from 'slate';
import { afterEach, expect, it, vi } from 'vitest';
import { withInlineElements } from '../../editor/utils';
import { threadForkContent } from '../../event-store/threads/threadFork';
import { MessageEditor } from './MessageEditor';

// The editor's text is set by the test; nothing is typed.
const state = vi.hoisted(() => ({
  editor: undefined as Editor | undefined,
  content: {} as Record<string, unknown>,
  sendMessage: vi.fn(async () => ({ event_id: '$edit' })),
}));
vi.mock('../../editor/Editor', () => ({
  CustomEditor: () => null,
  useEditor: () => state.editor,
}));
vi.mock('slate-react', async (original) => ({
  ...(await original<typeof import('slate-react')>()),
  ReactEditor: { focus: vi.fn() },
}));
vi.mock('./useEditableContent', () => ({
  useEditableContent: () => ({ content: state.content, failed: false }),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:example.org', sendMessage: state.sendMessage }),
}));
vi.mock('../../emoji/useImagePackRooms', () => ({ useImagePackRooms: () => [] }));
vi.mock('../../config/useClientConfig', () => ({ useOptionalClientConfig: () => undefined }));
vi.mock('../../preferences/useSettingValue', () => ({ useSettingValue: () => false }));
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Spinner: () => null,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  color: { Critical: { Main: 'red' } },
  config: { space: { S100: '4px' } },
}));

afterEach(cleanup);

const fork = { threadId: '$parent', eventId: '$point' };

it("keeps a fork root's reference in the edit, which MindRoom reads as the message", async () => {
  const original = { msgtype: 'm.text', body: 'Try Porto', ...threadForkContent(fork) };
  const root = new MatrixEvent({
    event_id: '$fork',
    room_id: '!room:example.org',
    type: 'm.room.message',
    sender: '@me:example.org',
    content: original,
  });
  state.content = original;
  const editor = withInlineElements(createEditor());
  editor.children = [{ type: 'paragraph', children: [{ text: 'Try Porto and Braga' }] }];
  state.editor = editor;
  const onDone = vi.fn();

  render(<MessageEditor room={{ roomId: '!room:example.org' } as Room} mEvent={root} onDone={onDone} />);
  await act(async () => {
    fireEvent.click(screen.getByText('Save'));
  });

  expect(state.sendMessage).toHaveBeenCalledTimes(1);
  const [, , edit] = state.sendMessage.mock.calls[0] as unknown as [
    string,
    unknown,
    Record<string, unknown>,
  ];
  expect(edit['m.new_content']).toMatchObject({
    body: 'Try Porto and Braga',
    ...threadForkContent(fork),
  });
  expect(onDone).toHaveBeenCalled();
});
