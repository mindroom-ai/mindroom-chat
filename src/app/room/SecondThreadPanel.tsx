import { type CSSProperties, type KeyboardEvent, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { editableActiveElement } from '../lib/dom';
import { ThreadContextBanner } from '../threads/ThreadContextBanner';
import { CONVERSATION_MIN_WIDTH, ResizablePanel } from '../ui/panels/ResizablePanel';
import { ThreadView } from './ThreadView';
import { noteThreadViewKey } from './useRoomEscapeReadReceipts';
import { focusOwnsTyping, isPasteKey, isTypingKey } from './typeToCompose';

/** The thread column's own width, at first. */
const DEFAULT_WIDTH = 480;
const MAX_WIDTH = 4096;
const COLUMN_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  minWidth: 0,
};
// The composer the focus goes back to: the open thread's, else the room's.
const MAIN_COMPOSERS = [
  '[data-testid="thread-column"] [contenteditable="true"]',
  '[data-footer-of="room"] [contenteditable="true"]',
];

/**
 * A second thread (B) beside the one the room page shows, in a side panel of its own: its banner
 * with a Close button, its timeline and its composer. Typing on no field in it goes to its composer,
 * and Escape in it marks it read. Closing it with the focus in it takes the focus to the main
 * composer.
 */
export function SecondThreadPanel({
  room,
  threadId,
  onClose,
  widthKey,
}: {
  room: Room;
  threadId: string;
  onClose: () => void;
  widthKey: string;
}) {
  const { t } = useTranslation();
  const columnRef = useRef<HTMLDivElement>(null);
  const focusComposer = useRef<() => void>();

  const close = useCallback(() => {
    const doc = columnRef.current?.ownerDocument;
    const focusInside = !!doc && !!columnRef.current?.contains(doc.activeElement);
    onClose();
    if (!focusInside) return;
    MAIN_COMPOSERS.map((selector) => doc.querySelector<HTMLElement>(selector))
      .find(Boolean)
      ?.focus();
  }, [onClose]);

  const handleKeyDown = (evt: KeyboardEvent<HTMLDivElement>) => {
    noteThreadViewKey(evt, threadId);
    if (evt.defaultPrevented || !(isTypingKey(evt.nativeEvent) || isPasteKey(evt.nativeEvent))) {
      return;
    }
    if (editableActiveElement() || focusOwnsTyping()) return;
    focusComposer.current?.();
  };

  return (
    <ResizablePanel
      side="end"
      storageKey={widthKey}
      defaultWidth={DEFAULT_WIDTH}
      minContentWidth={CONVERSATION_MIN_WIDTH}
      maxPanelWidth={MAX_WIDTH}
      resizeLabel={t('thread.resizeSecond')}
      collapseLabel={t('thread.close')}
      onCollapse={close}
      testId="second-thread-panel"
      onKeyDown={handleKeyDown}
    >
      <div ref={columnRef} style={COLUMN_STYLE}>
        <ThreadView
          key={threadId}
          room={room}
          threadId={threadId}
          header={
            <ThreadContextBanner
              room={room}
              threadId={threadId}
              onExitThread={close}
              onClose={close}
            />
          }
          autoFocus
          focusRef={focusComposer}
          onThreadLoadError={close}
          fileDropContainerRef={columnRef}
        />
      </div>
    </ResizablePanel>
  );
}
