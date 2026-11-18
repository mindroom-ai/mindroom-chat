import { type CSSProperties, type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { editableActiveElement } from '../lib/dom';
import { ThreadContextBanner } from '../threads/ThreadContextBanner';
import { usePanelPresence } from '../ui/panels/panelPresence';
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

/**
 * A second thread (B) beside the one the room page shows, in a side panel of its own: its banner
 * with a Close button, its timeline and its composer. Typing on no field in it goes to its composer,
 * and Escape in it marks it read. It takes the focus with `autoFocus` (an explicit Open beside).
 * Closing, it moves out as an empty shell: the thread's view goes at once, so nothing reads, sends
 * or shows it as seen once it is no longer the room's second thread.
 */
export function SecondThreadPanel({
  room,
  threadId,
  autoFocus,
  onClose,
  widthKey,
}: {
  room: Room;
  threadId: string;
  autoFocus: boolean;
  onClose: () => void;
  widthKey: string;
}) {
  const { t } = useTranslation();
  const columnRef = useRef<HTMLDivElement>(null);
  const focusComposer = useRef<() => void>();
  const closing = usePanelPresence()?.phase === 'exit';

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
      onCollapse={onClose}
      testId="second-thread-panel"
      onKeyDown={handleKeyDown}
    >
      <div ref={columnRef} style={COLUMN_STYLE} role="region" aria-label={t('thread.second')}>
        {!closing && (
          <ThreadView
            key={threadId}
            room={room}
            threadId={threadId}
            header={
              <ThreadContextBanner
                room={room}
                threadId={threadId}
                onExitThread={onClose}
                onClose={onClose}
              />
            }
            autoFocus={autoFocus}
            focusRef={focusComposer}
            onThreadLoadError={onClose}
            fileDropContainerRef={columnRef}
          />
        )}
      </div>
    </ResizablePanel>
  );
}
