// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { Transforms, type Editor } from 'slate';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageEditor } from './MessageEditor';

const state = vi.hoisted(() => ({
  content: {},
  editor: undefined as Editor | undefined,
  sendMessage: vi.fn<() => Promise<{ event_id: string }>>(),
}));

vi.mock('../../editor/Editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../editor/Editor')>();
  return {
    ...actual,
    useEditor: () => {
      const editor = actual.useEditor();
      state.editor = editor;
      return editor;
    },
  };
});
vi.mock('./useEditableContent', () => ({
  useEditableContent: () => ({ content: state.content, failed: false }),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:example.org', sendMessage: state.sendMessage }),
  useOptionalMatrixClient: () => undefined,
}));
vi.mock('../../emoji/useImagePackRooms', () => ({ useImagePackRooms: () => [] }));
vi.mock('../../config/useClientConfig', () => ({ useOptionalClientConfig: () => undefined }));
vi.mock('../../preferences/useSettingValue', () => ({ useSettingValue: () => false }));
vi.mock('../../editor/autocomplete/EmoticonAutocomplete', () => ({
  EmoticonAutocomplete: () => null,
}));

// jsdom does not implement isContentEditable, which slate-react checks in non-readOnly key handlers.
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
  configurable: true,
  get(this: HTMLElement) {
    return this.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true';
  },
});

afterEach(() => {
  cleanup();
  state.editor = undefined;
  state.sendMessage.mockReset();
});

const makeEvent = (body: string) => {
  const original = { msgtype: 'm.text', body };
  state.content = original;
  return new MatrixEvent({
    event_id: '$msg',
    room_id: '!room:example.org',
    type: 'm.room.message',
    sender: '@me:example.org',
    content: original,
  });
};

it('closes on Escape while editing, but ignores Escape while saving in readOnly mode', async () => {
  // Verify Escape works while editing (sanity check that key events reach handleKeyDown).
  const onCancelEditing = vi.fn();
  const first = render(
    <MessageEditor
      room={{ roomId: '!room:example.org' } as Room}
      mEvent={makeEvent('Before edit')}
      onDone={onCancelEditing}
    />
  );
  const firstEditable = first.container.querySelector<HTMLElement>(
    '[data-editable-name="MessageEditor"]'
  )!;
  fireEvent.keyDown(firstEditable, { key: 'Escape', code: 'Escape', keyCode: 27 });
  expect(onCancelEditing).toHaveBeenCalledTimes(1);
  cleanup();

  // Now start saving and verify Escape does not close the editor while readOnly={saving}.
  let resolveSend: ((value: { event_id: string }) => void) | undefined;
  state.sendMessage.mockImplementation(
    () =>
      new Promise<{ event_id: string }>((resolve) => {
        resolveSend = resolve;
      })
  );
  const onDone = vi.fn();
  const { container } = render(
    <MessageEditor
      room={{ roomId: '!room:example.org' } as Room}
      mEvent={makeEvent('Before edit')}
      onDone={onDone}
    />
  );
  await act(async () => {
    Transforms.insertText(state.editor!, ' updated');
  });
  await act(async () => {
    fireEvent.click(screen.getByText('Save'));
  });

  const editable = container.querySelector<HTMLElement>('[data-editable-name="MessageEditor"]')!;
  expect(editable.getAttribute('contenteditable')).toBe('false');
  fireEvent.keyDown(editable, { key: 'Escape', code: 'Escape', keyCode: 27 });
  expect(onDone).not.toHaveBeenCalled();

  await act(async () => {
    resolveSend?.({ event_id: '$edit' });
  });
  expect(onDone).toHaveBeenCalledTimes(1);
});
