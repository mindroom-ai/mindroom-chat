import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Icon, Icons } from 'folds';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useActiveSession } from '../matrix/session/useSessionStore';
import {
  hideQuickCapture,
  isNativeQuickCaptureAvailable,
  showMainWindow,
} from '../native/nativeQuickCapture';
import { keyCapsOf, usesCommandKey } from '../shortcuts/shortcuts';
import { ownDirectionLine } from '../ui/directional';
import type { CaptureChannel, CaptureClient } from './captureChannel';
import { CaptureInput } from './CaptureInput';
import type { CaptureZone } from './captureKeys';
import { CaptureList } from './CaptureList';
import type { CaptureState } from './captureProtocol';
import { CaptureRoomPicker, roomSigil } from './CaptureRoomPicker';
import * as css from './QuickCapturePage.css';
import { useCaptureEscape, useQuickCapture } from './useQuickCapture';

/** A window call the native side failed: the widget stays as it is. */
const warnOnFailure = (error: unknown) =>
  console.warn('[quick-capture] the window did not respond', error);

/** Hides the widget: on the Mac its window, in a browser nothing. */
const hide = () => hideQuickCapture().catch(warnOnFailure);

/** Brings the main window forward, where a thread just opened, and hides the widget. */
const showOpenedThread = async (): Promise<void> => {
  try {
    await showMainWindow();
    await hideQuickCapture();
  } catch (error) {
    warnOnFailure(error);
  }
};

type Hint = { keys: string[]; label: ParseKeys };
type HintSet = 'input' | 'list' | 'picker';

/** The keys of a part of the widget, as the platform writes them. */
const hintsOf = (part: HintSet, apple: boolean): Hint[] => {
  const caps = (keys: string) => keyCapsOf(keys, apple).join(apple ? '' : '+');
  const enter = caps('enter');
  switch (part) {
    case 'input':
      return [
        { keys: [enter], label: 'featureUi.quickCapture.hint.send' },
        { keys: [caps('mod+enter')], label: 'featureUi.quickCapture.hint.sendOpen' },
        { keys: ['tab'], label: 'featureUi.quickCapture.hint.room' },
        { keys: [caps('down')], label: 'featureUi.quickCapture.hint.list' },
      ];
    case 'list':
      return [
        { keys: ['j', 'k'], label: 'featureUi.quickCapture.hint.move' },
        { keys: ['space'], label: 'featureUi.quickCapture.hint.peek' },
        { keys: ['x'], label: 'featureUi.quickCapture.hint.done' },
        { keys: ['r'], label: 'featureUi.quickCapture.hint.reply' },
        { keys: [enter], label: 'featureUi.quickCapture.hint.open' },
      ];
    case 'picker':
      return [{ keys: [caps('up'), caps('down')], label: 'featureUi.quickCapture.hint.move' }];
  }
};

/** Key caps, each with what it does, for a hint line to hold. */
function Hints({ part, apple }: { part: HintSet; apple: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {hintsOf(part, apple).map(({ keys, label }) => (
        <span key={label} className={css.Hint}>
          {keys.map((key) => (
            <kbd key={key} className={css.Key} dir="ltr">
              {key}
            </kbd>
          ))}
          <span>{t(label)}</span>
        </span>
      ))}
    </>
  );
}

type CaptureWidgetProps = {
  state: CaptureState;
  request: CaptureClient['request'];
  text: string;
  onText: (text: string) => void;
  images: File[];
  onImages: Dispatch<SetStateAction<File[]>>;
};

/** The connected widget: the room, the entry, and the room's threads or the room picker. */
function CaptureWidget({ state, request, text, onText, images, onImages }: CaptureWidgetProps) {
  const { t } = useTranslation();
  const [apple] = useState(usesCommandKey);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [zone, setZone] = useState<CaptureZone>('input');
  const [peekOpen, setPeekOpen] = useState(false);
  const [pickerAsked, setPickerAsked] = useState(false);
  const caretToEnd = useRef(false);
  const room = state.rooms.find((listed) => listed.id === state.roomId);
  const roomName = room?.name ?? state.roomId ?? '';
  const pickerOpen = state.roomId === null || pickerAsked;

  // The caret is in the input whenever the widget shows, or in the picker's field while it is open.
  useEffect(() => {
    if (!pickerOpen) inputRef.current?.focus();
    const focusEntry = () => (pickerOpen ? searchRef : inputRef).current?.focus();
    window.addEventListener('focus', focusEntry);
    return () => window.removeEventListener('focus', focusEntry);
  }, [pickerOpen]);

  // Typed in the list, a character goes on in the input, after its text.
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!caretToEnd.current || !field) return;
    caretToEnd.current = false;
    field.setSelectionRange(field.value.length, field.value.length);
  }, [text]);

  useCaptureEscape(() => {
    if (pickerOpen && state.roomId !== null) setPickerAsked(false);
    else if (peekOpen) setPeekOpen(false);
    else void hide();
  });

  const toList = () => listRef.current?.querySelector<HTMLElement>('[data-capture-row]')?.focus();
  // An open picker takes the focus again; a new one takes it as it mounts.
  const toPicker = () => {
    setPickerAsked(true);
    searchRef.current?.focus();
  };
  const toInput = (typed?: string) => {
    // A field that is read-only holds an entry being sent, which takes no typing.
    if (typed && !inputRef.current?.readOnly) {
      caretToEnd.current = true;
      onText(text + typed);
    }
    inputRef.current?.focus();
  };

  return (
    <>
      <div className={css.Header}>
        <button
          type="button"
          className={css.RoomButton}
          aria-label={
            room
              ? t('featureUi.quickCapture.room.change', { room: roomName })
              : t('featureUi.quickCapture.room.choose')
          }
          aria-expanded={pickerOpen}
          onClick={() => setPickerAsked(!pickerOpen)}
        >
          {room && <span className={css.Sigil}>{roomSigil(room)}</span>}
          <span className={css.RoomName} {...ownDirectionLine}>
            {room ? roomName : t('featureUi.quickCapture.room.choose')}
          </span>
          <Icon size="50" src={Icons.ChevronBottom} className={css.Chevron} />
        </button>
      </div>
      <CaptureInput
        roomId={state.roomId}
        text={text}
        onText={onText}
        images={images}
        onImages={onImages}
        request={request}
        apple={apple}
        inputRef={inputRef}
        onFocus={() => setZone('input')}
        onToList={toList}
        onPicker={toPicker}
        onOpened={showOpenedThread}
        hints={
          <div className={css.EntryHints}>
            <Hints part="input" apple={apple} />
          </div>
        }
      />
      {pickerOpen ? (
        <CaptureRoomPicker
          rooms={state.rooms}
          roomId={state.roomId}
          request={request}
          apple={apple}
          fieldRef={searchRef}
          onFocus={() => setZone('picker')}
          onPicked={() => setPickerAsked(false)}
        />
      ) : (
        <CaptureList
          roomId={state.roomId ?? ''}
          roomName={roomName}
          items={state.items}
          request={request}
          apple={apple}
          listRef={listRef}
          peekOpen={peekOpen}
          onPeek={setPeekOpen}
          onZone={setZone}
          onToInput={toInput}
          onOpened={showOpenedThread}
        />
      )}
      {/* The list's keys, or the picker's while it is open; quiet while the focus is elsewhere. */}
      <div
        className={css.Footer}
        data-capture-hints=""
        data-active={pickerOpen ? zone === 'picker' : zone === 'list' || zone === 'reply'}
      >
        <Hints part={pickerOpen ? 'picker' : 'list'} apple={apple} />
      </div>
    </>
  );
}

/**
 * "MindRoom is not open", with a way to it on the Mac (a browser has no main window to show), or
 * "Sign in to MindRoom" when no account is.
 */
function CaptureNotice({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const native = isNativeQuickCaptureAvailable();
  useCaptureEscape(() => void hide());
  return (
    <div className={css.Notice}>
      <p className={css.NoticeText}>
        {signedIn
          ? t('featureUi.quickCapture.absent.title')
          : t('featureUi.quickCapture.signedOut.title')}
      </p>
      {signedIn && native && (
        <button
          type="button"
          className={css.SmallButton}
          onClick={() => void showMainWindow().catch(warnOnFailure)}
        >
          {t('featureUi.quickCapture.absent.open')}
        </button>
      )}
    </div>
  );
}

/**
 * The quick capture widget (`/quick-capture/`): a page with no Matrix client of its own, which
 * the signed-in app serves over a `BroadcastChannel` (QuickCaptureHost). It fills its window; on
 * the Mac that is a small window floating above other apps.
 */
export function QuickCapturePage({ channel }: { channel?: CaptureChannel }) {
  const { t } = useTranslation();
  const { client, snapshot } = useQuickCapture(channel);
  const signedIn = !!useActiveSession();
  // The entry, its images too, outlives a host that goes away and comes back.
  const [text, setText] = useState('');
  const [images, setImages] = useState<File[]>([]);

  useEffect(() => {
    document.title = t('featureUi.quickCapture.title');
  }, [t]);

  return (
    <div className={css.Page}>
      {client && snapshot.status === 'connected' && snapshot.state && (
        <CaptureWidget
          state={snapshot.state}
          request={client.request}
          text={text}
          onText={setText}
          images={images}
          onImages={setImages}
        />
      )}
      {snapshot.status === 'absent' && <CaptureNotice signedIn={signedIn} />}
    </div>
  );
}
