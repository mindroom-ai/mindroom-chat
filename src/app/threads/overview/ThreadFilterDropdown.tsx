import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { IconChevronDown } from '@tabler/icons-react';
import { Checkbox, Text } from 'folds';
import { Surface } from '../../ui/glass/GlassPrimitives';
import * as overviewCss from './RoomThreadOverview.css';
import * as css from './ThreadFilterDropdown.css';

/** The data attribute of one part of the `name` dropdown: `data-<name>-filter-<part>`. */
const dataPart = (name: string, part: string, value: string | number = 'true') => ({
  [`data-${name}-filter-${part}`]: value,
});

/** One checkable row of a filter dropdown. */
export type ThreadFilterOption = {
  id: string;
  checked: boolean;
  /** Checked to hide the threads it matches rather than to keep them. */
  excluded?: boolean;
  /** How many of the room's threads it matches; 0 shows no number. */
  count: number;
  /** What the row shows after its checkbox: a picture or color, the name, labels. */
  content: ReactNode;
};

export type ThreadFilterPanelProps = {
  /** Names the panel's data attributes: `data-<name>-filter-panel`, `-search`, `-list`, `-clear`. */
  name: string;
  /** The data attribute that carries each row's ID, such as `data-tag-option`. */
  optionAttribute: string;
  label: string;
  searchLabel: string;
  noMatchLabel: string;
  /** The rows that match the search, in list order. Called only while the panel is open. */
  options: (query: string) => ThreadFilterOption[];
  onToggle: (id: string) => void;
  /** Unchecks every row; without it, while nothing is chosen, there is no Clear button. */
  onClear?: () => void;
};

/**
 * A filter dropdown's panel: a search field over a checkbox per row, and Clear while something is
 * chosen. The arrow keys walk the search field, the rows and Clear; Enter toggles a row as Space
 * does; Escape empties the search before the dropdown closes.
 */
export function ThreadFilterPanel({
  name,
  optionAttribute,
  label,
  searchLabel,
  noMatchLabel,
  options,
  onToggle,
  onClear,
}: ThreadFilterPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const shiftRef = useRef(0);
  // The panel opens to search; the trigger takes focus back when it closes. Without scrolling:
  // a panel wider than the room's free space would shift the room sideways.
  useEffect(() => searchRef.current?.focus({ preventScroll: true }), []);

  // A panel that would overhang the filter bar (on a phone, or under a trigger near the bar's
  // end) moves back inside it, as far as the bar's left edge allows.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const bar = panel?.parentElement?.closest('[role="toolbar"]')?.getBoundingClientRect();
    if (!panel || !bar) return;
    const box = panel.getBoundingClientRect();
    const start = box.left - shiftRef.current;
    const end = box.right - shiftRef.current;
    let shift = end > bar.right ? bar.right - end : 0;
    if (start + shift < bar.left) shift = bar.left - start;
    if (shift === shiftRef.current) return;
    shiftRef.current = shift;
    panel.style.translate = shift ? `${shift}px` : '';
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && target instanceof HTMLInputElement && target.type === 'checkbox') {
      event.preventDefault();
      target.click();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const stops = [...(panelRef.current?.querySelectorAll<HTMLElement>('input, button') ?? [])];
    const at = stops.indexOf(target);
    if (at < 0) return;
    event.preventDefault();
    const next = stops[(at + (event.key === 'ArrowDown' ? 1 : -1) + stops.length) % stops.length];
    next?.focus({ preventScroll: true });
    // Scroll only the list, for the same reason the search field opens without scrolling.
    const list = listRef.current;
    const row = next?.closest('label');
    if (!list || !row) return;
    const shown = list.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    if (box.top < shown.top) list.scrollTop -= shown.top - box.top;
    else if (box.bottom > shown.bottom) list.scrollTop += box.bottom - shown.bottom;
  };

  const rows = options(query);
  return (
    <Surface
      ref={panelRef}
      level="overlay"
      variant="SurfaceVariant"
      className={classNames(overviewCss.PresetDropdown, css.Panel)}
      role="dialog"
      aria-label={label}
      onKeyDown={handleKeyDown}
      {...dataPart(name, 'panel')}
    >
      <input
        ref={searchRef}
        className={css.Search}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Escape first clears the search, then closes the panel.
          if (event.key === 'Escape' && query) {
            event.stopPropagation();
            setQuery('');
          }
        }}
        placeholder={searchLabel}
        aria-label={searchLabel}
        {...dataPart(name, 'search')}
      />
      <div
        ref={listRef}
        className={css.List}
        // A press on a row keeps the focus where it is, so the panel does not close on blur.
        onMouseDown={(event) => event.preventDefault()}
        {...dataPart(name, 'list')}
      >
        {rows.map((option) => (
          <label key={option.id} className={css.Option} {...{ [optionAttribute]: option.id }}>
            <Checkbox
              variant={option.excluded ? 'Critical' : 'Primary'}
              size="200"
              checked={option.checked}
              // folds leaves onChange out of its Checkbox type; the click toggles the choice.
              readOnly
              onClick={() => onToggle(option.id)}
            />
            {option.content}
            {option.count > 0 && (
              <Text as="span" size="T200" className={css.OptionCount} aria-hidden="true">
                {option.count}
              </Text>
            )}
          </label>
        ))}
        {rows.length === 0 && (
          <Text size="T200" className={css.Empty}>
            {noMatchLabel}
          </Text>
        )}
      </div>
      {onClear && (
        // Like the rows, a press here keeps the focus (Safari would drop it and close the panel).
        <div className={css.Footer} onMouseDown={(event) => event.preventDefault()}>
          <button
            type="button"
            className={css.Clear}
            onClick={() => {
              // The button leaves with the choice; the search keeps the focus in the panel.
              searchRef.current?.focus({ preventScroll: true });
              onClear();
            }}
            {...dataPart(name, 'clear')}
          >
            {t('thread.filters.clear')}
          </button>
        </div>
      )}
    </Surface>
  );
}

export type ThreadFilterDropdownProps = {
  /** Names the trigger's data attributes: `data-<name>-filter-button` and `-count`. */
  name: string;
  label: string;
  /** Shown in place of the label and the count: the one chosen value, such as a tag. */
  value?: string;
  /** How many values are chosen; the trigger is highlighted while any are. */
  count: number;
  ariaLabel: string;
  /** The panel (ThreadFilterPanel), mounted only while the dropdown is open. */
  children: ReactNode;
};

/** A dropdown of the thread filter bar, such as People or Tags: its trigger and open state. */
export function ThreadFilterDropdown({
  name,
  label,
  value,
  count,
  ariaLabel,
  children,
}: ThreadFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleBlur = (event: FocusEvent) => {
    if (!containerRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className={overviewCss.PresetContainer}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={classNames(overviewCss.PresetButton, count > 0 && css.TriggerActive)}
        // While open, a press keeps the focus in the panel: Safari focuses no button, so the
        // panel would lose the focus to nothing and close, and the click would open it again.
        onMouseDown={(event) => {
          if (open) event.preventDefault();
        }}
        onClick={() => {
          // Closing hands the focus to the button, as Escape does.
          if (open) triggerRef.current?.focus();
          setOpen(!open);
        }}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        {...dataPart(name, 'button')}
        {...dataPart(name, 'count', count)}
      >
        {value === undefined ? (
          <>
            <Text size="T200">{label}</Text>
            {count > 0 && (
              <Text size="T200" className={css.Count}>
                {count}
              </Text>
            )}
          </>
        ) : (
          <Text size="T200" truncate className={css.TriggerValue}>
            {value}
          </Text>
        )}
        <IconChevronDown size={14} stroke={1.8} aria-hidden="true" />
      </button>
      {open && children}
    </div>
  );
}
