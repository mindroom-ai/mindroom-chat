import React, {
  KeyboardEventHandler,
  RefObject,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue } from 'jotai';
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
  encryptFile,
  getImageInfo,
  getMxIdLocalPart,
  mxcUrlToHttp,
} from '../../utils/matrix';
import { useTypingStatusUpdater } from '../../hooks/useTypingStatusUpdater';
import { useFilePicker } from '../../hooks/useFilePicker';
import { useFilePasteHandler } from '../../hooks/useFilePasteHandler';
import { useFileDropZone } from '../../hooks/useFileDrop';
import {
  TUploadItem,
  TUploadMetadata,
  roomIdToMsgDraftAtomFamily,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from '../../state/room/roomInputDrafts';
import { UploadCardRenderer } from '../../components/upload-card';
import {
  UploadBoard,
  UploadBoardContent,
  UploadBoardHeader,
} from '../../components/upload-board';
import {
  Upload,
  UploadStatus,
  createUploadFamilyObserverAtom,
} from '../../state/upload';
import { getImageUrlBlob, loadImageElement, pauseAllMediaElements } from '../../utils/dom';
import { safeFile } from '../../utils/mimeTypes';
import { fulfilledPromiseSettledResult } from '../../utils/common';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import {
  getAudioMsgContent,
  getFileMsgContent,
  getImageMsgContent,
  getVideoMsgContent,
} from './msgContent';
import { getMemberDisplayName, getMentionContent, trimReplyFromBody } from '../../utils/room';
import { CommandAutocomplete } from './CommandAutocomplete';
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
import {
  getMindroomRoomInputAutocompleteQuery,
  getMindroomRoomInputMessageRelation,
  isMindroomRoomInputAutocompleteQuery,
  MindroomRoomInputAutocomplete,
  MindroomRoomInputReplyContext,
  MindroomVoiceRecorderComposer,
  useRoomInputSendSessionController,
  type MindroomRoomInputAutocompletePrefix,
} from '../../mindroom/room-input/RoomInputMindroomExtensions';

type RoomInputAutocompletePrefix = AutocompletePrefix | MindroomRoomInputAutocompletePrefix;

interface RoomInputProps {
  editor: Editor;
  fileDropContainerRef: RefObject<HTMLElement>;
  roomId: string;
  room: Room;
  threadId?: string;
}
export const RoomInput = forwardRef<HTMLDivElement, RoomInputProps>(
  ({ editor, fileDropContainerRef, roomId, room, threadId }, ref) => {
    const mx = useMatrixClient();
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
    const [selectedFiles, setSelectedFiles] = useAtom(roomIdToUploadItemsAtomFamily(roomId));
    const selectedFilesRef = useRef(selectedFiles);
    selectedFilesRef.current = selectedFiles;
    const uploadFiles = useMemo(() => selectedFiles.map((f) => f.file), [selectedFiles]);
    // Keep the observer atom stable across ordinary rerenders; recreating it each render
    // causes RoomInput to resubscribe and can disrupt editor focus/selection.
    const uploadFamilyObserverAtom = useMemo(
      () => createUploadFamilyObserverAtom(roomUploadAtomFamily, uploadFiles),
      [uploadFiles]
    );
    const uploads = useAtomValue(uploadFamilyObserverAtom);
    const uploadsRef = useRef(uploads);
    uploadsRef.current = uploads;

    const imagePackRooms: Room[] = useImagePackRooms(roomId, roomToParents);

    const [toolbar, setToolbar] = useSetting(settingsAtom, 'editorToolbar');
    const [autocompleteQuery, setAutocompleteQuery] =
      useState<AutocompleteQuery<RoomInputAutocompletePrefix>>();
    const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);

    const sendTypingStatus = useTypingStatusUpdater(mx, roomId);

    const createUploadItems = useCallback(
      async (
        files: File[],
        getMetadata: (file: File, index: number) => TUploadMetadata = () => ({
          markedAsSpoiler: false,
        })
      ): Promise<TUploadItem[]> => {
        const safeFiles = files.map(safeFile);

        if (room.hasEncryptionStateEvent()) {
          const encryptFiles = fulfilledPromiseSettledResult(
            await Promise.allSettled(safeFiles.map((f) => encryptFile(f)))
          );

          return encryptFiles.map((ef, index) => ({
            ...ef,
            metadata: getMetadata(safeFiles[index], index),
          }));
        }

        return safeFiles.map((file, index) => ({
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: getMetadata(file, index),
        }));
      },
      [room]
    );

    const appendUploadItems = useCallback(
      (fileItems: TUploadItem[]) => {
        if (fileItems.length === 0) return;

        // startSendSession/processSendSession can run before React applies the atom update,
        // so keep the ref in sync for same-tick voice sends.
        selectedFilesRef.current = [...selectedFilesRef.current, ...fileItems];
        setUploadBoard(true);
        setSelectedFiles({
          type: 'PUT',
          item: fileItems,
        });
      },
      [setSelectedFiles]
    );

    const handleFiles = useCallback(
      async (files: File[]) => {
        appendUploadItems(await createUploadItems(files));
      },
      [appendUploadItems, createUploadItems]
    );

    const createVoiceUploadItems = useCallback(
      async (file: File, duration: number) =>
        createUploadItems([file], () => ({
          markedAsSpoiler: false,
          voiceMessage: {
            duration,
          },
        })),
      [createUploadItems]
    );
    const handleVoiceRecording = useCallback(
      async (file: File, duration: number) => {
        const fileItems = await createVoiceUploadItems(file, duration);
        appendUploadItems(fileItems);
      },
      [appendUploadItems, createVoiceUploadItems]
    );
    const pickFile = useFilePicker(handleFiles, true);
    const handlePaste = useFilePasteHandler(handleFiles);
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
        setSelectedFiles({
          type: 'REPLACE',
          item: fileItem,
          replacement,
        });
      },
      [setSelectedFiles]
    );

    const removeUploadsFromBoard = useCallback(
      (upload: TUploadContent | TUploadContent[]) => {
        const uploadList = Array.isArray(upload) ? upload : [upload];
        const removableItems = selectedFilesRef.current.filter((f) =>
          uploadList.some((candidate) => candidate === f.file)
        );

        if (removableItems.length > 0) {
          selectedFilesRef.current = selectedFilesRef.current.filter(
            (item) => !removableItems.includes(item)
          );
          setSelectedFiles({
            type: 'DELETE',
            item: removableItems,
          });
        }

        uploadList.forEach((candidate) => roomUploadAtomFamily.remove(candidate));
      },
      [setSelectedFiles]
    );

    const handleRemoveUpload = useCallback(
      (upload: TUploadContent | TUploadContent[]) => {
        removeUploadsFromBoard(upload);
      },
      [removeUploadsFromBoard]
    );

    const handleCancelUpload = useCallback(
      (uploadsToCancel: Upload[]) => {
        uploadsToCancel.forEach((upload) => {
          if (upload.status === UploadStatus.Loading) {
            mx.cancelUpload(upload.promise);
          }
        });
        removeUploadsFromBoard(uploadsToCancel.map((upload) => upload.file));
      },
      [mx, removeUploadsFromBoard]
    );

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
        return getFileMsgContent(fileItem, mxc);
      },
      [mx]
    );

    const { processSendSession, startSendSession } = useRoomInputSendSessionController({
      mx,
      room,
      roomId,
      threadId,
      replyDraft,
      setReplyDraft,
      editor,
      sendTypingStatus,
      selectedFilesRef,
      uploadsRef,
      buildUploadMessageContent,
      removeUploadsFromBoard,
    });

    const handleVoiceSend = useCallback(
      async (file: File, duration: number) => {
        const fileItems = await createVoiceUploadItems(file, duration);
        appendUploadItems(fileItems);
        await startSendSession({
          files: fileItems.map((item) => item.file),
        });
      },
      [appendUploadItems, createVoiceUploadItems, startSendSession]
    );

    const submit = useCallback(async () => {
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

      const relation = getMindroomRoomInputMessageRelation(replyDraft, threadId);
      if (relation) {
        content['m.relates_to'] = relation;
      }
      await mx.sendMessage(roomId, content as any);
      resetEditor(editor);
      resetEditorHistory(editor);
      setReplyDraft(undefined);
      sendTypingStatus(false);
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
      startSendSession,
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
                        isEncrypted={!!fileItem.encInfo}
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
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPaste={handlePaste}
          top={
            (replyDraft || threadId || voiceRecorderOpen) && (
              <div>
                {(replyDraft || threadId) && (
                  <MindroomRoomInputReplyContext
                    room={room}
                    relation={replyDraft?.relation}
                    threadId={threadId}
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
                <MindroomVoiceRecorderComposer
                  active={voiceRecorderOpen}
                  onClose={() => setVoiceRecorderOpen(false)}
                  onSaveRecording={handleVoiceRecording}
                  onSendRecording={handleVoiceSend}
                />
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
                  pauseAllMediaElements();
                  setVoiceRecorderOpen(true);
                }}
                variant="SurfaceVariant"
                size="300"
                radii="300"
                aria-label="Record voice message"
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
