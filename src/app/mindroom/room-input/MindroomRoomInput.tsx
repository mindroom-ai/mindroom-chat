import React, {
  ClipboardEventHandler,
  KeyboardEventHandler,
  RefObject,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import { EventType, IContent, MsgType, Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { Editor, Transforms } from 'slate';
import {
  Box,
  Dialog,
  Icon,
  IconButton,
  Icons,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  Scroll,
  Text,
  toRem,
} from 'folds';

import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  CustomEditor,
  Toolbar,
  toMatrixCustomHTML,
  toPlainText,
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  AutocompleteQuery,
  getAutocompleteQuery,
  getPrevWorldRange,
  resetEditor,
  RoomMentionAutocomplete,
  UserMentionAutocomplete,
  EmoticonAutocomplete,
  createEmoticonElement,
  moveCursor,
  resetEditorHistory,
  customHtmlEqualsPlainText,
  trimCustomHtml,
  isEmptyEditor,
  getBeginCommand,
  trimCommand,
  getMentions,
} from '../../components/editor';
import { EmojiBoard, EmojiBoardTab } from '../../components/emoji-board';
import { UseStateProvider } from '../../components/UseStateProvider';
import {
  TUploadContent,
  MatrixUploadErrorStage,
  encryptFile,
  getImageInfo,
  getMatrixUploadOriginalName,
  getMatrixUploadErrorStage,
  getMxIdLocalPart,
  mxcUrlToHttp,
  toMatrixUploadError,
  uploadContent,
} from '../../utils/matrix';
import { useTypingStatusUpdater } from '../../hooks/useTypingStatusUpdater';
import { useFilePicker } from '../../hooks/useFilePicker';
import { useFileDropZone } from '../../hooks/useFileDrop';
import {
  TUploadItem,
  TUploadMetadata,
  pendingVoiceSendDraftAtom,
  roomIdToMsgDraftAtomFamily,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  voiceAutoSendPendingAtom,
} from '../../state/room/roomInputDrafts';
import { UploadCardRenderer } from '../../components/upload-card';
import { UploadBoard, UploadBoardContent, UploadBoardHeader } from '../../components/upload-board';
import { Upload, UploadStatus, createUploadFamilyObserverAtom } from '../../state/upload';
import {
  getDataTransferFiles,
  getImageUrlBlob,
  loadImageElement,
  pauseAllMediaElements,
} from '../../utils/dom';
import { safeFile } from '../../utils/mimeTypes';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import {
  getAudioMsgContent,
  getFileMsgContent,
  getImageMsgContent,
  getVideoMsgContent,
} from '../../features/room/msgContent';
import { getMemberDisplayName, getMentionContent, trimReplyFromBody } from '../../utils/room';
import { CommandAutocomplete } from '../../features/room/CommandAutocomplete';
import { Command, SHRUG, TABLEFLIP, UNFLIP, useCommands } from '../../hooks/useCommands';
import { mobileOrTablet } from '../../utils/user-agent';
import { useElementSizeObserver } from '../../hooks/useElementSizeObserver';
import { ReplyLayout } from '../../components/message';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import colorMXID from '../../../util/colorMXID';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { useComposingCheck } from '../../hooks/useComposingCheck';
import { Membership } from '../../../types/matrix/room';
import {
  createMindroomRoomInputPasteMarkerElement,
  getMindroomRoomInputAutocompleteQuery,
  getMindroomRoomInputPasteMarkerFileNames,
  getMindroomRoomInputMessageRelation,
  isMindroomRoomInputAutocompleteQuery,
  MindroomRoomInputAutocomplete,
  MindroomRoomInputReplyContext,
  MindroomVoiceRecorderComposer,
  removeMindroomRoomInputPasteMarkerElements,
  getMindroomRoomInputVoiceSendContext,
  getMindroomRoomInputVoiceUploadRelation,
  hasMatchingMindroomRoomInputVoiceReplyContext,
  refreshMindroomRoomInputVoiceSendContext,
  useRoomInputSendSessionController,
  type MindroomRoomInputAutocompletePrefix,
  type MindroomVoiceSendContext,
} from './RoomInputMindroomExtensions';
import {
  createMindroomPasteAttachment,
  isMindroomPasteFileName,
  parseMindroomPasteMarker,
  withMindroomPasteAttachmentMetadata,
} from '../messages/pasteAttachmentMarker';
import { shouldConvertPasteToAttachment } from './pasteAttachment';

type RoomInputAutocompletePrefix = AutocompletePrefix | MindroomRoomInputAutocompletePrefix;

export const createMindroomRoomUploadItems = async (
  files: File[],
  targetRoom: Room,
  getMetadata: (file: File, index: number) => TUploadMetadata = () => ({
    markedAsSpoiler: false,
  })
): Promise<TUploadItem[]> => {
  const safeFiles = files.map(safeFile);

  if (targetRoom.hasEncryptionStateEvent()) {
    const encryptedFiles = await Promise.allSettled(
      safeFiles.map(async (file, index) => ({
        encryptedFile: await encryptFile(file),
        index,
      }))
    );

    return encryptedFiles.reduce<TUploadItem[]>((items, result, settledIndex) => {
      if (result.status === 'rejected') {
        const file = safeFiles[settledIndex];
        if (!file) return items;

        items.push({
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: getMetadata(file, settledIndex),
          prepError: toMatrixUploadError(result.reason, 'create'),
        });
        return items;
      }

      const { encryptedFile, index } = result.value;
      items.push({
        ...encryptedFile,
        metadata: getMetadata(safeFiles[index], index),
      });
      return items;
    }, []);
  }

  return safeFiles.map((file, index) => ({
    file,
    originalFile: file,
    encInfo: undefined,
    metadata: getMetadata(file, index),
  }));
};

export interface RoomInputProps {
  editor: Editor;
  fileDropContainerRef: RefObject<HTMLElement>;
  roomId: string;
  room: Room;
  threadId?: string;
  threadingEnabled?: boolean;
}
export const RoomInput = forwardRef<HTMLDivElement, RoomInputProps>(
  ({ editor, fileDropContainerRef, roomId, room, threadId, threadingEnabled = true }, ref) => {
    const mx = useMatrixClient();
    const store = useStore();
    const useAuthentication = useMediaAuthentication();
    const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
    const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
    const direct = useIsDirectRoom();
    const commands = useCommands(mx, room);
    const emojiBtnRef = useRef<HTMLButtonElement>(null);
    const roomToParents = useAtomValue(roomToParentsAtom);
    const powerLevels = usePowerLevelsContext();
    const creators = useRoomCreators(room);

    const [msgDraft, setMsgDraft] = useAtom(roomIdToMsgDraftAtomFamily(roomId));
    const [replyDraft, setReplyDraft] = useAtom(roomIdToReplyDraftAtomFamily(roomId));
    const replyUserID = replyDraft?.userId;
    const mountedRef = useRef(true);
    const roomRef = useRef(room);
    roomRef.current = room;
    const roomIdRef = useRef(roomId);
    roomIdRef.current = roomId;
    const threadIdRef = useRef(threadId);
    threadIdRef.current = threadId;
    const replyDraftRef = useRef(replyDraft);
    replyDraftRef.current = replyDraft;

    const powerLevelTags = usePowerLevelTags(room, powerLevels);
    const creatorsTag = useRoomCreatorsTag();
    const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
    const theme = useTheme();
    const accessibleTagColors = useAccessiblePowerTagColors(
      theme.kind,
      creatorsTag,
      powerLevelTags
    );

    const replyPowerTag = replyUserID ? getMemberPowerTag(replyUserID) : undefined;
    const replyPowerColor = replyPowerTag?.color
      ? accessibleTagColors.get(replyPowerTag.color)
      : undefined;
    const replyUsernameColor =
      legacyUsernameColor || direct ? colorMXID(replyUserID ?? '') : replyPowerColor;

    const [uploadBoard, setUploadBoard] = useState(true);
    const selectedFiles = useAtomValue(roomIdToUploadItemsAtomFamily(roomId));
    const selectedFilesRef = useRef(selectedFiles);
    selectedFilesRef.current = selectedFiles;
    const [sendSessionFiles, setSendSessionFiles] = useState<TUploadContent[]>([]);
    const sendSessionFilesRef = useRef(sendSessionFiles);
    sendSessionFilesRef.current = sendSessionFiles;
    const sendSessionUploadItemsRef = useRef<TUploadItem[]>([]);
    const uploadFiles = useMemo(() => selectedFiles.map((f) => f.file), [selectedFiles]);
    const observedUploadFiles = useMemo(
      () => Array.from(new Set([...uploadFiles, ...sendSessionFiles])),
      [sendSessionFiles, uploadFiles]
    );
    // Keep the observer atom stable across ordinary rerenders; recreating it each render
    // causes RoomInput to resubscribe and can disrupt editor focus/selection.
    const uploadFamilyObserverAtom = useMemo(
      () => createUploadFamilyObserverAtom(roomUploadAtomFamily, observedUploadFiles),
      [observedUploadFiles]
    );
    const uploads = useAtomValue(uploadFamilyObserverAtom);
    const uploadsRef = useRef(uploads);
    uploadsRef.current = uploads;

    const imagePackRooms: Room[] = useImagePackRooms(roomId, roomToParents);

    const [toolbar, setToolbar] = useSetting(settingsAtom, 'editorToolbar');
    const [autocompleteQuery, setAutocompleteQuery] =
      useState<AutocompleteQuery<RoomInputAutocompletePrefix>>();
    const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);
    const [submitPending, setSubmitPending] = useState(false);
    const voiceAutoSendPending = useAtomValue(voiceAutoSendPendingAtom);
    const pendingVoiceSendDraft = useAtomValue(pendingVoiceSendDraftAtom);
    const setPendingVoiceSendDraft = useSetAtom(pendingVoiceSendDraftAtom);
    // Drafts are stamped with the matrix userId of the session that captured
    // them. The global atom is one slot for the whole router, so an account
    // switch in the sidebar leaves yesterday's draft visible to a new
    // account; ignore (and clean up) any draft that does not belong to us.
    const currentSessionId = mx.getUserId() ?? undefined;
    const draftBelongsToCurrentSession =
      !!pendingVoiceSendDraft &&
      pendingVoiceSendDraft.context.ownerSessionId === currentSessionId;
    const ownsPendingVoiceDraft =
      draftBelongsToCurrentSession && pendingVoiceSendDraft?.context.roomId === roomId;
    const otherRoomOwnsPendingVoiceDraft =
      draftBelongsToCurrentSession && !ownsPendingVoiceDraft;
    const otherPendingVoiceRoomName =
      otherRoomOwnsPendingVoiceDraft && pendingVoiceSendDraft
        ? pendingVoiceSendDraft.context.room.name ?? pendingVoiceSendDraft.context.roomId
        : undefined;
    const voiceAutoSendClaimedRef = useRef(false);
    const voiceAutoSendInFlightRef = useRef(false);
    const submitInFlightRef = useRef(false);

    // When this room owns a pending failed-send draft (e.g. survived a
    // RoomProvider key remount on real navigation), surface the recorder so
    // the user can see the retry/discard controls.
    useEffect(() => {
      if (ownsPendingVoiceDraft) {
        setVoiceRecorderOpen(true);
      }
    }, [ownsPendingVoiceDraft]);

    // Close the auto-opened recorder when the parked draft transitions
    // away. This covers two cases the hook can't observe locally:
    //   1. A previous mount started a retry, the user navigated away, the
    //      retry settled remotely, and we're now back in the source room
    //      with phase synced to 'sending' from the atom.
    //   2. Some other surface discarded the draft (e.g. a future global
    //      discard action).
    // Without this effect, voiceRecorderOpen stays true and the capsule
    // would render with stale local state.
    const previousPendingDraftRef = useRef(pendingVoiceSendDraft);
    useEffect(() => {
      const previous = previousPendingDraftRef.current;
      previousPendingDraftRef.current = pendingVoiceSendDraft;
      if (
        previous &&
        previous.context.roomId === roomId &&
        !pendingVoiceSendDraft &&
        voiceRecorderOpen
      ) {
        setVoiceRecorderOpen(false);
      }
    }, [pendingVoiceSendDraft, roomId, voiceRecorderOpen]);

    // Discard any orphaned draft. Three cases:
    //   1. Account-switch leak: the atom is module-level and survives
    //      logout/login since the router store is shared across sessions.
    //      A draft from account A must not block voice recording in B.
    //   2. Same-session room loss (rev-A R4 Issue 2): if the user was
    //      kicked from / left / forgot the parked-draft room, the
    //      otherRoomOwnsPendingVoiceDraft gate would lock the mic in
    //      every other room with no in-app surface to discard.
    //   3. Same-session non-joinable room (rev-B / rev-G R5): a Room
    //      object can survive in mx.getRoom() after the user is no longer
    //      Joined (Leave/Ban/etc), in which case the source room composer
    //      cannot render and the user has no way to retry/discard. Treat
    //      "not joined" the same as "not present".
    useEffect(() => {
      if (!pendingVoiceSendDraft) return;
      if (!draftBelongsToCurrentSession) {
        setPendingVoiceSendDraft(undefined);
        return;
      }
      const sourceRoom = mx.getRoom(pendingVoiceSendDraft.context.roomId);
      if (!sourceRoom || sourceRoom.getMyMembership() !== Membership.Join) {
        setPendingVoiceSendDraft(undefined);
      }
    }, [draftBelongsToCurrentSession, mx, pendingVoiceSendDraft, setPendingVoiceSendDraft]);

    const sendTypingStatus = useTypingStatusUpdater(mx, roomId);

    useEffect(
      () => () => {
        mountedRef.current = false;
      },
      []
    );

    const createUploadItems = useCallback(
      async (
        files: File[],
        getMetadata: (file: File, index: number) => TUploadMetadata = () => ({
          markedAsSpoiler: false,
        }),
        targetRoom = room
      ): Promise<TUploadItem[]> => {
        return createMindroomRoomUploadItems(files, targetRoom, getMetadata);
      },
      [room]
    );

    const appendUploadItemsToRoomBoard = useCallback(
      (ownerRoomId: string, fileItems: TUploadItem[]) => {
        if (fileItems.length === 0) return;

        // startSendSession/processSendSession can run before React applies the atom update,
        // so keep the ref in sync for same-tick voice sends.
        if (mountedRef.current && ownerRoomId === roomIdRef.current) {
          selectedFilesRef.current = [...selectedFilesRef.current, ...fileItems];
          setUploadBoard(true);
        }
        store.set(roomIdToUploadItemsAtomFamily(ownerRoomId), {
          type: 'PUT',
          item: fileItems,
        });
        fileItems.forEach((fileItem) => {
          if (fileItem.prepError) {
            store.set(roomUploadAtomFamily(fileItem.file), { error: fileItem.prepError });
          }
        });
      },
      [store]
    );

    const appendUploadItems = useCallback(
      (fileItems: TUploadItem[]) => {
        appendUploadItemsToRoomBoard(roomIdRef.current, fileItems);
      },
      [appendUploadItemsToRoomBoard]
    );

    const handleFiles = useCallback(
      async (files: File[]) => {
        appendUploadItems(await createUploadItems(files));
      },
      [appendUploadItems, createUploadItems]
    );

    const createVoiceUploadItems = useCallback(
      async (
        file: File,
        duration: number,
        waveform?: number[],
        targetRoom = room
      ): Promise<TUploadItem[]> => {
        const safeVoiceFile = safeFile(file);
        const metadata: TUploadMetadata = {
          markedAsSpoiler: false,
          voiceMessage: {
            duration,
            ...(waveform ? { waveform } : {}),
          },
        };

        if (targetRoom.hasEncryptionStateEvent()) {
          const encryptedFile = await encryptFile(safeVoiceFile);

          return [
            {
              ...encryptedFile,
              metadata,
            },
          ];
        }

        return [
          {
            file: safeVoiceFile,
            originalFile: safeVoiceFile,
            encInfo: undefined,
            metadata,
          },
        ];
      },
      [room]
    );
    const pickFile = useFilePicker(handleFiles, true);
    const handlePaste: ClipboardEventHandler = useCallback(
      async (evt) => {
        const files = getDataTransferFiles(evt.clipboardData);
        if (files) {
          await handleFiles(files);
          return;
        }

        const pastedText = evt.clipboardData.getData('text/plain');
        if (!pastedText) return;

        const plainText = toPlainText(editor.children, isMarkdown).trim();
        const customHtml = trimCustomHtml(
          toMatrixCustomHTML(editor.children, {
            allowTextFormatting: true,
            allowBlockMarkdown: isMarkdown,
            allowInlineMarkdown: isMarkdown,
          })
        );
        const hasFormattedBody = !customHtmlEqualsPlainText(customHtml, plainText);
        const convertPaste = shouldConvertPasteToAttachment({
          currentPlainText: plainText,
          currentFormattedBody: hasFormattedBody ? customHtml : undefined,
          pastedText,
          includeFormattedPaste: isMarkdown,
        });

        if (!convertPaste) return;

        evt.preventDefault();
        const pasteAttachment = createMindroomPasteAttachment(pastedText);
        const pasteMarker = parseMindroomPasteMarker(pasteAttachment.marker);
        if (!pasteMarker) return;

        const pasteUploadItems = await createUploadItems([pasteAttachment.file], () => ({
          markedAsSpoiler: false,
          mindroomPasteAttachment: {
            id: pasteMarker.id,
            chars: pasteMarker.chars,
            fileName: pasteMarker.fileName,
          },
        }));
        appendUploadItems(pasteUploadItems);
        if (pasteUploadItems.some((item) => item.prepError)) {
          editor.insertText(pastedText);
          return;
        }

        editor.insertNode(createMindroomRoomInputPasteMarkerElement(pasteMarker));
        moveCursor(editor);
      },
      [appendUploadItems, createUploadItems, editor, handleFiles, isMarkdown]
    );
    const dropZoneVisible = useFileDropZone(fileDropContainerRef, handleFiles);
    const [hideStickerBtn, setHideStickerBtn] = useState(document.body.clientWidth < 500);

    const isComposing = useComposingCheck();

    useElementSizeObserver(
      useCallback(() => fileDropContainerRef.current, [fileDropContainerRef]),
      useCallback((width) => setHideStickerBtn(width < 500), [])
    );

    useEffect(() => {
      Transforms.insertFragment(editor, msgDraft);
    }, [editor, msgDraft]);

    useEffect(
      () => () => {
        if (!isEmptyEditor(editor)) {
          const parsedDraft = JSON.parse(JSON.stringify(editor.children));
          setMsgDraft(parsedDraft);
        } else {
          setMsgDraft([]);
        }
        resetEditor(editor);
        resetEditorHistory(editor);
      },
      [roomId, editor, setMsgDraft]
    );

    const handleFileMetadata = useCallback(
      (fileItem: TUploadItem, metadata: TUploadMetadata) => {
        const replacement = { ...fileItem, metadata };
        selectedFilesRef.current = selectedFilesRef.current.map((item) =>
          item === fileItem ? replacement : item
        );
        store.set(roomIdToUploadItemsAtomFamily(roomIdRef.current), {
          type: 'REPLACE',
          item: fileItem,
          replacement,
        });
      },
      [store]
    );

    const removeUploadsFromBoard = useCallback(
      (upload: TUploadContent | TUploadContent[], ownerRoomId = roomIdRef.current) => {
        const uploadList = Array.isArray(upload) ? upload : [upload];
        sendSessionFilesRef.current = sendSessionFilesRef.current.filter(
          (file) => !uploadList.includes(file)
        );
        sendSessionUploadItemsRef.current = sendSessionUploadItemsRef.current.filter(
          (item) => !uploadList.includes(item.file)
        );
        if (mountedRef.current) {
          setSendSessionFiles(sendSessionFilesRef.current);
        }
        const ownerUploadItemsAtom = roomIdToUploadItemsAtomFamily(ownerRoomId);
        const useMountedSelectedFiles = mountedRef.current && ownerRoomId === roomIdRef.current;
        const ownerUploadItems = useMountedSelectedFiles
          ? selectedFilesRef.current
          : store.get(ownerUploadItemsAtom);
        const removableItems = ownerUploadItems.filter((f) =>
          uploadList.some((candidate) => candidate === f.file)
        );

        if (removableItems.length > 0) {
          if (useMountedSelectedFiles) {
            selectedFilesRef.current = selectedFilesRef.current.filter(
              (item) => !removableItems.includes(item)
            );
          }
          store.set(ownerUploadItemsAtom, {
            type: 'DELETE',
            item: removableItems,
          });
        }

        uploadList.forEach((candidate) => roomUploadAtomFamily.remove(candidate));
      },
      [store]
    );

    const getUploadContentName = useCallback((content: TUploadContent): string | undefined => {
      if ('name' in content && typeof content.name === 'string') return content.name;
      return undefined;
    }, []);

    const getPasteUploadFileName = useCallback(
      (fileItem: TUploadItem): string | undefined => {
        const fileName =
          getUploadContentName(fileItem.originalFile) ?? getUploadContentName(fileItem.file);
        return fileName && isMindroomPasteFileName(fileName) ? fileName : undefined;
      },
      [getUploadContentName]
    );

    const getPasteUploadFileNames = useCallback(
      (upload: TUploadContent | TUploadContent[]): Set<string> => {
        const uploadList = Array.isArray(upload) ? upload : [upload];
        const fileNames = new Set<string>();

        selectedFilesRef.current.forEach((fileItem) => {
          if (
            !uploadList.some(
              (candidate) => candidate === fileItem.file || candidate === fileItem.originalFile
            )
          ) {
            return;
          }

          const fileName = getPasteUploadFileName(fileItem);
          if (fileName) fileNames.add(fileName);
        });

        return fileNames;
      },
      [getPasteUploadFileName]
    );

    const handleRemoveUpload = useCallback(
      (upload: TUploadContent | TUploadContent[]) => {
        const pasteFileNames = getPasteUploadFileNames(upload);
        removeUploadsFromBoard(upload);
        removeMindroomRoomInputPasteMarkerElements(editor, pasteFileNames);
      },
      [editor, getPasteUploadFileNames, removeUploadsFromBoard]
    );

    const handleCancelUpload = useCallback(
      (uploadsToCancel: Upload[]) => {
        uploadsToCancel.forEach((upload) => {
          if (upload.status === UploadStatus.Loading) {
            mx.cancelUpload(upload.promise);
          }
        });
        const uploadFilesToCancel = uploadsToCancel.map((upload) => upload.file);
        const pasteFileNames = getPasteUploadFileNames(uploadFilesToCancel);
        removeUploadsFromBoard(uploadFilesToCancel);
        removeMindroomRoomInputPasteMarkerElements(editor, pasteFileNames);
      },
      [editor, getPasteUploadFileNames, mx, removeUploadsFromBoard]
    );

    const handleEditorChange = useCallback(() => {
      const markerFileNames = getMindroomRoomInputPasteMarkerFileNames(editor.children);
      const orphanPasteUploads = selectedFilesRef.current.filter((fileItem) => {
        const fileName = getPasteUploadFileName(fileItem);
        if (fileName === undefined || markerFileNames.has(fileName)) return false;
        if (fileItem.prepError && getMatrixUploadErrorStage(fileItem.prepError) === 'create') {
          return false;
        }
        return (
          !sendSessionFilesRef.current.includes(fileItem.file) &&
          !sendSessionUploadItemsRef.current.some((sendItem) => sendItem.file === fileItem.file)
        );
      });

      if (orphanPasteUploads.length > 0) {
        removeUploadsFromBoard(orphanPasteUploads.map((fileItem) => fileItem.file));
      }
    }, [editor, getPasteUploadFileName, removeUploadsFromBoard]);

    const buildUploadMessageContent = useCallback(
      async (fileItem: TUploadItem, mxc: string, signalBridgedRoom: boolean) => {
        if (fileItem.file.type.startsWith('image')) {
          return getImageMsgContent(mx, fileItem, mxc);
        }
        if (fileItem.file.type.startsWith('video')) {
          return getVideoMsgContent(mx, fileItem, mxc);
        }
        if (fileItem.file.type.startsWith('audio')) {
          return getAudioMsgContent(fileItem, mxc, {
            voiceMessageMimeTypeOverride: signalBridgedRoom ? 'audio/aac' : undefined,
          });
        }
        return withMindroomPasteAttachmentMetadata(
          getFileMsgContent(fileItem, mxc),
          fileItem.metadata.mindroomPasteAttachment
        );
      },
      [mx]
    );

    const uploadVoiceItem = useCallback(
      (fileItem: TUploadItem): Promise<string> =>
        new Promise((resolve, reject) => {
          const uploadAtom = roomUploadAtomFamily(fileItem.file);
          void uploadContent(mx, fileItem.file, {
            hideFilename: !!fileItem.encInfo,
            onPromise: (promise) => store.set(uploadAtom, { promise }),
            onProgress: (progress) => store.set(uploadAtom, { progress }),
            onSuccess: (mxc) => {
              store.set(uploadAtom, { mxc });
              resolve(mxc);
            },
            onError: (error) => {
              store.set(uploadAtom, { error });
              reject(error);
            },
          }).catch(reject);
        }),
      [mx, store]
    );

    const sendVoiceItem = useCallback(
      async (context: MindroomVoiceSendContext, fileItem: TUploadItem, mxc: string) => {
        const content = await buildUploadMessageContent(fileItem, mxc, context.signalBridgedRoom);
        const relation = getMindroomRoomInputVoiceUploadRelation(context, fileItem.file);
        const contentWithRelation: IContent = relation
          ? {
              ...content,
              'm.relates_to': relation,
            }
          : content;

        await mx.sendMessage(context.roomId, contentWithRelation as any);
      },
      [mx, buildUploadMessageContent]
    );

    const clearReplyDraftForVoiceContext = useCallback(
      (context: MindroomVoiceSendContext) => {
        const replyDraftAtom = roomIdToReplyDraftAtomFamily(context.roomId);
        const currentReplyDraft = store.get(replyDraftAtom);
        if (hasMatchingMindroomRoomInputVoiceReplyContext(context, currentReplyDraft)) {
          store.set(replyDraftAtom, undefined);
        }
      },
      [store]
    );

    const { processSendSession, startSendSession } = useRoomInputSendSessionController({
      mx,
      room,
      roomId,
      threadId,
      replyDraft,
      threadingEnabled,
      setReplyDraft,
      editor,
      sendTypingStatus,
      selectedFilesRef,
      sendSessionFilesRef,
      sendSessionUploadItemsRef,
      setSendSessionFiles,
      mountedRef,
      uploadsRef,
      buildUploadMessageContent,
      removeUploadsFromBoard,
      shouldBlockStartSendSession: () => store.get(voiceAutoSendPendingAtom),
    });

    // Snapshot the room/thread/reply context for the next start(). The hook
    // calls this synchronously inside start() and persists the result on the
    // pending draft, so a failed send can be retried against the original
    // destination even after a RoomProvider key remount. The session id is
    // stamped here so an account switch with a parked draft cannot leak
    // audio across users (see draftBelongsToCurrentSession above).
    const getVoiceSendContext = useCallback(
      (): MindroomVoiceSendContext =>
        getMindroomRoomInputVoiceSendContext({
          ownerSessionId: mx.getUserId() ?? '',
          roomId: roomIdRef.current,
          room: roomRef.current,
          threadId: threadIdRef.current,
          replyDraft: replyDraftRef.current,
          threadingEnabled,
        }),
      [mx, threadingEnabled]
    );

    // The hook is the canonical owner of pendingVoiceSendDraftAtom — it
    // writes the draft on failure and clears it on successful send / explicit
    // discard. onClose must NOT clear the draft, or any future caller (a
    // backdrop/Escape dismissal, a click-outside, etc.) would silently lose
    // the parked recording the rest of this PR exists to preserve.
    const handleCloseVoiceRecorder = useCallback(() => {
      setVoiceRecorderOpen(false);
    }, []);

    const claimVoiceAutoSend = useCallback(() => {
      if (store.get(voiceAutoSendPendingAtom)) return false;

      voiceAutoSendClaimedRef.current = true;
      store.set(voiceAutoSendPendingAtom, true);
      return true;
    }, [store]);

    const releaseVoiceAutoSend = useCallback(() => {
      if (!voiceAutoSendClaimedRef.current) return;

      voiceAutoSendInFlightRef.current = false;
      voiceAutoSendClaimedRef.current = false;
      store.set(voiceAutoSendPendingAtom, false);
    }, [store]);

    const handleVoiceSend = useCallback(
      async (
        file: File,
        duration: number,
        waveform: number[] | undefined,
        context: MindroomVoiceSendContext
      ) => {
        // Wrap the ENTIRE body in try/finally. The voice auto-send slot is
        // claimed by claimVoiceAutoSend() in onSendStopRequest BEFORE this
        // function is invoked, so any early throw here (live-room refresh
        // failure, "another send pending" guard) MUST still release the
        // slot — otherwise voiceAutoSendPendingAtom stays true forever and
        // text submit + voice recording are globally locked until reload.
        // releaseVoiceAutoSend() short-circuits when no claim is held, so
        // calling it unconditionally is safe even on the un-claimed path.
        let fileItems: TUploadItem[] = [];
        let liveContext: MindroomVoiceSendContext | null = null;
        const logAndThrowUploadError = (err: unknown, stage: MatrixUploadErrorStage): never => {
          const originalName =
            getMatrixUploadOriginalName(err) ?? (err instanceof Error ? err.name : typeof err);
          const error = toMatrixUploadError(err, stage);
          // eslint-disable-next-line no-console
          console.error('[mr-upload]', {
            stage,
            originalName,
            name: error.name,
            errcode: error.errcode,
            httpStatus: error.httpStatus,
            message: error.message,
          });
          throw error;
        };

        try {
          // Re-resolve the live Room from the matrix client at send/retry
          // time. context.room is a snapshot from start(); it may be stale
          // by retry time (encryption upgrade, membership change,
          // signal-bridge member added/removed). Using the live room also
          // closes a plaintext-leak window: a room that gained encryption
          // between original failure and retry would otherwise be sent
          // unencrypted because context.room.hasEncryptionStateEvent()
          // returns the cached value.
          liveContext = refreshMindroomRoomInputVoiceSendContext(mx, context);
          if (!liveContext) {
            throw new Error(
              'This room is no longer available. Discard the unsent voice message and try again later.'
            );
          }

          if (
            store.get(voiceAutoSendPendingAtom) &&
            (!voiceAutoSendClaimedRef.current || voiceAutoSendInFlightRef.current)
          ) {
            throw new Error(
              'Another voice message is still sending. Please wait before recording again.'
            );
          }
          if (!voiceAutoSendClaimedRef.current) {
            voiceAutoSendClaimedRef.current = true;
            store.set(voiceAutoSendPendingAtom, true);
          }
          voiceAutoSendInFlightRef.current = true;

          try {
            fileItems = await createVoiceUploadItems(file, duration, waveform, liveContext.room);
          } catch (err) {
            return logAndThrowUploadError(err, 'create');
          }
          const [fileItem] = fileItems;
          if (fileItems.length !== 1 || !fileItem) {
            return logAndThrowUploadError(
              new Error(`Voice message preparation returned ${fileItems.length} upload items.`),
              'create'
            );
          }
          appendUploadItemsToRoomBoard(liveContext.roomId, fileItems);

          let mxc: string;
          try {
            mxc = await uploadVoiceItem(fileItem);
          } catch (err) {
            return logAndThrowUploadError(err, 'upload');
          }
          try {
            await sendVoiceItem(liveContext, fileItem, mxc);
          } catch (err) {
            return logAndThrowUploadError(err, 'send');
          }
          clearReplyDraftForVoiceContext(liveContext);
        } finally {
          if (liveContext && fileItems.length > 0) {
            removeUploadsFromBoard(
              fileItems.map((fileItem) => fileItem.file),
              liveContext.roomId
            );
          }
          releaseVoiceAutoSend();
        }
      },
      [
        appendUploadItemsToRoomBoard,
        clearReplyDraftForVoiceContext,
        createVoiceUploadItems,
        mx,
        removeUploadsFromBoard,
        releaseVoiceAutoSend,
        sendVoiceItem,
        store,
        uploadVoiceItem,
      ]
    );

    const submit = useCallback(async () => {
      if (submitInFlightRef.current) return;
      submitInFlightRef.current = true;
      let submitPendingStarted = false;

      try {
        if (store.get(voiceAutoSendPendingAtom)) return;

        const commandName = getBeginCommand(editor);
        let plainText = toPlainText(editor.children, isMarkdown).trim();
        let customHtml = trimCustomHtml(
          toMatrixCustomHTML(editor.children, {
            allowTextFormatting: true,
            allowBlockMarkdown: isMarkdown,
            allowInlineMarkdown: isMarkdown,
          })
        );
        let msgType = MsgType.Text;

        if (commandName) {
          plainText = trimCommand(commandName, plainText);
          customHtml = trimCommand(commandName, customHtml);
        }
        if (commandName === Command.Me) {
          msgType = MsgType.Emote;
        } else if (commandName === Command.Notice) {
          msgType = MsgType.Notice;
        } else if (commandName === Command.Shrug) {
          plainText = `${SHRUG} ${plainText}`;
          customHtml = `${SHRUG} ${customHtml}`;
        } else if (commandName === Command.TableFlip) {
          plainText = `${TABLEFLIP} ${plainText}`;
          customHtml = `${TABLEFLIP} ${customHtml}`;
        } else if (commandName === Command.UnFlip) {
          plainText = `${UNFLIP} ${plainText}`;
          customHtml = `${UNFLIP} ${customHtml}`;
        } else if (commandName) {
          const commandContent = commands[commandName as Command];
          if (commandContent) {
            commandContent.exe(plainText);
          }
          resetEditor(editor);
          resetEditorHistory(editor);
          sendTypingStatus(false);
          if (selectedFilesRef.current.length > 0) {
            await startSendSession();
          }
          return;
        }

        const hasText = plainText !== '';
        const hasUploads = selectedFilesRef.current.length > 0;
        if (!hasText && !hasUploads) return;

        let content: IContent | undefined;
        if (hasText) {
          const body = plainText;
          const formattedBody = customHtml;
          const mentionData = getMentions(mx, roomId, editor);

          content = {
            msgtype: msgType,
            body,
          };

          if (replyDraft && replyDraft.userId !== mx.getUserId()) {
            mentionData.users.add(replyDraft.userId);
          }

          const mMentions = getMentionContent(Array.from(mentionData.users), mentionData.room);
          content['m.mentions'] = mMentions;

          if (replyDraft || !customHtmlEqualsPlainText(formattedBody, body)) {
            content.format = 'org.matrix.custom.html';
            content.formatted_body = formattedBody;
          }
        }

        if (hasUploads) {
          await startSendSession({ textContent: content });
          return;
        }

        if (!content) return;

        const relation = getMindroomRoomInputMessageRelation(
          replyDraft,
          threadId,
          threadingEnabled
        );
        if (relation) {
          content['m.relates_to'] = relation;
        }
        submitPendingStarted = true;
        setSubmitPending(true);
        await mx.sendMessage(roomId, content as any);
        resetEditor(editor);
        resetEditorHistory(editor);
        setReplyDraft(undefined);
        sendTypingStatus(false);
      } finally {
        if (submitPendingStarted) {
          setSubmitPending(false);
        }
        submitInFlightRef.current = false;
      }
    }, [
      mx,
      roomId,
      editor,
      replyDraft,
      sendTypingStatus,
      setReplyDraft,
      isMarkdown,
      commands,
      threadId,
      threadingEnabled,
      startSendSession,
      store,
    ]);

    const handleUploadBoardSend = useCallback(async () => {
      // Intentional CINNY-067 behavior: the upload board Send action now shares the unified
      // submit path, so pending text and attachments stay in the same send session.
      await submit();
    }, [submit]);

    useEffect(() => {
      processSendSession();
    }, [processSendSession, uploads, selectedFiles]);

    const handleKeyDown: KeyboardEventHandler = useCallback(
      (evt) => {
        if (
          (isKeyHotkey('mod+enter', evt) || (!enterForNewline && isKeyHotkey('enter', evt))) &&
          !isComposing(evt)
        ) {
          evt.preventDefault();
          if (autocompleteQuery) return;
          submit();
        }
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          if (autocompleteQuery) {
            setAutocompleteQuery(undefined);
            return;
          }
          setReplyDraft(undefined);
        }
      },
      [submit, setReplyDraft, enterForNewline, autocompleteQuery, isComposing]
    );

    const handleKeyUp: KeyboardEventHandler = useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          return;
        }

        if (!hideActivity) {
          sendTypingStatus(!isEmptyEditor(editor));
        }

        const prevWordRange = getPrevWorldRange(editor);
        if (!prevWordRange) {
          setAutocompleteQuery(undefined);
          return;
        }

        const mindroomCommandQuery = getMindroomRoomInputAutocompleteQuery(editor, prevWordRange);
        if (mindroomCommandQuery) {
          setAutocompleteQuery(mindroomCommandQuery);
          return;
        }

        const query = getAutocompleteQuery<AutocompletePrefix>(
          editor,
          prevWordRange,
          AUTOCOMPLETE_PREFIXES
        );
        setAutocompleteQuery(query);
      },
      [editor, sendTypingStatus, hideActivity]
    );

    const handleCloseAutocomplete = useCallback(() => {
      setAutocompleteQuery(undefined);
      ReactEditor.focus(editor);
    }, [editor]);

    const handleEmoticonSelect = (key: string, shortcode: string) => {
      editor.insertNode(createEmoticonElement(key, shortcode));
      moveCursor(editor);
    };

    const handleStickerSelect = async (mxc: string, shortcode: string, label: string) => {
      const stickerUrl = mxcUrlToHttp(mx, mxc, useAuthentication);
      if (!stickerUrl) return;

      const info = await getImageInfo(
        await loadImageElement(stickerUrl),
        await getImageUrlBlob(stickerUrl)
      );

      mx.sendEvent(roomId, EventType.Sticker, {
        body: label,
        url: mxc,
        info,
      });
    };

    return (
      <div ref={ref}>
        {selectedFiles.length > 0 && (
          <UploadBoard
            header={
              <UploadBoardHeader
                open={uploadBoard}
                onToggle={() => setUploadBoard(!uploadBoard)}
                uploadFamilyObserverAtom={uploadFamilyObserverAtom}
                onSend={handleUploadBoardSend}
                onCancel={handleCancelUpload}
              />
            }
          >
            {uploadBoard && (
              <Scroll size="300" hideTrack visibility="Hover">
                <UploadBoardContent>
                  {Array.from(selectedFiles)
                    .reverse()
                    .map((fileItem, index) => (
                      <UploadCardRenderer
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        isEncrypted={room.hasEncryptionStateEvent()}
                        fileItem={fileItem}
                        setMetadata={handleFileMetadata}
                        onRemove={handleRemoveUpload}
                      />
                    ))}
                </UploadBoardContent>
              </Scroll>
            )}
          </UploadBoard>
        )}
        <Overlay
          open={dropZoneVisible}
          backdrop={<OverlayBackdrop />}
          style={{ pointerEvents: 'none' }}
        >
          <OverlayCenter>
            <Dialog variant="Primary">
              <Box
                direction="Column"
                justifyContent="Center"
                alignItems="Center"
                gap="500"
                style={{ padding: toRem(60) }}
              >
                <Icon size="600" src={Icons.File} />
                <Text size="H4" align="Center">
                  {`Drop Files in "${room?.name || 'Room'}"`}
                </Text>
                <Text align="Center">Drag and drop files here or click for selection dialog</Text>
              </Box>
            </Dialog>
          </OverlayCenter>
        </Overlay>
        {autocompleteQuery?.prefix === AutocompletePrefix.RoomMention && (
          <RoomMentionAutocomplete
            roomId={roomId}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.UserMention && (
          <UserMentionAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Emoticon && (
          <EmoticonAutocomplete
            imagePackRooms={imagePackRooms}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Command && (
          <CommandAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {isMindroomRoomInputAutocompleteQuery(autocompleteQuery) && (
          <MindroomRoomInputAutocomplete
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        <CustomEditor
          editableName="RoomInput"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          editor={editor}
          placeholder="Send a message..."
          onChange={handleEditorChange}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPaste={handlePaste}
          top={
            (replyDraft ||
              (!!threadId && submitPending) ||
              voiceRecorderOpen ||
              ownsPendingVoiceDraft) && (
              <div>
                {(replyDraft || (!!threadId && submitPending)) && (
                  <MindroomRoomInputReplyContext
                    room={room}
                    relation={replyDraft?.relation}
                    pendingSend={!!threadId && submitPending}
                    leading={
                      replyDraft && (
                        <IconButton
                          onClick={() => setReplyDraft(undefined)}
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                        >
                          <Icon src={Icons.Cross} size="50" />
                        </IconButton>
                      )
                    }
                  >
                    {replyDraft && (
                      <ReplyLayout
                        userColor={replyUsernameColor}
                        username={
                          <Text size="T300" truncate>
                            <b>
                              {getMemberDisplayName(room, replyDraft.userId) ??
                                getMxIdLocalPart(replyDraft.userId) ??
                                replyDraft.userId}
                            </b>
                          </Text>
                        }
                      >
                        <Text size="T300" truncate>
                          {trimReplyFromBody(replyDraft.body)}
                        </Text>
                      </ReplyLayout>
                    )}
                  </MindroomRoomInputReplyContext>
                )}
                {(voiceRecorderOpen || ownsPendingVoiceDraft) && (
                  <MindroomVoiceRecorderComposer
                    active={voiceRecorderOpen}
                    sendDisabled={voiceAutoSendPending}
                    onClose={handleCloseVoiceRecorder}
                    onSendStopRequest={claimVoiceAutoSend}
                    onSendStopFailure={releaseVoiceAutoSend}
                    onSendRecording={handleVoiceSend}
                    getSendContext={getVoiceSendContext}
                  />
                )}
              </div>
            )
          }
          before={
            <>
              <IconButton
                onClick={() => pickFile('*')}
                variant="SurfaceVariant"
                size="300"
                radii="300"
              >
                <Icon src={Icons.PlusCircle} />
              </IconButton>
              <IconButton
                onClick={() => {
                  if (voiceRecorderOpen || voiceAutoSendPending || otherRoomOwnsPendingVoiceDraft)
                    return;
                  pauseAllMediaElements();
                  setVoiceRecorderOpen(true);
                }}
                variant="SurfaceVariant"
                size="300"
                radii="300"
                disabled={
                  voiceRecorderOpen || voiceAutoSendPending || otherRoomOwnsPendingVoiceDraft
                }
                aria-label={
                  otherPendingVoiceRoomName
                    ? `Voice recording paused — finish or discard your unsent recording in ${otherPendingVoiceRoomName}`
                    : 'Record voice message'
                }
              >
                <Icon src={Icons.Mic} />
              </IconButton>
            </>
          }
          after={
            <>
              <IconButton
                variant="SurfaceVariant"
                size="300"
                radii="300"
                onClick={() => setToolbar(!toolbar)}
              >
                <Icon src={toolbar ? Icons.AlphabetUnderline : Icons.Alphabet} />
              </IconButton>
              <UseStateProvider initial={undefined}>
                {(emojiBoardTab: EmojiBoardTab | undefined, setEmojiBoardTab) => (
                  <PopOut
                    offset={16}
                    alignOffset={-44}
                    position="Top"
                    align="End"
                    anchor={
                      emojiBoardTab === undefined
                        ? undefined
                        : emojiBtnRef.current?.getBoundingClientRect() ?? undefined
                    }
                    content={
                      <EmojiBoard
                        tab={emojiBoardTab}
                        onTabChange={setEmojiBoardTab}
                        imagePackRooms={imagePackRooms}
                        returnFocusOnDeactivate={false}
                        onEmojiSelect={handleEmoticonSelect}
                        onCustomEmojiSelect={handleEmoticonSelect}
                        onStickerSelect={handleStickerSelect}
                        requestClose={() => {
                          setEmojiBoardTab((t) => {
                            if (t) {
                              if (!mobileOrTablet()) ReactEditor.focus(editor);
                              return undefined;
                            }
                            return t;
                          });
                        }}
                      />
                    }
                  >
                    {!hideStickerBtn && (
                      <IconButton
                        aria-pressed={emojiBoardTab === EmojiBoardTab.Sticker}
                        onClick={() => setEmojiBoardTab(EmojiBoardTab.Sticker)}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                      >
                        <Icon
                          src={Icons.Sticker}
                          filled={emojiBoardTab === EmojiBoardTab.Sticker}
                        />
                      </IconButton>
                    )}
                    <IconButton
                      ref={emojiBtnRef}
                      aria-pressed={
                        hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                      }
                      onClick={() => setEmojiBoardTab(EmojiBoardTab.Emoji)}
                      variant="SurfaceVariant"
                      size="300"
                      radii="300"
                    >
                      <Icon
                        src={Icons.Smile}
                        filled={
                          hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                        }
                      />
                    </IconButton>
                  </PopOut>
                )}
              </UseStateProvider>
              <IconButton onClick={submit} variant="SurfaceVariant" size="300" radii="300">
                <Icon src={Icons.Send} />
              </IconButton>
            </>
          }
          bottom={
            toolbar && (
              <div>
                <Line variant="SurfaceVariant" size="300" />
                <Toolbar />
              </div>
            )
          }
        />
      </div>
    );
  }
);
