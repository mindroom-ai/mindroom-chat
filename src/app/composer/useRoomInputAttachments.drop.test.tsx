// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import { useRoomInputAttachments } from './useRoomInputAttachments';

vi.mock('./upload/UploadCardRenderer', () => ({ UploadCardRenderer: () => null }));
vi.mock('./upload/UploadBoard', () => ({
  UploadBoard: () => null,
  UploadBoardContent: () => null,
  UploadBoardHeader: () => null,
}));

const ROOM_ID = '!drop:example.org';

afterEach(() => {
  cleanup();
  act(() => getDefaultStore().set(conversationCoveredAtom, false));
});

/** The room area, a drop zone for the composer's files, and what the composer stages from it. */
const renderComposer = () => {
  const createUploadItems = vi.fn(async () => []);
  const editor = createEditor();
  editor.children = [{ type: 'paragraph', children: [{ text: '' }] }];
  let dropZoneVisible = false;
  function Composer() {
    const area = useRef<HTMLDivElement>(null);
    dropZoneVisible = useRoomInputAttachments({
      mx: { cancelUpload: vi.fn() } as never,
      userId: '@tester:example.org',
      room: { roomId: ROOM_ID, name: 'Drop', hasEncryptionStateEvent: () => false } as Room,
      roomId: ROOM_ID,
      editor,
      isMarkdown: true,
      fileDropContainerRef: area,
      createUploadItems,
    }).dropZoneVisible;
    return <div ref={area} data-testid="area" />;
  }
  const { getByTestId } = render(<Composer />);
  const file = new File(['content'], 'notes.txt', { type: 'text/plain' });
  const drag = (type: 'dragenter' | 'drop') => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
    act(() => {
      getByTestId('area').dispatchEvent(event);
    });
    return event;
  };
  return { createUploadItems, drag, file, dropZoneVisible: () => dropZoneVisible };
};

describe("the composer's file drop under a plugin's cover", () => {
  it('stages a dropped file while nothing covers the conversation', () => {
    const composer = renderComposer();
    composer.drag('dragenter');
    expect(composer.dropZoneVisible()).toBe(true);
    composer.drag('drop');
    expect(composer.createUploadItems).toHaveBeenCalledWith([composer.file]);
  });

  it('shows no drop hint and stages nothing while a cover hides it, but keeps the browser from opening the file', () => {
    const composer = renderComposer();
    act(() => getDefaultStore().set(conversationCoveredAtom, true));
    composer.drag('dragenter');
    expect(composer.dropZoneVisible()).toBe(false);
    expect(composer.drag('drop').defaultPrevented).toBe(true);
    expect(composer.createUploadItems).not.toHaveBeenCalled();
  });
});
