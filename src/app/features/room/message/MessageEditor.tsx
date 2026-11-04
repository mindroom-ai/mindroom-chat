import { KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import { type IContent, type MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import { type Descendant, Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { Box, Button, Spinner, Text, color, config } from 'folds';
import {
  AutocompletePrefix,
  type AutocompleteQuery,
  createParagraphElement,
  CustomEditor,
  customHtmlEqualsPlainText,
  EmoticonAutocomplete,
  getAutocompleteQuery,
  getMentions,
  getPrevWorldRange,
  htmlToEditorInput,
  toMatrixCustomHTML,
  toPlainText,
  trimCustomHtml,
  useEditor,
} from '../../../components/editor';
import { useComposingCheck } from '../../../hooks/useComposingCheck';
import { useImagePackRooms } from '../../../hooks/useImagePackRooms';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSettingValue } from '../../../state/hooks/useSettingValue';
import { settingsAtom } from '../../../state/settings';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { mobileOrTablet } from '../../../utils/user-agent';
import { trimReplyFromBody } from '../../../utils/room';
import { buildMindroomEditContent } from '../../../mindroom/messages/longEdit';
import { useMindroomEditableContent } from '../../../mindroom/messages/useMindroomEditableContent';
import { TEXT_MSGTYPES } from '../../../mindroom/threads/timelineRowTypes';

const CUSTOM_HTML = 'org.matrix.custom.html';

const isPlainEnter = isKeyHotkey('enter');
const isModEnter = isKeyHotkey('mod+enter');
const isEscape = isKeyHotkey('escape');

/**
 * The lines the editor starts with: the message's HTML, as Markdown source when Markdown is on,
 * or one line per line of its body when it has no HTML. A reply fallback is not part of the text.
 */
export const getEditorDocument = (
  content: Record<string, unknown>,
  markdown: boolean
): Descendant[] => {
  const html = content.format === CUSTOM_HTML ? content.formatted_body : undefined;
  if (typeof html === 'string' && html.trim() !== '') return htmlToEditorInput(html, markdown);
  const body = typeof content.body === 'string' ? trimReplyFromBody(content.body) : '';
  return body.split('\n').map((line) => createParagraphElement(line));
};

/**
 * The `m.new_content` of an edit: the plain body, HTML only when it says more than the body,
 * and the people the text mentions (MSC3952). Undefined when no text is left.
 */
export const getEditedContent = (
  editor: Editor,
  markdown: boolean,
  msgtype: string,
  ownUserId?: string
): IContent | undefined => {
  const body = toPlainText(editor.children, markdown).trim();
  if (body === '') return undefined;
  const html = trimCustomHtml(
    toMatrixCustomHTML(editor.children, {
      allowTextFormatting: true,
      allowInlineMarkdown: markdown,
      allowBlockMarkdown: markdown,
    })
  );
  const mentioned = getMentions(editor, ownUserId);
  const mentions: { user_ids?: string[]; room?: boolean } = {};
  if (mentioned.users.size > 0) mentions.user_ids = [...mentioned.users];
  if (mentioned.room) mentions.room = true;
  const formatting = customHtmlEqualsPlainText(html, body)
    ? {}
    : { format: CUSTOM_HTML, formatted_body: html };
  return { msgtype, body, ...formatting, 'm.mentions': mentions };
};

/** True when saving would send the text the message already has. */
export const isUnchanged = (before: Record<string, unknown>, after: IContent): boolean =>
  before.body === after.body &&
  (before.format === CUSTOM_HTML ? before.formatted_body : undefined) === after.formatted_body;

/** The message being edited, and what to do once the edit is saved or dropped. */
type EditSession = { room: Room; mEvent: MatrixEvent; onDone: () => void };

function EditorButtons({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave?: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box gap="200" alignItems="Center">
      {onSave && (
        <Button
          type="button"
          size="300"
          radii="300"
          variant="Primary"
          disabled={busy}
          before={busy ? <Spinner size="50" variant="Primary" fill="Solid" /> : undefined}
          onClick={onSave}
        >
          <Text size="B300">{t('featureUi.room.message.messageEditor.save')}</Text>
        </Button>
      )}
      <Button
        type="button"
        size="300"
        radii="300"
        variant="Secondary"
        fill="Soft"
        disabled={busy}
        onClick={onCancel}
      >
        <Text size="B300">{t('featureUi.room.message.messageEditor.cancel')}</Text>
      </Button>
    </Box>
  );
}

/** The editor once the text it starts from is known. */
function LoadedMessageEditor({
  room,
  mEvent,
  content,
  onDone,
}: EditSession & { content: Record<string, unknown> }) {
  const editor = useEditor();
  const isMarkdown = useSettingValue(settingsAtom, 'isMarkdown');
  const enterForNewline = useSettingValue(settingsAtom, 'enterForNewline');
  // Read once: later setting changes must not reset what is being typed.
  const [startDocument] = useState(() => getEditorDocument(content, isMarkdown));
  const [status, setStatus] = useState<'editing' | 'saving' | 'failed'>('editing');
  const saving = status === 'saving';
  const client = useMatrixClient();
  const composing = useComposingCheck();
  const { t } = useTranslation();
  // `:shortcode` suggestions, as in the composer: the room's, its spaces' and the server's packs.
  const packRooms = useImagePackRooms(room.roomId, useAtomValue(roomToParentsAtom));
  const [emoticonQuery, setEmoticonQuery] = useState<AutocompleteQuery<string>>();
  const [emoticonsShown, setEmoticonsShown] = useState(false);
  const closeEmoticons = useCallback(() => setEmoticonQuery(undefined), []);
  const syncEmoticonQuery = useCallback(() => {
    const range = getPrevWorldRange(editor);
    setEmoticonQuery(
      range ? getAutocompleteQuery(editor, range, [AutocompletePrefix.Emoticon]) : undefined
    );
  }, [editor]);
  const emoticonMenuOpen = emoticonQuery !== undefined && emoticonsShown;

  // Typing moves here when the editor opens, with the caret after the text.
  useEffect(() => {
    Transforms.select(editor, Editor.end(editor, []));
    ReactEditor.focus(editor);
  }, [editor]);

  const save = useCallback(async () => {
    const eventId = mEvent.getId();
    if (!eventId || saving) return;
    const msgtype =
      typeof content.msgtype === 'string' && TEXT_MSGTYPES.has(content.msgtype)
        ? content.msgtype
        : 'm.text';
    const edited = getEditedContent(editor, isMarkdown, msgtype, client.getUserId() ?? undefined);
    if (!edited) return;
    if (isUnchanged(content, edited)) {
      onDone();
      return;
    }
    setStatus('saving');
    try {
      const edit = await buildMindroomEditContent(client, room, edited, {
        rel_type: RelationType.Replace,
        event_id: eventId,
      });
      await client.sendMessage(room.roomId, mEvent.threadRootId ?? null, edit as never);
      onDone();
    } catch {
      setStatus('failed');
    }
  }, [client, content, editor, isMarkdown, mEvent, onDone, room, saving]);

  const handleKeyDown = useCallback(
    (evt: KeyboardEvent<HTMLDivElement>) => {
      if (composing(evt.nativeEvent)) return;
      if (isEscape(evt.nativeEvent)) {
        // Escape leaves the edit only; the thread or dialog around it stays open.
        evt.preventDefault();
        evt.stopPropagation();
        onDone();
        return;
      }
      // With suggestions open, Enter picks one (the menu listens for it) instead of saving.
      if (emoticonMenuOpen && isPlainEnter(evt.nativeEvent)) {
        evt.preventDefault();
        return;
      }
      const saveKey = enterForNewline || mobileOrTablet() ? isModEnter : isPlainEnter;
      if (saveKey(evt.nativeEvent)) {
        evt.preventDefault();
        void save();
      }
    },
    [composing, emoticonMenuOpen, enterForNewline, onDone, save]
  );

  return (
    <Box direction="Column" gap="200" style={{ paddingBlock: config.space.S100 }}>
      {emoticonQuery && (
        <EmoticonAutocomplete
          editor={editor}
          query={emoticonQuery}
          packRooms={packRooms}
          onSuggestionsChange={setEmoticonsShown}
          requestClose={closeEmoticons}
        />
      )}
      <CustomEditor
        editor={editor}
        initialValue={startDocument}
        editableName="MessageEditor"
        ariaLabel={t('mindroomUi.messages.mindroomMessage.editMessage')}
        placeholder={t('featureUi.room.message.messageEditor.editMessage')}
        readOnly={saving}
        maxHeight="40vh"
        onKeyDown={handleKeyDown}
        onKeyUp={syncEmoticonQuery}
      />
      {status === 'failed' && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {t('threadActions.failed')}
        </Text>
      )}
      <EditorButtons busy={saving} onSave={() => void save()} onCancel={onDone} />
    </Box>
  );
}

/**
 * Edits a text message in place, in the composer's rich text editor, and sends the edit as an
 * `m.replace` event. It starts from the latest text, whole for a message sent as a long text,
 * and an edit too large for one event is sent as a long text too.
 */
export function MessageEditor({ room, mEvent, onDone }: EditSession) {
  const { t } = useTranslation();
  const editable = useMindroomEditableContent(room, mEvent);
  if (editable.content) {
    return (
      <LoadedMessageEditor room={room} mEvent={mEvent} content={editable.content} onDone={onDone} />
    );
  }
  return (
    <Box direction="Column" gap="200" style={{ paddingBlock: config.space.S100 }}>
      {editable.failed ? (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {t('threadActions.failed')}
        </Text>
      ) : (
        <Spinner size="200" variant="Secondary" />
      )}
      <EditorButtons busy={false} onCancel={onDone} />
    </Box>
  );
}
