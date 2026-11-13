import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import classNames from 'classnames';
import type { ParseKeys } from 'i18next';
import { Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { copyToClipboard } from '../lib/dom';
import { isComposingKey } from '../shortcuts/shortcuts';
import { ownDirectionBlock, ownDirectionLine, revealDirectionControls } from '../ui/directional';
import type { CaptureClient } from './captureChannel';
import { captureKeyAction, type CaptureKeyAction } from './captureKeys';
import type { CaptureChip, CaptureErrorCode, CaptureItem } from './captureProtocol';
import { captureErrorText } from './CaptureInput';
import * as css from './QuickCapturePage.css';

const CHIP_TEXT: Record<CaptureChip, ParseKeys> = {
  working: 'featureUi.quickCapture.chip.working',
  'needs-you': 'featureUi.quickCapture.chip.needsYou',
  new: 'featureUi.quickCapture.chip.new',
};

/** A root the host is still sending carries its local id; it cannot be answered or opened yet. */
const isPending = (item: CaptureItem): boolean => item.threadId.startsWith('~');

const isFocused = (element: Element | null): boolean =>
  !!element && element.ownerDocument.activeElement === element;

type CaptureListProps = {
  roomId: string;
  roomName: string;
  items: CaptureItem[];
  request: CaptureClient['request'];
  apple: boolean;
  listRef: RefObject<HTMLDivElement>;
  peekOpen: boolean;
  onPeek: (open: boolean) => void;
  onZone: (zone: 'list' | 'reply') => void;
  onToInput: (text?: string) => void;
  /** After a thread opened: the main window shows it. */
  onOpened: () => Promise<void>;
};

/**
 * The room's threads. The selected row is the one with the focus, followed by its thread id, so a
 * new state that reorders the list keeps it; the peek shows under it with the reply field.
 */
export function CaptureList({
  roomId,
  roomName,
  items,
  request,
  apple,
  listRef,
  peekOpen,
  onPeek,
  onZone,
  onToInput,
  onOpened,
}: CaptureListProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const [selectedId, setSelectedId] = useState<string>();
  const [rowError, setRowError] = useState<{ threadId: string; code: CaptureErrorCode }>();
  const [copiedId, setCopiedId] = useState<string>();
  const [draft, setDraft] = useState({ threadId: '', text: '' });
  const [replying, setReplying] = useState(false);
  const replyingRef = useRef(false);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const replyRef = useRef<HTMLInputElement>(null);
  const focusReply = useRef(false);
  /** The row or field of the list that has the focus, until the focus goes elsewhere. */
  const lastFocused = useRef<HTMLElement | null>(null);
  /** Whether the row pressed had the focus already: a click on it toggles its peek. */
  const pressedSelected = useRef(false);

  const selected = items.find((item) => item.threadId === selectedId);
  // The row Tab reaches: the selected one, else the first, as when the selected thread is gone.
  const tabStopId = (selected ?? items[0])?.threadId;

  // A row or field the list moves, or takes away, loses the focus to the page: it gets it back,
  // or the selected row takes it.
  useLayoutEffect(() => {
    const element = lastFocused.current;
    const active = document.activeElement;
    if (!element || (active && active !== document.body)) return;
    if (element.isConnected) element.focus();
    else if (tabStopId) rows.current.get(tabStopId)?.focus();
  }, [items, tabStopId]);

  useLayoutEffect(() => {
    if (!focusReply.current) return;
    focusReply.current = false;
    replyRef.current?.focus();
  });

  const focusRow = (threadId: string) => rows.current.get(threadId)?.focus();

  const fail = (threadId: string, code: CaptureErrorCode) => setRowError({ threadId, code });

  const resolve = async (item: CaptureItem) => {
    if (isPending(item)) return;
    setRowError(undefined);
    const resolved = !item.resolved;
    // A resolved thread moves down among the resolved ones; the keyboard stays where it was.
    const index = items.indexOf(item);
    const neighbor = items[index + 1] ?? items[index - 1];
    const result = await request({ kind: 'resolve', roomId, threadId: item.threadId, resolved });
    if (!result.ok) fail(item.threadId, result.error);
    else if (resolved && neighbor && isFocused(rows.current.get(item.threadId) ?? null)) {
      focusRow(neighbor.threadId);
    }
  };

  const open = async (item: CaptureItem) => {
    if (isPending(item)) return;
    setRowError(undefined);
    const result = await request({ kind: 'open', roomId, threadId: item.threadId });
    if (result.ok) await onOpened();
    else fail(item.threadId, result.error);
  };

  const copy = async (item: CaptureItem) => {
    const text = item.replyText ?? item.line;
    if (text === '') return;
    if (await copyToClipboard(text)) setCopiedId(item.threadId);
  };

  const startReply = (item: CaptureItem) => {
    if (isPending(item)) return;
    onPeek(true);
    if (replyRef.current) replyRef.current.focus();
    else focusReply.current = true;
  };

  const sendReply = async (item: CaptureItem) => {
    const text = draft.threadId === item.threadId ? draft.text.trim() : '';
    if (text === '' || replyingRef.current || isPending(item)) return;
    replyingRef.current = true;
    setReplying(true);
    setRowError(undefined);
    const result = await request({ kind: 'reply', roomId, threadId: item.threadId, text });
    replyingRef.current = false;
    setReplying(false);
    if (result.ok) setDraft({ threadId: item.threadId, text: '' });
    else fail(item.threadId, result.error);
  };

  const run = (action: CaptureKeyAction, item: CaptureItem, index: number) => {
    switch (action.kind) {
      case 'move': {
        const next = items[index + action.by];
        if (next) focusRow(next.threadId);
        return;
      }
      case 'toInput':
        onToInput(action.text);
        return;
      case 'peek':
        onPeek(!peekOpen);
        return;
      case 'resolve':
        void resolve(item);
        return;
      case 'reply':
        startReply(item);
        return;
      case 'copy':
        void copy(item);
        return;
      case 'open':
        void open(item);
        return;
      default:
        // Escape goes on to the page; the other actions belong to the input and the picker.
        return;
    }
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: CaptureItem, index: number) => {
    if (isComposingKey(event.nativeEvent)) return;
    const context = { inputEmpty: false, caretOnLastLine: false, firstRow: index === 0, apple };
    const action = captureKeyAction(event, { ...context, zone: 'list' });
    if (!action || action.kind === 'escape') return;
    event.preventDefault();
    run(action, item, index);
  };

  const onReplyKeyDown = (event: KeyboardEvent<HTMLInputElement>, item: CaptureItem) => {
    if (isComposingKey(event.nativeEvent)) return;
    const context = { inputEmpty: false, caretOnLastLine: true, firstRow: false, apple };
    const action = captureKeyAction(event, { ...context, zone: 'reply' });
    if (action?.kind === 'send') {
      event.preventDefault();
      void sendReply(item);
    } else if (action?.kind === 'escape') {
      // The field goes with the peek; its row keeps the focus.
      event.preventDefault();
      focusRow(item.threadId);
      onPeek(false);
    }
  };

  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    onPeek(pressedSelected.current ? !peekOpen : true);
  };

  if (items.length === 0) {
    return (
      <div ref={listRef} className={css.List}>
        <Text className={css.Empty} size="T300">
          {t('featureUi.quickCapture.list.empty')}
        </Text>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="list"
      className={css.List}
      aria-label={t('featureUi.quickCapture.list.label', { room: roomName })}
      onFocus={(event) => {
        lastFocused.current = event.target;
        onZone(event.target === replyRef.current ? 'reply' : 'list');
      }}
      onBlur={(event) => {
        // The focus went elsewhere on purpose; to nowhere, the list moved or removed its element.
        if (event.relatedTarget) lastFocused.current = null;
      }}
    >
      {items.map((item, index) => {
        const isSelected = item.threadId === selected?.threadId;
        const peekShown = isSelected && peekOpen;
        const peekId = `${baseId}-peek`;
        const answer = item.replyText ?? item.line;
        const line = item.line
          ? `${item.lineSender ? `${item.lineSender}: ` : ''}${item.line}`
          : t('featureUi.quickCapture.list.sent');
        return (
          <div key={item.threadId} role="listitem" className={css.Item}>
            <div
              ref={(element) => {
                if (element) rows.current.set(item.threadId, element);
                else rows.current.delete(item.threadId);
              }}
              role="button"
              tabIndex={item.threadId === tabStopId ? 0 : -1}
              data-capture-row=""
              aria-expanded={peekShown}
              aria-controls={peekShown ? peekId : undefined}
              className={classNames(css.Row, item.resolved && css.Resolved)}
              onFocus={() => setSelectedId(item.threadId)}
              onMouseDown={(event) => {
                pressedSelected.current = isFocused(event.currentTarget);
              }}
              onClick={onRowClick}
              onKeyDown={(event) => onRowKeyDown(event, item, index)}
            >
              <div className={css.RowText}>
                <Text className={css.RowTitle} size="T300" truncate {...ownDirectionLine}>
                  {item.title}
                </Text>
                <Text className={css.Muted} size="T200" truncate {...ownDirectionLine}>
                  {line}
                </Text>
              </div>
              {item.resolved && (
                <span className={classNames(css.RowChip, css.Muted)}>
                  {t('featureUi.quickCapture.list.resolved')}
                </span>
              )}
              {item.chip && (
                <span className={classNames(css.RowChip, css.Chip[item.chip])}>
                  {t(CHIP_TEXT[item.chip])}
                </span>
              )}
            </div>
            {rowError?.threadId === item.threadId && (
              <Text className={css.RowError} size="T200" role="alert">
                {captureErrorText(t, rowError.code)}
              </Text>
            )}
            {peekShown && (
              <div id={peekId} className={css.Peek}>
                {answer !== '' && (
                  <Text className={css.Answer} size="T300" {...ownDirectionBlock}>
                    {item.lineSender && <b>{item.lineSender} </b>}
                    <span>{revealDirectionControls(answer)}</span>
                  </Text>
                )}
                <div className={css.PeekActions}>
                  {answer !== '' && (
                    <PeekButton keyCap="c" onClick={() => void copy(item)}>
                      {copiedId === item.threadId
                        ? t('featureUi.quickCapture.peek.copied')
                        : t('featureUi.quickCapture.peek.copy')}
                    </PeekButton>
                  )}
                  <PeekButton keyCap="↵" disabled={isPending(item)} onClick={() => void open(item)}>
                    {t('featureUi.quickCapture.peek.open')}
                  </PeekButton>
                  <PeekButton
                    keyCap="x"
                    disabled={isPending(item)}
                    onClick={() => void resolve(item)}
                  >
                    {item.resolved
                      ? t('featureUi.quickCapture.peek.reopen')
                      : t('featureUi.quickCapture.peek.done')}
                  </PeekButton>
                </div>
                {!isPending(item) && (
                  <input
                    ref={replyRef}
                    className={css.TextField}
                    aria-label={t('featureUi.quickCapture.peek.reply')}
                    placeholder={t('featureUi.quickCapture.peek.reply')}
                    dir="auto"
                    value={draft.threadId === item.threadId ? draft.text : ''}
                    readOnly={replying}
                    onChange={(event) =>
                      setDraft({ threadId: item.threadId, text: event.target.value })
                    }
                    onKeyDown={(event) => onReplyKeyDown(event, item)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type PeekButtonProps = {
  keyCap: string;
  disabled?: boolean;
  onClick: () => void;
  children: string;
};

function PeekButton({ keyCap, disabled, onClick, children }: PeekButtonProps) {
  return (
    <Button
      size="300"
      radii="300"
      variant="Secondary"
      fill="Soft"
      disabled={disabled}
      onClick={onClick}
      after={
        <kbd className={css.Key} dir="ltr" aria-hidden="true">
          {keyCap}
        </kbd>
      }
    >
      <Text size="B300">{children}</Text>
    </Button>
  );
}
