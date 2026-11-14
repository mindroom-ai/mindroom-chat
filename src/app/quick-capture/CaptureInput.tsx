import {
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { ParseKeys, TFunction } from 'i18next';
import { Icon, Icons, type IconSrc } from 'folds';
import { useTranslation } from 'react-i18next';
import { getDataTransferFiles } from '../lib/dom';
import {
  captureScreenshot,
  isNativeQuickCaptureAvailable,
  openScreenRecordingSettings,
  ScreenshotError,
  type ScreenshotErrorCode,
  type ScreenshotTarget,
} from '../native/nativeQuickCapture';
import { isComposingKey } from '../shortcuts/shortcuts';
import type { CaptureClient } from './captureChannel';
import { captureKeyAction } from './captureKeys';
import type { CaptureErrorCode } from './captureProtocol';
import * as css from './QuickCapturePage.css';

/** The most images one entry carries. */
export const MAX_CAPTURE_IMAGES = 4;

const ERROR_TEXT: Record<CaptureErrorCode, ParseKeys> = {
  'no-room': 'featureUi.quickCapture.error.noRoom',
  'upload-failed': 'featureUi.quickCapture.error.uploadFailed',
  'send-failed': 'featureUi.quickCapture.error.sendFailed',
  forbidden: 'featureUi.quickCapture.error.forbidden',
  timeout: 'featureUi.quickCapture.error.timeout',
};

/** What the widget says for a request the host could not run. */
export const captureErrorText = (t: TFunction, code: CaptureErrorCode): string =>
  t(ERROR_TEXT[code]);

const screenshotErrorText = (t: TFunction, code: ScreenshotErrorCode): string => {
  if (code === 'PERMISSION_DENIED') return t('featureUi.quickCapture.screenshot.denied');
  if (code === 'NO_WINDOW') return t('featureUi.quickCapture.screenshot.noWindow');
  return t('featureUi.quickCapture.screenshot.failed');
};

/** The images of a paste; a paste with none stays the browser's (text). */
const pastedImages = (event: ClipboardEvent<HTMLTextAreaElement>): File[] =>
  (getDataTransferFiles(event.clipboardData) ?? []).filter((file) =>
    file.type.startsWith('image/')
  );

/**
 * The caret is at the end of the text: before that, `ArrowDown` moves it, through lines a long
 * paragraph wraps into too, which no character marks.
 */
const caretAtEnd = (field: HTMLTextAreaElement): boolean =>
  field.selectionStart === field.value.length && field.selectionEnd === field.value.length;

type ToolProps = { label: string; icon: IconSrc; disabled: boolean; onClick: () => void };

/** The thread a send that failed part way started: the entry's rest goes in it, not in a new one. */
export type CaptureStarted = { roomId: string; threadId: string };

type CaptureInputProps = {
  /** Null while no room is chosen: a send opens the picker instead. */
  roomId: string | null;
  text: string;
  onText: (text: string) => void;
  /** The attached images, held with the text above the widget. */
  images: File[];
  onImages: Dispatch<SetStateAction<File[]>>;
  started: CaptureStarted | undefined;
  onStarted: (started: CaptureStarted | undefined) => void;
  request: CaptureClient['request'];
  apple: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  onFocus: () => void;
  onToList: () => void;
  onPicker: () => void;
  /** After an entry sent with "open": the main window shows it. */
  onOpened: () => Promise<void>;
};

/**
 * The entry: its images, the text field, the screenshot buttons on the Mac, Send, and what became
 * of the last send. While a send is in flight the field is read-only, so a second Enter sends nothing.
 */
export function CaptureInput({
  roomId,
  text,
  onText,
  images,
  onImages: setImages,
  started,
  onStarted: setStarted,
  request,
  apple,
  inputRef,
  onFocus,
  onToList,
  onPicker,
  onOpened,
}: CaptureInputProps) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendError, setSendError] = useState<CaptureErrorCode>();
  const [shotError, setShotError] = useState<ScreenshotErrorCode>();
  const screenshots = isNativeQuickCaptureAvailable();
  const full = images.length >= MAX_CAPTURE_IMAGES;

  const attach = (files: File[]) =>
    setImages((current) => [...current, ...files].slice(0, MAX_CAPTURE_IMAGES));

  const send = async (open: boolean) => {
    const entry = text.trim();
    if (sendingRef.current || (entry === '' && images.length === 0)) return;
    if (roomId === null) {
      onPicker();
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setSendError(undefined);
    const threadId = started?.roomId === roomId ? started.threadId : undefined;
    const result = await request({
      kind: 'send',
      roomId,
      text: entry,
      images,
      open,
      ...(threadId === undefined ? {} : { threadId }),
    });
    sendingRef.current = false;
    setSending(false);
    if (!result.ok) {
      setSendError(result.error);
      const { posted } = result;
      if (posted) {
        setStarted({ roomId, threadId: posted.threadId });
        const out = images.slice(0, posted.images);
        setImages((current) => current.filter((image) => !out.includes(image)));
      }
      return;
    }
    setStarted(undefined);
    onText('');
    setShotError(undefined);
    // Only what went out: a screenshot started before the send may have come in since.
    setImages((current) => current.filter((image) => !images.includes(image)));
    inputRef.current?.focus();
    if (open) await onOpened();
  };

  const screenshot = async (target: ScreenshotTarget) => {
    // The entry is frozen while it sends.
    if (full || sendingRef.current) return;
    setShotError(undefined);
    try {
      attach([await captureScreenshot(target)]);
    } catch (error) {
      setShotError(error instanceof ScreenshotError ? error.code : 'CAPTURE_FAILED');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKey(event.nativeEvent)) return;
    const field = event.currentTarget;
    const action = captureKeyAction(event, {
      zone: 'input',
      inputEmpty: field.value === '',
      caretAtEnd: caretAtEnd(field),
      firstRow: false,
      apple,
    });
    // Escape goes on to the page, which closes what is open or hides the widget.
    if (!action || action.kind === 'escape') return;
    if (action.kind === 'screenshot' && !screenshots) return;
    event.preventDefault();
    if (action.kind === 'send') void send(action.open);
    else if (action.kind === 'screenshot') void screenshot(action.target);
    else if (action.kind === 'toList') onToList();
    else if (action.kind === 'picker') onPicker();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    // While the entry sends, a paste neither attaches nor inserts anything.
    if (sendingRef.current) {
      event.preventDefault();
      return;
    }
    const pasted = pastedImages(event);
    if (pasted.length === 0) return;
    event.preventDefault();
    attach(pasted);
  };

  const ready = text.trim() !== '' || images.length > 0;

  const toolButton = ({ label, icon, disabled, onClick }: ToolProps) => (
    <button
      type="button"
      className={css.ToolButton}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size="100" src={icon} />
    </button>
  );

  return (
    <div className={css.EntryBlock} data-capture-entry="">
      <div className={css.Entry}>
        {images.length > 0 && (
          <div className={css.Attachments}>
            {images.map((image, index) => (
              // Two pastes of one picture are two images with one name; the chips hold no state.
              <span key={`${index}:${image.name}`} className={css.Attachment}>
                <Icon size="50" src={Icons.Photo} className={css.Muted} />
                <span className={css.AttachmentName}>{image.name}</span>
                <button
                  type="button"
                  className={css.AttachmentRemove}
                  aria-label={t('featureUi.quickCapture.attach.remove', { name: image.name })}
                  disabled={sending}
                  onClick={() => setImages((current) => current.filter((kept) => kept !== image))}
                >
                  <Icon size="50" src={Icons.Cross} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className={css.EntryRow}>
          <textarea
            ref={inputRef}
            className={css.EntryField}
            aria-label={t('featureUi.quickCapture.input.label')}
            placeholder={t('featureUi.quickCapture.input.placeholder')}
            value={text}
            readOnly={sending}
            aria-busy={sending}
            dir="auto"
            onChange={(event) => onText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={onFocus}
          />
          <div className={css.EntryTools}>
            {screenshots &&
              toolButton({
                label: t('featureUi.quickCapture.attach.window'),
                icon: Icons.Photo,
                disabled: full || sending,
                onClick: () => void screenshot('window'),
              })}
            {screenshots &&
              toolButton({
                label: t('featureUi.quickCapture.attach.screen'),
                icon: Icons.Monitor,
                disabled: full || sending,
                onClick: () => void screenshot('screen'),
              })}
            {/* Gray while there is nothing to send, the accent once there is. */}
            <button
              type="button"
              className={css.SendButton}
              aria-label={t('featureUi.quickCapture.input.send')}
              title={t('featureUi.quickCapture.input.send')}
              disabled={sending}
              data-ready={ready}
              onClick={() => void send(false)}
            >
              <Icon size="50" src={Icons.ArrowTop} />
            </button>
          </div>
        </div>
      </div>
      {(sending || sendError || shotError) && (
        <div className={css.Status}>
          {sending && (
            <span className={css.Muted} role="status">
              {t('featureUi.quickCapture.input.sending')}
            </span>
          )}
          {!sending && sendError && (
            <span className={css.Failure} role="alert">
              {captureErrorText(t, sendError)}
            </span>
          )}
          {shotError && (
            <span className={css.Failure} role="alert">
              {screenshotErrorText(t, shotError)}
            </span>
          )}
          {shotError === 'PERMISSION_DENIED' && (
            <button
              type="button"
              className={css.SmallButton}
              onClick={() => void openScreenRecordingSettings()}
            >
              {t('featureUi.quickCapture.screenshot.openSettings')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
