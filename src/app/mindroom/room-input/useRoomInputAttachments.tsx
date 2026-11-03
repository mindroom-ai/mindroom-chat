import React, {
  ClipboardEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtomValue, useStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { Descendant, Editor } from 'slate';
import { moveCursor, toMatrixCustomHTML, toPlainText } from '../../components/editor';
import { UploadBoard, UploadBoardContent, UploadBoardHeader } from '../../components/upload-board';
import { UploadCardRenderer } from '../../components/upload-card';
import { useFileDropZone } from '../../hooks/useFileDrop';
import { useFilePicker } from '../../hooks/useFilePicker';
import {
  roomIdToMsgDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  type TUploadItem,
  type TUploadMetadata,
} from '../../state/room/roomInputDrafts';
import { createUploadFamilyObserverAtom, type Upload, UploadStatus } from '../../state/upload';
import { getDataTransferFiles } from '../../utils/dom';
import type { TUploadContent } from '../../utils/matrix';
import {
  createMindroomPasteId,
  createMindroomPasteMarker,
  getMindroomPasteFileName,
} from '../messages/pasteAttachmentMarker';
import { shouldConvertPasteToAttachment } from './pasteAttachment';
import type { AttachmentSnapshot, RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import {
  createMindroomRoomInputPasteMarkerElement,
  getMindroomRoomInputPasteMarkerFileNames,
} from './RoomInputMindroomExtensions';

export type CreateRoomInputUploadItems = (
  files: File[],
  getMetadata?: (file: File, index: number) => TUploadMetadata
) => Promise<TUploadItem[]>;

type UseRoomInputAttachmentsOptions = {
  mx: MatrixClient;
  room: Room;
  roomId: string;
  /** The thread draft the composer shows; its paste attachments belong to that draft. */
  draftKey?: string;
  editor: Editor;
  isMarkdown: boolean;
  fileDropContainerRef: RefObject<HTMLElement>;
  createUploadItems: CreateRoomInputUploadItems;
};

type RoomInputAttachments = {
  access: RoomInputAttachmentAccess;
  /** The upload board above the composer, or null without staged files. */
  board: ReactNode;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  /** Drops paste attachments whose marker left the editor. */
  onEditorChange: () => void;
  stageFiles: (files: File[]) => Promise<void>;
  pickFiles: () => void;
  dropZoneVisible: boolean;
};

const isPasteItem = (item: TUploadItem): boolean => !!item.metadata.mindroomPasteAttachment;

/** The same array while it holds the same files, so observers built from it stay put. */
const useStableFiles = (files: TUploadContent[]): TUploadContent[] => {
  const previous = useRef(files);
  const same =
    previous.current.length === files.length &&
    previous.current.every((file, index) => file === files[index]);
  if (!same) previous.current = files;
  return previous.current;
};

const appendToDraft = (draft: Descendant[], node: Descendant | { text: string }): Descendant[] => [
  ...draft,
  { type: 'paragraph', children: [node] } as unknown as Descendant,
];

/**
 * The composer's staged files: picked, dropped, pasted, and large text pastes turned into a
 * file with a marker in the message. Paste files belong to the thread draft they were pasted
 * into, so another thread's composer neither shows nor sends them. Listeners hear about changes
 * after the change that caused them has finished.
 */
export const useRoomInputAttachments = ({
  mx,
  room,
  roomId,
  draftKey,
  editor,
  isMarkdown,
  fileDropContainerRef,
  createUploadItems,
}: UseRoomInputAttachmentsOptions): RoomInputAttachments => {
  const store = useStore();
  const itemsAtom = roomIdToUploadItemsAtomFamily(roomId);
  const roomItems = useAtomValue(itemsAtom);
  const [boardOpen, setBoardOpen] = useState(true);

  // Which draft owns a staged file; files without an entry belong to the room's composer.
  const owners = useRef(new Map<TUploadContent, string | undefined>());
  const enrolled = useRef<TUploadItem[]>([]);
  const leases = useRef(new Map<TUploadContent, number>());
  const listeners = useRef(new Set<() => void>());
  const notifyQueued = useRef(false);
  const mounted = useRef(true);
  const current = useRef({ roomId, draftKey, editor });
  current.current = { roomId, draftKey, editor };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const notify = useCallback(() => {
    if (notifyQueued.current) return;
    notifyQueued.current = true;
    queueMicrotask(() => {
      notifyQueued.current = false;
      Array.from(listeners.current).forEach((listener) => {
        if (listeners.current.has(listener)) listener();
      });
    });
  }, []);

  const ownedByCurrent = useCallback(
    (item: TUploadItem) => owners.current.get(item.file) === current.current.draftKey,
    []
  );

  const access = useMemo<RoomInputAttachmentAccess>(() => {
    const uploadOf = (item: TUploadItem): Upload => store.get(roomUploadAtomFamily(item.file));

    const snapshot = (targetRoomId?: string): AttachmentSnapshot => {
      const all = store.get(roomIdToUploadItemsAtomFamily(targetRoomId ?? current.current.roomId));
      const staged = targetRoomId === undefined ? all.filter(ownedByCurrent) : all;
      const files = new Set(staged.map((item) => item.file));
      const tracked = [...staged, ...enrolled.current.filter((item) => !files.has(item.file))];
      return { staged, enrolled: [...enrolled.current], uploads: tracked.map(uploadOf) };
    };

    const append = (targetRoomId: string, items: TUploadItem[]) => {
      if (items.length === 0) return;
      const owner = targetRoomId === current.current.roomId ? current.current.draftKey : undefined;
      items.forEach((item) => {
        if (!owners.current.has(item.file)) owners.current.set(item.file, owner);
        // A file that could not be prepared shows its error on its card instead of uploading.
        if (item.prepError) store.set(roomUploadAtomFamily(item.file), { error: item.prepError });
      });
      store.set(roomIdToUploadItemsAtomFamily(targetRoomId), { type: 'PUT', item: items });
      notify();
    };

    const remove = (targetRoomId: string, files: TUploadContent[]) => {
      if (files.length === 0) return;
      const removed = new Set(files);
      const listAtom = roomIdToUploadItemsAtomFamily(targetRoomId);
      const items = store.get(listAtom).filter((item) => removed.has(item.file));
      if (items.length > 0) store.set(listAtom, { type: 'DELETE', item: items });
      files.forEach((file) => owners.current.delete(file));
      enrolled.current = enrolled.current.filter((item) => !removed.has(item.file));
      notify();
    };

    return {
      snapshot,
      append,
      remove,
      enroll: (items) => {
        const known = new Set(enrolled.current.map((item) => item.file));
        enrolled.current = [...enrolled.current, ...items.filter((item) => !known.has(item.file))];
        notify();
      },
      clearEnrollment: () => {
        enrolled.current = [];
        notify();
      },
      protectPasteItems: (items) => {
        const files = items.map((item) => item.file);
        files.forEach((file) => leases.current.set(file, (leases.current.get(file) ?? 0) + 1));
        let released = false;
        return () => {
          if (released) return;
          released = true;
          files.forEach((file) => {
            const count = (leases.current.get(file) ?? 1) - 1;
            if (count > 0) leases.current.set(file, count);
            else leases.current.delete(file);
          });
        };
      },
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    };
  }, [notify, ownedByCurrent, store]);

  const onEditorChange = useCallback(() => {
    const { roomId: activeRoomId, editor: activeEditor } = current.current;
    const present = getMindroomRoomInputPasteMarkerFileNames(activeEditor.children);
    const orphans = access
      .snapshot()
      .staged.filter(
        (item) =>
          isPasteItem(item) &&
          !item.prepError &&
          !leases.current.has(item.file) &&
          !present.has(item.metadata.mindroomPasteAttachment!.fileName)
      );
    access.remove(
      activeRoomId,
      orphans.map((item) => item.file)
    );
  }, [access]);

  const stageFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const targetRoomId = current.current.roomId;
      const items = await createUploadItems(files);
      if (!mounted.current) return;
      access.append(targetRoomId, items);
    },
    [access, createUploadItems]
  );

  const pastePlainText = useCallback(
    async (text: string) => {
      const pasteRoomId = current.current.roomId;
      const pasteDraftKey = current.current.draftKey;
      const id = createMindroomPasteId();
      const fileName = getMindroomPasteFileName(id);
      const marker = { id, chars: text.length, fileName };
      const file = new File([text], fileName, { type: 'text/plain' });
      const items = await createUploadItems([file], () => ({
        markedAsSpoiler: false,
        mindroomPasteAttachment: marker,
      }));
      // A paste finishing after sign-out or unmount has nowhere left to go.
      if (!mounted.current) return;
      const [item] = items;
      if (!item) return;
      const node: Descendant | { text: string } = item.prepError
        ? { text }
        : (createMindroomRoomInputPasteMarkerElement({
            ...marker,
            raw: createMindroomPasteMarker(marker),
          }) as Descendant);

      if (current.current.roomId === pasteRoomId && current.current.draftKey === pasteDraftKey) {
        access.append(pasteRoomId, items);
        const activeEditor = current.current.editor;
        if (item.prepError) activeEditor.insertText(text);
        else {
          activeEditor.insertNode(node as Descendant);
          moveCursor(activeEditor);
        }
        return;
      }
      // The composer moved to another conversation meanwhile; the paste goes back to its own draft.
      owners.current.set(
        item.file,
        pasteRoomId === current.current.roomId ? pasteDraftKey : undefined
      );
      if (item.prepError) {
        store.set(roomUploadAtomFamily(item.file), { error: item.prepError });
      }
      store.set(roomIdToUploadItemsAtomFamily(pasteRoomId), { type: 'PUT', item: items });
      if (pasteDraftKey) {
        const draftAtom = roomIdToMsgDraftAtomFamily(pasteDraftKey);
        store.set(draftAtom, appendToDraft(store.get(draftAtom), node));
      }
      notify();
    },
    [access, createUploadItems, notify, store]
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const { clipboardData } = event;
      const files = getDataTransferFiles(clipboardData);
      if (files && files.length > 0) {
        event.preventDefault();
        stageFiles(files).catch(() => undefined);
        return;
      }
      const text = clipboardData.getData('text/plain');
      if (!text) return;
      const activeEditor = current.current.editor;
      const plainText = toPlainText(activeEditor.children, isMarkdown);
      const formattedBody = toMatrixCustomHTML(activeEditor.children, {



      });
      if (
        !shouldConvertPasteToAttachment({
          currentPlainText: plainText,
          currentFormattedBody: formattedBody,
          pastedText: text,
        })
      ) {
        return;
      }
      event.preventDefault();
      pastePlainText(text).catch(() => undefined);
    },
    [isMarkdown, pastePlainText, stageFiles]
  );

  const pickFiles = useFilePicker(
    useCallback((files: File[]) => stageFiles(files).catch(() => undefined), [stageFiles]),
    true
  );
  const dropZoneVisible = useFileDropZone(
    fileDropContainerRef,
    useCallback((files: File[]) => stageFiles(files).catch(() => undefined), [stageFiles])
  );

  // Rendering reads the owner map, so a staged list change re-renders through `roomItems`.
  const visibleItems = roomItems.filter(ownedByCurrent);
  const visibleFiles = useStableFiles(visibleItems.map((item) => item.file));
  const observerAtom = useMemo(
    () => createUploadFamilyObserverAtom(roomUploadAtomFamily, visibleFiles),
    [visibleFiles]
  );

  const cancelUploads = useCallback(



      });
      const canceled = new Set(uploads.map((upload) => upload.file));
      access.remove(
        current.current.roomId,
        access
          .snapshot()
          .staged.filter((item) => canceled.has(item.file))
          .map((item) => item.file)
      );
    },
    [access, mx]
  );

  const board =
    visibleItems.length > 0 ? (
      <UploadBoard
        header={
          <UploadBoardHeader
            open={boardOpen}
            onToggle={() => setBoardOpen((open) => !open)}
            uploadFamilyObserverAtom={observerAtom}
            onCancel={cancelUploads}
          />
        }
      >
        {boardOpen && (
          <UploadBoardContent>
            {visibleItems.map((item) => (
              <UploadCardRenderer
                key={`${visibleFiles.indexOf(item.file)}:${item.file.name}`}
                isEncrypted={room.hasEncryptionStateEvent()}
                fileItem={item}
                setMetadata={(fileItem, metadata) =>
                  store.set(itemsAtom, {



                  })
                }
                onRemove={(file) => access.remove(current.current.roomId, [file])}
              />
            ))}
          </UploadBoardContent>
        )}
      </UploadBoard>
    ) : null;

  return { access, board, onPaste, onEditorChange, stageFiles, pickFiles, dropZoneVisible };
};
