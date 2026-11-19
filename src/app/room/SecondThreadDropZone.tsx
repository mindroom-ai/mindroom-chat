import { type DragEvent, useEffect, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { getLocalStorageItem } from '../lib/state/atomWithLocalStorage';
import { isThreadDrag, readThreadDragData } from '../navigation/secondThread';
import { useThreadDrag } from './useThreadDrag';
import * as css from './SecondThreadDropZone.css';

/** The second column's width until it is resized (`SecondThreadPanel`). */
const DEFAULT_WIDTH = 480;

const storedWidth = (key: string): number => {
  const value = getLocalStorageItem<unknown>(key, undefined);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_WIDTH;
};

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
  const dragging = useThreadDrag();
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!dragging) setOver(false);
  }, [dragging]);
  if (!dragging) return null;

  // A thread's drag may drop here (its default prevented), and moves its thread.
  const accept = (evt: DragEvent<HTMLDivElement>) => {
    if (!isThreadDrag(evt.dataTransfer)) return;
    evt.preventDefault();
    // eslint-disable-next-line no-param-reassign -- how a drop target says what the drop does
    evt.dataTransfer.dropEffect = 'move';
    setOver(true);
  };
  return (
    <div
      className={css.DropZone}
      style={{ width: storedWidth(widthKey) }}
      data-over={over || undefined}
      data-testid="second-thread-drop-zone"
      aria-hidden="true"
      onDragEnter={accept}
      onDragOver={accept}
      onDragLeave={(evt) => {
        if (!evt.currentTarget.contains(evt.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(evt) => {
        const thread = readThreadDragData(evt.dataTransfer);
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
