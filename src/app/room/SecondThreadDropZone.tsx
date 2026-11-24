import { type DragEvent as ReactDragEvent, useEffect, useRef, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { getLocalStorageItem } from '../lib/state/atomWithLocalStorage';
import { CONVERSATION_MIN_WIDTH, MIN_WIDTH } from '../ui/panels/ResizablePanel';
import { readThreadDragData, THREAD_DRAG_TYPE } from '../navigation/secondThread';
import { useThreadDrag } from './useThreadDrag';
import { SECOND_THREAD_DEFAULT_WIDTH } from './threadLayout';
import * as css from './SecondThreadDropZone.css';

const storedWidth = (key: string): number => {
  const value = getLocalStorageItem<unknown>(key, undefined);
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : SECOND_THREAD_DEFAULT_WIDTH;
};
/**
 * As the column itself (ResizablePanel), the zone leaves the conversation its minimum in the row
 * it lies over (PanelRow), however wide the column was stored on a wider row.
 */
const ZONE_MAX_WIDTH = `max(min(${MIN_WIDTH}px, 100%), 100% - ${CONVERSATION_MIN_WIDTH}px)`;

/**
 * While a thread card is dragged on the room page, the place along the room's end edge where the
 * second column shows (or would): dropping the card there opens its thread in that column
 * (`onOpen`), in place of the one it shows. A mouse's affordance, hidden from screen readers: the
 * card's menu (Open in second column) is the way for the keyboard.
 */
export function SecondThreadDropZone({
  widthKey,
  onOpen,
}: {
  /** Where the second column keeps its width (`secondThreadWidthStorageKey`). */
  widthKey: string;
  onOpen: (roomId: string, rootId: string) => void;
}) {
  const { t } = useTranslation();
  const drag = useThreadDrag();
  const [over, setOver] = useState(false);
  // Whether the drag may drop here: not one picked up where the zone then showed, until it is
  // anywhere off the zone, so a card's end under the zone does not open in it on a twitch.
  const armed = useRef<boolean>(undefined);
  const zoneRef = useRef<HTMLDivElement>(null);
  const onZone = (x: number, y: number) => {
    const box = zoneRef.current?.getBoundingClientRect();
    return !!box && x > box.left && x < box.right && y > box.top && y < box.bottom;
  };
  useEffect(() => {
    armed.current = undefined;
    if (!drag) {
      setOver(false);
      return undefined;
    }
    const moved = (evt: DragEvent) => {
      if (!zoneRef.current?.contains(evt.target as Node | null)) armed.current = true;
    };
    // One step off the zone may bring only an enter where it lands, no move over it.
    window.addEventListener('dragenter', moved);
    window.addEventListener('dragover', moved);
    return () => {
      window.removeEventListener('dragenter', moved);
      window.removeEventListener('dragover', moved);
    };
  }, [drag]);
  if (!drag) return null;

  // The thread's drag may drop here (its default prevented), and moves its thread. The zone shows
  // for that drag, which shows its type or none at all: the Mac app's WebKit shows none before the
  // drop. Other types alone are another drag's, come in while the page missed the thread's end.
  const other = ({ dataTransfer: { types } }: ReactDragEvent<HTMLDivElement>) =>
    types.length > 0 && !types.includes(THREAD_DRAG_TYPE);
  const accept = (evt: ReactDragEvent<HTMLDivElement>) => {
    if (other(evt)) return;
    armed.current ??= !onZone(drag.x, drag.y);
    if (!armed.current) return;
    evt.preventDefault();
    // eslint-disable-next-line no-param-reassign -- how a drop target says what the drop does
    evt.dataTransfer.dropEffect = 'move';
    setOver(true);
  };
  return (
    <div
      ref={zoneRef}
      className={css.DropZone}
      style={{ width: storedWidth(widthKey), maxWidth: ZONE_MAX_WIDTH }}
      data-over={over || undefined}
      data-testid="second-thread-drop-zone"
      aria-hidden="true"
      onDragEnter={accept}
      onDragOver={accept}
      onDragLeave={(evt) => {
        if (evt.currentTarget.contains(evt.relatedTarget as Node | null)) return;
        armed.current = true;
        setOver(false);
      }}
      onDrop={(evt) => {
        if (!armed.current || other(evt)) return;
        // A drag that shows its type names its thread, one from another window too; only the Mac
        // app's, which shows none, takes the thread the page read as it started.
        const thread = evt.dataTransfer.types.includes(THREAD_DRAG_TYPE)
          ? readThreadDragData(evt.dataTransfer)
          : drag;
        if (!thread) return;
        evt.preventDefault();
        onOpen(thread.roomId, thread.rootId);
      }}
    >
      <div className={css.DropArea}>
        <Icon className={css.DropIcon} src={Icons.ThreadPlus} />
        <Text size="T400">{t('thread.dropSecond')}</Text>
      </div>
    </div>
  );
}
