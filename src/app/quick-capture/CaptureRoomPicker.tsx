import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { isComposingKey } from '../shortcuts/shortcuts';
import { ownDirectionLine } from '../ui/directional';
import type { CaptureClient } from './captureChannel';
import { captureKeyAction } from './captureKeys';
import type { CaptureErrorCode, CaptureRoom } from './captureProtocol';
import { filterCaptureRooms } from './captureRooms';
import { captureErrorText } from './CaptureInput';
import * as css from './QuickCapturePage.css';

/** `#` before a room's name, `@` before a direct chat's. */
export const roomSigil = (room: Pick<CaptureRoom, 'direct'>): string => (room.direct ? '@' : '#');

type CaptureRoomPickerProps = {
  rooms: CaptureRoom[];
  roomId: string | null;
  request: CaptureClient['request'];
  apple: boolean;
  fieldRef: RefObject<HTMLInputElement>;
  onFocus: () => void;
  onPicked: () => void;
};

/**
 * Where entries go: a search over the rooms the host lists, most recently active first. The
 * arrows move, Enter or a click picks, and the host stores the pick as the default room.
 */
export function CaptureRoomPicker({
  rooms,
  roomId,
  request,
  apple,
  fieldRef,
  onFocus,
  onPicked,
}: CaptureRoomPickerProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const [query, setQuery] = useState('');
  /** The highlighted room; none for the first row. */
  const [activeId, setActiveId] = useState<string>();
  const [error, setError] = useState<CaptureErrorCode>();
  const picking = useRef(false);
  const shown = useMemo(() => filterCaptureRooms(rooms, query.trim()), [rooms, query]);
  // The highlight stays on its room while a new state sorts the rooms again by activity; a room
  // that leaves the rows gives it to the first.
  const found = shown.findIndex((room) => room.id === activeId);
  const activeIndex = found >= 0 || shown.length === 0 ? found : 0;
  const optionId = (index: number) => `${baseId}-${index}`;

  // The field keeps the focus, so the browser scrolls nothing: the highlighted room is brought
  // into view here, or Enter could pick a room scrolled out of sight.
  useLayoutEffect(() => {
    document.getElementById(`${baseId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [baseId, activeIndex]);

  const pick = async (room: CaptureRoom | undefined) => {
    if (!room || picking.current) return;
    picking.current = true;
    setError(undefined);
    const result = await request({ kind: 'selectRoom', roomId: room.id });
    picking.current = false;
    if (result.ok) onPicked();
    else setError(result.error);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event.nativeEvent)) return;
    const context = { inputEmpty: false, caretOnLastLine: false, firstRow: false, apple };
    const action = captureKeyAction(event, { ...context, zone: 'picker' });
    // Escape goes on to the page, which closes the picker.
    if (!action || action.kind === 'escape') return;
    event.preventDefault();
    if (action.kind === 'move') {
      const next = Math.max(0, Math.min(shown.length - 1, activeIndex + action.by));
      setActiveId(shown[next]?.id);
    } else if (action.kind === 'pick') void pick(shown[activeIndex]);
  };

  return (
    <>
      <div className={css.Search}>
        <Icon size="100" src={Icons.Search} />
        <input
          ref={fieldRef}
          className={css.SearchField}
          role="combobox"
          aria-label={t('featureUi.quickCapture.room.search')}
          placeholder={t('featureUi.quickCapture.room.search')}
          aria-expanded
          aria-controls={`${baseId}-rooms`}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(undefined);
          }}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
        />
      </div>
      {error && (
        <p className={css.PickerError} role="alert">
          {captureErrorText(t, error)}
        </p>
      )}
      <div className={css.List}>
        <div
          id={`${baseId}-rooms`}
          role="listbox"
          aria-label={t('featureUi.quickCapture.room.choose')}
        >
          {shown.map((room, index) => (
            // The field keeps the focus and takes the keys; a click only picks.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <div
              key={room.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              className={css.Option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void pick(room)}
            >
              <span className={css.Sigil}>{roomSigil(room)}</span>
              <span className={css.OptionName} {...ownDirectionLine}>
                {room.name}
              </span>
              {room.id === roomId && (
                <Icon size="100" src={Icons.Check} className={css.OptionCurrent} />
              )}
            </div>
          ))}
        </div>
        {shown.length === 0 && <p className={css.Empty}>{t('featureUi.quickCapture.room.none')}</p>}
      </div>
    </>
  );
}
