import {
  ClipboardEvent,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtomValue, useStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Transforms, type Descendant, type Editor } from 'slate';
import { moveCursor } from '../editor/utils';
import { toMatrixCustomHTML, toPlainText } from '../editor/output';
import { UploadBoard, UploadBoardContent, UploadBoardHeader } from './upload/UploadBoard';
import { UploadCardRenderer } from './upload/UploadCardRenderer';
import { useFileDropZone } from '../lib/hooks/useFileDrop';
import { useFilePicker } from '../lib/hooks/useFilePicker';
import {
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
  keepStagedFileNames,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  composerUploadItemsAtom,
  hasUploadList,
} from './roomInputDrafts';
import { ConversationViewContext, composerStateKey } from '../navigation/conversationView';
import { forgetPastesOutsideDraft, keepPasteText, readKeptPasteTexts } from './keptPastes';
import {
  createUploadFamilyObserverAtom,
  type TUploadItem,
  type TUploadMetadata,
  type Upload,
  UploadStatus,
} from '../matrix/state/upload';
import { getDataTransferFiles } from '../lib/dom';
import type { TUploadContent } from '../matrix/matrix';
import {
  createPasteId,
  createPasteMarker,
  getPasteFileName,
  getPasteIdFromFileName,
} from '../matrix/protocol/pasteAttachmentMarker';
import { shouldConvertPasteToAttachment } from './pasteAttachment';
import type { AttachmentSnapshot, RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import {
  createRoomInputPasteMarkerElement,
  getRoomInputPasteMarkerFileNames,
  isRoomInputPasteMarkerElement,
} from './RoomInputExtensions';

type CreateRoomInputUploadItems = (
  files: File[],
  getMetadata?: (file: File, index: number) => TUploadMetadata
) => Promise<TUploadItem[]>;

type UseRoomInputAttachmentsOptions = {
  mx: MatrixClient;
  /** The account whose composer this is; the names of its staged files are kept under it. */
  userId: string;
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
  pickFiles: () => void;
  dropZoneVisible: boolean;
  /** A paste chip of the draft lost its text in a reload and left the draft. */
  lostPastes: boolean;
  /** Hides the lost pastes' notice. */
  dismissLostPastes: () => void;
  /**
   * Before a send: gives each paste chip without its file the text kept for it, or takes the chip
   * out of the draft with the notice. False when a chip went, so the person sees what changed;
   * true at once when every chip has its file.
   */
  settlePastes: () => true | Promise<boolean>;
};

const isPasteItem = (item: TUploadItem): boolean => !!item.metadata.mindroomPasteAttachment;

const pasteFileNameOf = (item: TUploadItem): string | undefined =>
  item.metadata.mindroomPasteAttachment?.fileName;

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
  userId,
  room,
  roomId,
  draftKey,
  editor,
  isMarkdown,
  fileDropContainerRef,
  createUploadItems,
}: UseRoomInputAttachmentsOptions): RoomInputAttachments => {
  const store = useStore();
  // Another view of the room (a plugin's thread view) stages its own files, and keeps no names.
  const view = useContext(ConversationViewContext);
  const itemsAtom = composerUploadItemsAtom(roomId, view);
  const roomItems = useAtomValue(itemsAtom);
  const [boardOpen, setBoardOpen] = useState(true);

  // Which draft owns a staged paste file.
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

  // The names of a room's staged files follow every change, so a reload can say what it lost.
  const keepNames = useCallback(
    (targetRoomId: string) => {
      if (!userId || view !== undefined) return;
      keepStagedFileNames(
        userId,
        targetRoomId,
        store.get(roomIdToUploadItemsAtomFamily(targetRoomId))
      );
    },
    [store, userId, view]
  );

  // Paste files belong to the draft they were pasted into; other files to the room's composer,
  // whichever conversation it shows.
  const ownedByCurrent = useCallback(
    (item: TUploadItem) =>
      !isPasteItem(item) ||
      !owners.current.has(item.file) ||
      owners.current.get(item.file) === current.current.draftKey,
    []
  );

  // Upload progress of every staged or claimed file wakes the listeners too: a send session
  // waits on uploads, which change outside this hook.
  const uploadWatches = useRef(new Map<TUploadContent, () => void>());
  const watchedRooms = useRef(new Set<string>([roomId]));
  watchedRooms.current.add(roomId);
  const syncUploadWatches = useCallback(() => {
    // An unmounted composer watches nothing: a send it left follows its own uploads.
    if (!mounted.current) return;
    const needed = new Set<TUploadContent>(enrolled.current.map((item) => item.file));
    watchedRooms.current.forEach((watchedRoomId) =>
      store
        .get(composerUploadItemsAtom(watchedRoomId, view))
        .forEach((item) => needed.add(item.file))
    );
    uploadWatches.current.forEach((unsubscribe, file) => {
      if (needed.has(file)) return;
      unsubscribe();
      uploadWatches.current.delete(file);
    });
    needed.forEach((file) => {
      if (uploadWatches.current.has(file)) return;
      uploadWatches.current.set(file, store.sub(roomUploadAtomFamily(file), notify));
    });
  }, [notify, store, view]);

  // An unmounted composer has no listeners left to wake; the next one watches the files again.
  useEffect(() => {
    const watches = uploadWatches.current;
    return () => {
      watches.forEach((unsubscribe) => unsubscribe());
      watches.clear();
    };
  }, []);

  const access = useMemo<RoomInputAttachmentAccess>(() => {
    // A send its thread view's composer left may outlive the view and its staged list: reading
    // the list then must not bring it back.
    const listGone = (targetRoomId: string) =>
      view !== undefined &&
      !mounted.current &&
      !hasUploadList(composerStateKey(targetRoomId, view));
    const stagedIn = (targetRoomId: string): TUploadItem[] =>
      listGone(targetRoomId) ? [] : store.get(composerUploadItemsAtom(targetRoomId, view));
    const uploadOf = (item: TUploadItem): Upload => store.get(roomUploadAtomFamily(item.file));

    const snapshot = (targetRoomId?: string): AttachmentSnapshot => {
      const all = stagedIn(targetRoomId ?? current.current.roomId);
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
      store.set(composerUploadItemsAtom(targetRoomId, view), {
        type: 'PUT',
        item: items,
      });
      keepNames(targetRoomId);
      watchedRooms.current.add(targetRoomId);
      syncUploadWatches();
      notify();
    };

    const remove = (targetRoomId: string, files: TUploadContent[]) => {
      if (files.length === 0) return;
      const removed = new Set(files);
      const items = stagedIn(targetRoomId).filter((item) => removed.has(item.file));
      // A removed file's upload in flight is cancelled; its card would otherwise finish it.
      items.forEach((item) => {
        const upload = store.get(roomUploadAtomFamily(item.file));
        if (upload.status !== UploadStatus.Loading) return;
        mx.cancelUpload(upload.promise);
        store.set(roomUploadAtomFamily(item.file), { status: UploadStatus.Idle });
      });
      if (items.length > 0) {
        store.set(composerUploadItemsAtom(targetRoomId, view), { type: 'DELETE', item: items });
        keepNames(targetRoomId);
      }
      files.forEach((file) => owners.current.delete(file));
      enrolled.current = enrolled.current.filter((item) => !removed.has(item.file));
      syncUploadWatches();
      notify();
    };

    return {
      snapshot,
      append,
      remove,
      unstage: (targetRoomId, files) => {
        const unstaged = new Set(files);
        const items = stagedIn(targetRoomId).filter((item) => unstaged.has(item.file));
        if (items.length === 0) return;
        store.set(composerUploadItemsAtom(targetRoomId, view), { type: 'DELETE', item: items });
        keepNames(targetRoomId);
      },
      restage: (targetRoomId, items) => {
        // A closed thread view's staged files went with it.
        if (!listGone(targetRoomId)) append(targetRoomId, items);
      },
      enroll: (items) => {
        const known = new Set(enrolled.current.map((item) => item.file));
        enrolled.current = [...enrolled.current, ...items.filter((item) => !known.has(item.file))];
        syncUploadWatches();
        notify();
      },
      clearEnrollment: () => {
        enrolled.current = [];
        syncUploadWatches();
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
      watchUploads: (files, listener) => {
        const unsubscribes = files.map((file) => store.sub(roomUploadAtomFamily(file), listener));
        return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
      },
    };
  }, [keepNames, mx, notify, ownedByCurrent, store, syncUploadWatches, view]);

  // Files staged from outside (another composer instance, a restored draft) are watched as well.
  useEffect(() => {
    syncUploadWatches();
    notify();
  }, [notify, roomItems, syncUploadWatches]);

  const onEditorChange = useCallback(() => {
    const { roomId: activeRoomId, editor: activeEditor } = current.current;
    const present = getRoomInputPasteMarkerFileNames(activeEditor.children);
    const orphans = access.snapshot().staged.filter(
      (item) =>
        isPasteItem(item) &&
        !item.prepError &&
        !leases.current.has(item.file) &&
        // A file a send session claimed stays until the session sends or drops it.
        !enrolled.current.some((entry) => entry.file === item.file) &&
        !present.has(item.metadata.mindroomPasteAttachment!.fileName)
    );
    access.remove(
      activeRoomId,
      orphans.map((item) => item.file)
    );
  }, [access]);

  // Large pastes keep their text with the draft (keptPastes.ts), so a draft that comes back after
  // a reload gets its paste files back. A chip whose text was not kept leaves the draft with a
  // notice: no chip sends without its file. Restores run one after another.
  const [lostPastes, setLostPastes] = useState(false);
  const pasteRestores = useRef(Promise.resolve(true));
  // The paste chips in the editor whose file is not staged.
  const missingPastes = useCallback((): string[] => {
    const staged = new Set(access.snapshot().staged.map(pasteFileNameOf));
    return [...getRoomInputPasteMarkerFileNames(current.current.editor.children)].filter(
      (fileName) => !staged.has(fileName)
    );
  }, [access]);
  const restorePastes = useCallback((): Promise<boolean> => {
    const restore = async (): Promise<boolean> => {
      const { roomId: restoreRoomId, draftKey: restoreDraftKey } = current.current;
      const wanted = missingPastes();
      if (wanted.length === 0 || !userId) return true;
      const texts = await readKeptPasteTexts(userId, wanted);
      const items = await createUploadItems(
        [...texts].map(([fileName, text]) => new File([text], fileName, { type: 'text/plain' })),
        (file) => ({
          markedAsSpoiler: false,
          mindroomPasteAttachment: {
            id: getPasteIdFromFileName(file.name) ?? file.name,
            chars: texts.get(file.name)?.length ?? 0,
            fileName: file.name,
          },
        })
      );
      const {
        roomId: activeRoomId,
        draftKey: activeDraftKey,
        editor: activeEditor,
      } = current.current;
      if (
        !mounted.current ||
        activeRoomId !== restoreRoomId ||
        activeDraftKey !== restoreDraftKey
      ) {
        return true;
      }
      const stillMissing = new Set(missingPastes());
      const usable = items.filter(
        (item) => !item.prepError && stillMissing.has(pasteFileNameOf(item) ?? '')
      );
      access.append(activeRoomId, usable);
      usable.forEach((item) => stillMissing.delete(pasteFileNameOf(item) ?? ''));
      if (stillMissing.size === 0) return true;
      Transforms.removeNodes(activeEditor, {
        at: [],
        match: (node) => isRoomInputPasteMarkerElement(node) && stillMissing.has(node.fileName),
      });
      setLostPastes(true);
      return false;
    };
    const next = pasteRestores.current.then(restore, restore);
    pasteRestores.current = next.catch(() => true);
    return next;
  }, [access, createUploadItems, missingPastes, userId]);
  const restorePastesRef = useRef(restorePastes);
  restorePastesRef.current = restorePastes;

  // The draft this composer shows now, restored from storage after a reload above all.
  useEffect(() => {
    setLostPastes(false);
    restorePastesRef
      .current()
      .then(() => {
        const {
          roomId: activeRoomId,
          draftKey: activeDraftKey,
          editor: activeEditor,
        } = current.current;
        if (!userId || !mounted.current || activeRoomId !== roomId || activeDraftKey !== draftKey) {
          return undefined;
        }
        // The texts of pastes the draft no longer holds (sent, or deleted) are not needed again.
        return forgetPastesOutsideDraft(
          userId,
          draftKey ?? getRoomInputDraftKey(userId, roomId),
          getRoomInputPasteMarkerFileNames(activeEditor.children)
        );
      })
      .catch(() => undefined);
  }, [draftKey, roomId, userId]);

  // Synchronous when every chip has its file, so a plain send starts in the same task.
  const settlePastes = useCallback(
    (): true | Promise<boolean> =>
      missingPastes().length === 0 ? true : restorePastesRef.current(),
    [missingPastes]
  );
  const dismissLostPastes = useCallback(() => setLostPastes(false), []);

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
      const id = createPasteId();
      const fileName = getPasteFileName(id);
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
        : (createRoomInputPasteMarkerElement({
            ...marker,
            raw: createPasteMarker(marker),
          }) as Descendant);

      // The text is kept with the draft too, so a reload does not lose it.
      if (!item.prepError && userId) {
        const keptDraftKey = pasteDraftKey ?? getRoomInputDraftKey(userId, pasteRoomId);
        keepPasteText(userId, keptDraftKey, fileName, text).catch(() => undefined);
      }

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
      store.set(composerUploadItemsAtom(pasteRoomId, view), {
        type: 'PUT',
        item: items,
      });
      keepNames(pasteRoomId);
      if (pasteDraftKey) {
        const draftAtom = roomIdToMsgDraftAtomFamily(pasteDraftKey);
        store.set(draftAtom, appendToDraft(store.get(draftAtom), node));
      }
      notify();
    },
    [access, createUploadItems, keepNames, notify, store, userId, view]
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
      const markdown = { allowBlockMarkdown: isMarkdown, allowInlineMarkdown: isMarkdown };
      const formattedBody = toMatrixCustomHTML(activeEditor.children, {
        allowTextFormatting: true,
        ...markdown,
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
    useCallback((files: File[]) => void stageFiles(files).catch(() => undefined), [stageFiles]),
    true
  );
  // A plugin's cover over the room page's conversation takes no files for the composer under it;
  // another view of the room is not under it.
  const covered = useAtomValue(conversationCoveredAtom) && view === undefined;
  const dropZoneActive = useFileDropZone(
    fileDropContainerRef,
    useCallback(
      (files: File[]) => {
        if (view === undefined && store.get(conversationCoveredAtom)) return;
        void stageFiles(files).catch(() => undefined);
      },
      [stageFiles, store, view]
    )
  );
  const dropZoneVisible = dropZoneActive && !covered;

  // Rendering reads the owner map, so a staged list change re-renders through `roomItems`.
  const visibleItems = roomItems.filter(ownedByCurrent);
  const visibleFiles = useStableFiles(visibleItems.map((item) => item.file));
  const observerAtom = useMemo(
    () => createUploadFamilyObserverAtom(roomUploadAtomFamily, visibleFiles),
    [visibleFiles]
  );

  // "Remove all" on the board removes the board's files, and `remove` cancels those still
  // uploading. A file that is not on the board (a recording a send holds) keeps its upload.
  const cancelUploads = useCallback(
    (uploads: Upload[]) => {
      const canceled = new Set(uploads.map((upload) => upload.file));
      access.remove(
        current.current.roomId,
        access
          .snapshot()
          .staged.filter((item) => canceled.has(item.file))
          .map((item) => item.file)
      );
    },
    [access]
  );

  const replaceItem = (item: TUploadItem, replacement: TUploadItem) => {
    store.set(itemsAtom, { type: 'REPLACE', item, replacement });
    keepNames(roomId);
  };

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
                  replaceItem(fileItem, { ...fileItem, metadata })
                }
                onRemove={(file) => access.remove(current.current.roomId, [file])}
              />
            ))}
          </UploadBoardContent>
        )}
      </UploadBoard>
    ) : null;

  return {
    access,
    board,
    onPaste,
    onEditorChange,
    pickFiles,
    dropZoneVisible,
    lostPastes,
    dismissLostPastes,
    settlePastes,
  };
};
