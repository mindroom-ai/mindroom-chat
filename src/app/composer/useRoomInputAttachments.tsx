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
import { atom, useAtomValue, useStore } from 'jotai';
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
  type StagedList,
} from './roomInputDrafts';
import { ConversationViewContext } from '../navigation/conversationView';
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
import { useMediaConfig } from '../matrix/hooks/useMediaConfig';
import {
  createPasteId,
  createPasteMarker,
  getPasteFileName,
  getPasteIdFromFileName,
} from '../matrix/protocol/pasteAttachmentMarker';
import { shouldConvertPasteToAttachment } from './pasteAttachment';
import {
  getTooLargeError,
  hasSendableStagedFiles,
  MEDIA_UPLOAD_SIZE_KEY,
  type AttachmentSnapshot,
  type RoomInputAttachmentAccess,
} from './roomInputAttachmentAccess';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import { buildDiagnosticsExport } from '../diagnostics/diagnosticsExport';
import { createRoomUploadItems } from '../matrix/send/roomInputUploadPreparation';
import {
  createRoomInputPasteMarkerElement,
  getRoomInputPasteMarkerFileNames,
  isRoomInputPasteMarkerElement,
} from './RoomInputExtensions';
import {
  DEFAULT_MEDIA_COMPRESSION,
  isMediaCompressionPreset,
  type MediaCompressionPreset,
} from '../preferences/mediaCompression';
import { settingsAtom } from '../preferences/settings';
import { useMediaCompression, type PendingVideoCompression } from './useMediaCompression';

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
  fileDropContainerRef: RefObject<HTMLElement | null>;
  createUploadItems: CreateRoomInputUploadItems;
  /** Overrides the room key used for staged files (e.g. Home's single account-wide list). */
  stagedListKey?: string;
  /** Keeps staged files local and unencrypted until `prepareForSend` commits them at Send. */
  deferUpload?: boolean;
  /** Renders the upload board in normal flow above the composer instead of floating. */
  inlineUploadBoard?: boolean;
};

type RoomInputAttachments = {
  access: RoomInputAttachmentAccess;
  /** The atom holding this composer's staged file list. */
  itemsAtom: StagedList;
  /** The upload board above the composer, or null without staged files. */
  board: ReactNode;
  /** Whether at least one staged file has no prep or upload error and can be sent. */
  hasSendableFiles: boolean;
  /** Prepares deferred staged files for `targetRoom` (encrypting iff encrypted) right before upload. */
  prepareForSend: (targetRoom: Room, items?: TUploadItem[]) => Promise<TUploadItem[]>;
  /** Waits for any compressing items in `items` to settle and returns the still-staged ready items. */
  waitForCompression: (
    items: readonly TUploadItem[],
    targetRoomId?: string
  ) => Promise<TUploadItem[]>;
  /** Whether the upload board card list is currently expanded. */
  boardOpen: boolean;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  /** Drops paste attachments whose marker left the editor. */
  onEditorChange: () => void;
  pickFiles: () => void;
  /** Stages this device's diagnostics export as a file, sent with the next message. */
  attachAppLogs: () => void;
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

// The files each composer's sends claim, of mounted composers and of ones whose sends still go
// out: a file removed in any composer leaves every send that holds it.
const claims = new Set<{ ref: { current: TUploadItem[] }; sync: () => void }>();

const isPasteItem = (item: TUploadItem): boolean => !!item.metadata.mindroomPasteAttachment;

const pasteFileNameOf = (item: TUploadItem): string | undefined =>
  item.metadata.mindroomPasteAttachment?.fileName;

/** The same array while it holds the same items, so observers built from it stay put. */
const useStableList = <T,>(items: T[]): T[] => {
  const previous = useRef(items);
  const same =
    previous.current.length === items.length &&
    previous.current.every((item, index) => item === items[index]);
  if (!same) previous.current = items;
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
  stagedListKey,
  deferUpload = false,
  inlineUploadBoard = false,
}: UseRoomInputAttachmentsOptions): RoomInputAttachments => {
  const store = useStore();
  const maxUploadSize = useMediaConfig()[MEDIA_UPLOAD_SIZE_KEY];
  // Another view of the room (a plugin's thread view) stages its own files, and keeps no names.
  const view = useContext(ConversationViewContext);
  const current = useRef({ room, roomId, draftKey, editor });
  current.current = { room, roomId, draftKey, editor };
  const listKey = useCallback(
    (targetRoomId?: string) => stagedListKey ?? targetRoomId ?? current.current.roomId,
    [stagedListKey]
  );
  const itemsAtom = composerUploadItemsAtom(listKey(roomId), view);
  const roomItems = useAtomValue(itemsAtom);
  const [boardOpen, setBoardOpen] = useState(true);

  // Which draft owns a staged paste file.
  const owners = useRef(new Map<TUploadContent, string | undefined>());
  const enrolled = useRef<TUploadItem[]>([]);
  const [enrolledFiles, setEnrolledFiles] = useState<ReadonlySet<TUploadContent>>(() => new Set());
  const leases = useRef(new Map<TUploadContent, number>());
  const listeners = useRef(new Set<() => void>());
  const notifyQueued = useRef(false);
  const mounted = useRef(true);

  const syncEnrolled = useCallback(() => {
    if (!mounted.current) return;
    setEnrolledFiles((prev) => {
      const next = enrolled.current;
      if (prev.size === next.length && next.every((entry) => prev.has(entry.file))) {
        return prev;
      }
      return new Set(next.map((entry) => entry.file));
    });
  }, []);

  const claimEntry = useRef<{ ref: { current: TUploadItem[] }; sync: () => void }>({
    ref: enrolled,
    sync: syncEnrolled,
  });
  claimEntry.current.sync = syncEnrolled;

  const releaseClaims = useCallback(() => {
    if (!mounted.current && enrolled.current.length === 0) claims.delete(claimEntry.current);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const entry = claimEntry.current;
    claims.add(entry);
    return () => {
      mounted.current = false;
      releaseClaims();
    };
  }, [releaseClaims]);

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
      if (!userId || view !== undefined || stagedListKey !== undefined) return;
      keepStagedFileNames(
        userId,
        targetRoomId,
        store.get(roomIdToUploadItemsAtomFamily(targetRoomId))
      );
    },
    [stagedListKey, store, userId, view]
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
  const watchedRooms = useRef(new Set<string>([listKey(roomId)]));
  watchedRooms.current.add(listKey(roomId));
  const syncUploadWatches = useCallback(() => {
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
    const uploadOf = (item: TUploadItem): Upload => store.get(roomUploadAtomFamily(item.file));

    const snapshot = (targetRoomId?: string): AttachmentSnapshot => {
      const all = store.get(composerUploadItemsAtom(listKey(targetRoomId), view));
      const staged = targetRoomId === undefined ? all.filter(ownedByCurrent) : all;
      const files = new Set(staged.map((item) => item.file));
      const tracked = [...staged, ...enrolled.current.filter((item) => !files.has(item.file))];
      return { staged, enrolled: [...enrolled.current], uploads: tracked.map(uploadOf) };
    };

    const append = (targetRoomId: string, items: TUploadItem[]) => {
      if (items.length === 0) return;
      const key = listKey(targetRoomId);
      const owner = key === listKey() ? current.current.draftKey : undefined;
      items.forEach((item) => {
        if (!owners.current.has(item.file)) owners.current.set(item.file, owner);
        // A file that could not be prepared shows its error on its card instead of uploading.
        if (item.prepError) store.set(roomUploadAtomFamily(item.file), { error: item.prepError });
      });
      store.set(composerUploadItemsAtom(key, view), {
        type: 'PUT',
        item: items,
      });
      keepNames(targetRoomId);
      watchedRooms.current.add(key);
      syncUploadWatches();
      notify();
    };

    const remove = (targetRoomId: string, files: TUploadContent[]) => {
      if (files.length === 0) return;
      const removed = new Set(files);
      const listAtom = composerUploadItemsAtom(listKey(targetRoomId), view);
      const items = store.get(listAtom).filter((item) => removed.has(item.file));
      // A removed file's compression or upload in flight is cancelled; its card would otherwise finish it.
      items.forEach((item) => {
        if (item.compression?.status === 'compressing') {
          item.compression.cancel();
        }
        const upload = store.get(roomUploadAtomFamily(item.file));
        if (upload.status !== UploadStatus.Loading) return;
        mx.cancelUpload(upload.promise);
        store.set(roomUploadAtomFamily(item.file), { status: UploadStatus.Idle });
      });
      if (items.length > 0) {
        store.set(listAtom, { type: 'DELETE', item: items });
        keepNames(targetRoomId);
      }
      files.forEach((file) => owners.current.delete(file));
      claims.forEach((claim) => {
        claim.ref.current = claim.ref.current.filter((item) => !removed.has(item.file));
        claim.sync();
      });
      releaseClaims();
      syncUploadWatches();
      notify();
    };

    // A send another composer took over goes on there: its files leave this board and this
    // composer's claim, their uploads going on. A composer that went watches nothing again.
    const release = (targetRoomId: string, files: TUploadContent[]) => {
      if (files.length === 0) return;
      const released = new Set(files);
      const listAtom = composerUploadItemsAtom(listKey(targetRoomId), view);
      const items = store.get(listAtom).filter((item) => released.has(item.file));
      if (items.length > 0) {
        store.set(listAtom, { type: 'DELETE', item: items });
        keepNames(targetRoomId);
      }
      files.forEach((file) => owners.current.delete(file));
      enrolled.current = enrolled.current.filter((item) => !released.has(item.file));
      syncEnrolled();
      releaseClaims();
      if (mounted.current) syncUploadWatches();
      notify();
    };

    return {
      snapshot,
      append,
      remove,
      release,
      enroll: (items) => {
        const known = new Set(enrolled.current.map((item) => item.file));
        enrolled.current = [...enrolled.current, ...items.filter((item) => !known.has(item.file))];
        syncEnrolled();
        syncUploadWatches();
        notify();
      },
      clearEnrollment: (files) => {
        enrolled.current = enrolled.current.filter((item) => !files.includes(item.file));
        syncEnrolled();
        releaseClaims();
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
    };
  }, [
    keepNames,
    listKey,
    mx,
    notify,
    ownedByCurrent,
    releaseClaims,
    store,
    syncEnrolled,
    syncUploadWatches,
    view,
  ]);

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
  const prepareLocalItems = useMemo<CreateRoomInputUploadItems>(
    () =>
      deferUpload
        ? (files, getMetadata) =>
            Promise.resolve(
              files.map((file, index) => ({
                file,
                originalFile: file,
                encInfo: undefined,
                metadata: getMetadata?.(file, index) ?? { markedAsSpoiler: false },
              }))
            )
        : createUploadItems,
    [createUploadItems, deferUpload]
  );

  const restorePastes = useCallback((): Promise<boolean> => {
    const restore = async (): Promise<boolean> => {
      const { roomId: restoreRoomId, draftKey: restoreDraftKey } = current.current;
      const wanted = missingPastes();
      if (wanted.length === 0 || !userId) return true;
      const texts = await readKeptPasteTexts(
        userId,
        wanted,
        stagedListKey !== undefined
          ? (restoreDraftKey ?? getRoomInputDraftKey(userId, restoreRoomId))
          : undefined
      );
      const items = await prepareLocalItems(
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
        (stagedListKey === undefined && activeRoomId !== restoreRoomId) ||
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
  }, [access, missingPastes, prepareLocalItems, stagedListKey, userId]);
  const restorePastesRef = useRef(restorePastes);
  restorePastesRef.current = restorePastes;

  const getTargetAtom = useCallback(
    (targetRoomId: string) => composerUploadItemsAtom(listKey(targetRoomId), view),
    [listKey, view]
  );

  const compression = useMediaCompression({
    mx,
    store,
    current,
    deferUpload,
    maxUploadSize,
    owners,
    enrolled,
    getTargetAtom,
    uploadAtomFamily: roomUploadAtomFamily,
    keepNames,
    syncUploadWatches,
    syncEnrolled,
    notify,
  });

  // Commits deferred staged files to `targetRoom` at Send time: waits for active compressions,
  // encrypts iff `targetRoom` is encrypted, resets transient errors for retry, and blocks files
  // over the server's size limit.
  const prepareForSend = useCallback(
    async (targetRoom: Room, explicitItems?: TUploadItem[]): Promise<TUploadItem[]> => {
      const targetAtom = getTargetAtom(targetRoom.roomId);
      const enrolledSet = new Set(enrolled.current.map((entry) => entry.file));
      const candidates =
        explicitItems ??
        access.snapshot().staged.filter((item) => !item.prepError && !enrolledSet.has(item.file));
      if (candidates.length === 0) return [];

      const hasCompressing = candidates.some((item) => item.compression?.status === 'compressing');
      const resolvedCandidates = hasCompressing
        ? await compression.waitForCompression(candidates, targetRoom.roomId)
        : candidates;
      if (!deferUpload || resolvedCandidates.length === 0) return resolvedCandidates;

      const encrypted = targetRoom.hasEncryptionStateEvent();
      const ready: TUploadItem[] = [];
      for (const item of resolvedCandidates) {
        const liveBefore = store.get(targetAtom).find((entry) => entry.file === item.file);
        if (!liveBefore || liveBefore.prepError) continue;
        const tooLarge = getTooLargeError(liveBefore.originalFile.size, maxUploadSize);
        if (tooLarge) {
          store.set(roomUploadAtomFamily(liveBefore.file), { error: tooLarge });
          continue;
        }
        const upload = store.get(roomUploadAtomFamily(liveBefore.file));
        const needsPrep =
          !!liveBefore.encInfo !== encrypted || upload.status === UploadStatus.Error;
        if (!needsPrep) {
          ready.push(liveBefore);
          continue;
        }
        if (upload.status === UploadStatus.Loading) {
          mx.cancelUpload(upload.promise);
          store.set(roomUploadAtomFamily(liveBefore.file), { status: UploadStatus.Idle });
        }
        const hasOwner = owners.current.has(liveBefore.file);
        const owner = owners.current.get(liveBefore.file);
        // eslint-disable-next-line no-await-in-loop
        const [prepared] = await createRoomUploadItems(
          [liveBefore.originalFile],
          targetRoom,
          () => liveBefore.metadata
        );
        const liveAfter = store.get(targetAtom).find((entry) => entry.file === liveBefore.file);
        if (!prepared || !liveAfter) continue;
        const replacement: TUploadItem = {
          ...prepared,
          metadata: liveAfter.metadata,
          ...(liveAfter.compression && !prepared.prepError
            ? { compression: liveAfter.compression }
            : {}),
        };
        if (replacement.file !== liveAfter.file) {
          owners.current.delete(liveAfter.file);
          if (hasOwner) owners.current.set(replacement.file, owner);
        }
        if (replacement.prepError) {
          store.set(roomUploadAtomFamily(replacement.file), { error: replacement.prepError });
        } else if (
          store.get(roomUploadAtomFamily(replacement.file)).status === UploadStatus.Error
        ) {
          store.set(roomUploadAtomFamily(replacement.file), { status: UploadStatus.Idle });
        }
        store.set(targetAtom, { type: 'REPLACE', item: liveAfter, replacement });
        if (replacement.file !== liveAfter.file) {
          roomUploadAtomFamily.remove(liveAfter.file);
        }
        const preparedTooLarge = !replacement.prepError
          ? getTooLargeError(replacement.file.size, maxUploadSize)
          : undefined;
        if (preparedTooLarge) {
          store.set(roomUploadAtomFamily(replacement.file), { error: preparedTooLarge });
        }
        const isReady = !replacement.prepError && !preparedTooLarge;
        enrolled.current = isReady
          ? enrolled.current.map((entry) => (entry.file === liveAfter.file ? replacement : entry))
          : enrolled.current.filter((entry) => entry.file !== liveAfter.file);
        syncEnrolled();
        syncUploadWatches();
        notify();
        if (isReady) ready.push(replacement);
      }
      return ready;
    },
    [
      access,
      compression,
      deferUpload,
      getTargetAtom,
      maxUploadSize,
      mx,
      notify,
      store,
      syncEnrolled,
      syncUploadWatches,
    ]
  );

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
    // With `asked`, the conversation the files were asked for in: they join its board only if the
    // composer still shows it once they are prepared.
    async (files: File[], asked?: { roomId: string; draftKey?: string }) => {
      if (files.length === 0) return;
      const targetRoomId = asked?.roomId ?? current.current.roomId;
      const targetRoom =
        (asked && typeof mx.getRoom === 'function' ? mx.getRoom(targetRoomId) : undefined) ??
        current.current.room;
      let preset: MediaCompressionPreset = DEFAULT_MEDIA_COMPRESSION;
      try {
        const raw = (store.get(settingsAtom) as { mediaCompression?: unknown } | undefined)
          ?.mediaCompression;
        if (isMediaCompressionPreset(raw)) preset = raw;
      } catch {
        preset = DEFAULT_MEDIA_COMPRESSION;
      }

      const videoJobs: Array<{ index: number; job: PendingVideoCompression }> = [];
      const inlineFiles: Array<{ index: number; file: File }> = [];
      files.forEach((file, index) => {
        const job = compression.prepareVideoCompression(file, preset, targetRoom, targetRoomId);
        if (job) videoJobs.push({ index, job });
        else inlineFiles.push({ index, file });
      });

      const stagedItems = new Array<TUploadItem>(files.length);
      if (inlineFiles.length > 0) {
        const hasEligibleImages = inlineFiles.some((entry) =>
          compression.canCompressImage(entry.file, preset)
        );
        const compressed = hasEligibleImages
          ? await compression.compressInlineImages(
              inlineFiles.map((entry) => entry.file),
              preset
            )
          : inlineFiles.map((entry) => ({ file: entry.file, compression: undefined }));
        const prepared = await prepareLocalItems(compressed.map((entry) => entry.file));
        prepared.forEach((item, idx) => {
          const originalIndex = inlineFiles[idx]!.index;
          const itemCompression = compressed[idx]?.compression;
          stagedItems[originalIndex] =
            itemCompression && !item.prepError ? { ...item, compression: itemCompression } : item;
        });
      }

      if (!mounted.current) {
        videoJobs.forEach(({ job }) => job.discard());
        return;
      }
      if (
        asked &&
        (current.current.roomId !== asked.roomId || current.current.draftKey !== asked.draftKey)
      ) {
        videoJobs.forEach(({ job }) => job.discard());
        // eslint-disable-next-line no-console
        console.warn('[composer] files not attached: the conversation changed');
        return;
      }

      videoJobs.forEach(({ index, job }) => {
        stagedItems[index] = job.placeholder;
      });
      access.append(targetRoomId, stagedItems);
      videoJobs.forEach(({ job }) => job.start());
    },
    [access, compression, mx, prepareLocalItems, store]
  );

  const pastePlainText = useCallback(
    async (text: string) => {
      const pasteRoomId = current.current.roomId;
      const pasteDraftKey = current.current.draftKey;
      const id = createPasteId();
      const fileName = getPasteFileName(id);
      const marker = { id, chars: text.length, fileName };
      const file = new File([text], fileName, { type: 'text/plain' });
      const items = await prepareLocalItems([file], () => ({
        markedAsSpoiler: false,
        mindroomPasteAttachment: marker,
      }));
      // A paste finishing after sign-out or unmount has nowhere left to go.
      if (!mounted.current) return;
      const [item] = items;
      if (!item) return;
      const node: Descendant | { text: string } = item.prepError
        ? { text }
        : createRoomInputPasteMarkerElement({
            ...marker,
            raw: createPasteMarker(marker),
          });

      // The text is kept with the draft too, so a reload does not lose it.
      if (!item.prepError && userId) {
        const keptDraftKey = pasteDraftKey ?? getRoomInputDraftKey(userId, pasteRoomId);
        keepPasteText(userId, keptDraftKey, fileName, text).catch(() => undefined);
      }

      if (
        (stagedListKey !== undefined || current.current.roomId === pasteRoomId) &&
        current.current.draftKey === pasteDraftKey
      ) {
        access.append(pasteRoomId, items);
        const activeEditor = current.current.editor;
        if (item.prepError) activeEditor.insertText(text);
        else {
          activeEditor.insertNode(node);
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
      store.set(composerUploadItemsAtom(listKey(pasteRoomId), view), {
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
    [access, keepNames, listKey, notify, prepareLocalItems, stagedListKey, store, userId, view]
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

  const attachAppLogs = useCallback(() => {
    // The export takes a moment, and this composer can move to another room or thread meanwhile:
    // the logs go only to the conversation they were asked for in.
    const { roomId, draftKey } = current.current;
    buildDiagnosticsExport()
      .then(({ blob, fileName }) =>
        stageFiles([new File([blob], fileName, { type: 'application/json' })], {
          roomId,
          draftKey,
        })
      )
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[composer] could not attach app logs', error);
      });
  }, [stageFiles]);

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
  const visibleItems = useStableList(roomItems.filter(ownedByCurrent));
  const visibleFiles = useMemo(() => visibleItems.map((item) => item.file), [visibleItems]);
  const observerAtom = useMemo(
    () => createUploadFamilyObserverAtom(roomUploadAtomFamily, visibleFiles),
    [visibleFiles]
  );
  const compressingCount = useMemo(
    () => visibleItems.filter((item) => item.compression?.status === 'compressing').length,
    [visibleItems]
  );
  const hasSendableFiles = useAtomValue(
    useMemo(
      () =>
        atom((get) =>
          deferUpload
            ? visibleItems.some(
                (item) =>
                  item.compression?.status === 'compressing' ||
                  (!item.prepError && !getTooLargeError(item.originalFile.size, maxUploadSize))
              )
            : hasSendableStagedFiles({
                staged: visibleItems,
                uploads: visibleItems.map((item) => get(roomUploadAtomFamily(item.file))),
              })
        ),
      [deferUpload, maxUploadSize, visibleItems]
    )
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
    // A send that claimed the file sends it as changed (a spoiler set after Send, say).
    enrolled.current = enrolled.current.map((entry) => (entry === item ? replacement : entry));
    keepNames(roomId);
  };

  const board =
    visibleItems.length > 0 ? (
      <UploadBoard
        inline={inlineUploadBoard}
        header={
          <UploadBoardHeader
            open={boardOpen}
            onToggle={() => setBoardOpen((open) => !open)}
            uploadFamilyObserverAtom={observerAtom}
            compressingCount={compressingCount}
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
                autoUpload={!deferUpload}
                fileItem={item}
                setMetadata={(fileItem, metadata) =>
                  replaceItem(fileItem, { ...fileItem, metadata })
                }
                onRemove={(file) => access.remove(current.current.roomId, [file])}
                onUseOriginal={(fileItem) => void compression.useOriginal(fileItem)}
                canUseOriginal={!enrolledFiles.has(item.file)}
              />
            ))}
          </UploadBoardContent>
        )}
      </UploadBoard>
    ) : null;

  return {
    access,
    itemsAtom,
    board,
    hasSendableFiles,
    prepareForSend,
    waitForCompression: compression.waitForCompression,
    boardOpen,
    onPaste,
    onEditorChange,
    pickFiles,
    attachAppLogs,
    dropZoneVisible,
    lostPastes,
    dismissLostPastes,
    settlePastes,
  };
};
