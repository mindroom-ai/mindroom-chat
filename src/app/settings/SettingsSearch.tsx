import {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Box, Icon, Icons, Input, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '../ui/glass/GlassPrimitives';
import { PageNavContent, PageNavHeader } from '../ui/page/Page';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import {
  fieldStateOf,
  formatShortcut,
  isComposingKey,
  matchesShortcut,
} from '../shortcuts/shortcuts';
import { shortcutAttributes } from '../shortcuts/ShortcutKeys';
import type { SettingsSearchResult } from './settingsSearchIndex';
import {
  SettingsMenuRow,
  SettingsSearchHeader,
  SettingsSearchKey,
  SettingsSearchLocation,
  SettingsSearchResults,
} from '../ui/settings/frame.css';

/** How far ↑ and ↓ move through the results. */
const STEPS: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };
const FIELD_GROW = { flexGrow: 1 };

type SettingsSearchProps = {
  query: string;
  onQueryChange: (query: string) => void;
  results: SettingsSearchResult[];
  onChoose: (result: SettingsSearchResult) => void;
  /** Rows over the search field, such as the dialog's title on a phone. */
  title?: ReactNode;
  /** The field shows the `/` key that focuses it; phones have no keyboard to press it on. */
  keyHint: boolean;
  /** The menu, shown while the field is empty. */
  children: ReactNode;
};

/**
 * `/` focuses the field while the key would type nothing: nothing that takes text has the focus,
 * and the key lands in the dialog or on the page itself rather than in a menu or dialog over it.
 */
const useSlashFocus = (field: RefObject<HTMLInputElement>) =>
  useKeyDown(
    window,
    useCallback(
      (event: globalThis.KeyboardEvent) => {
        const input = field.current;
        if (!input || event.defaultPrevented || isComposingKey(event)) return;
        if (!matchesShortcut(event, 'settingsSearch')) return;
        if (fieldStateOf(event.target) !== 'none') return;
        const { target } = event;
        const dialog = input.closest('[role="dialog"]');
        const onPage = target === document.body || target === document.documentElement;
        if (!onPage && !(target instanceof Node && dialog?.contains(target))) return;
        event.preventDefault();
        input.focus();
      },
      [field]
    )
  );

/**
 * The search field over the settings menu, which the menu scrolls beneath. While it holds text the
 * menu gives way to the matching settings, each with the page it lives on. The field keeps focus:
 * ↑ and ↓ move through the results, Enter opens one, and Escape empties the field (and closes the
 * dialog once empty). `/` elsewhere in the dialog moves focus here.
 */
export function SettingsSearch({
  query,
  onQueryChange,
  results,
  onChoose,
  title,
  keyHint,
  children,
}: SettingsSearchProps) {
  const { t } = useTranslation();
  const listId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const searching = query.trim() !== '';
  const optionId = (index: number) => `${listId}-${index}`;
  const shownActive = Math.min(active, results.length - 1);
  useSlashFocus(fieldRef);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (searching)
      document.getElementById(optionId(shownActive))?.scrollIntoView({ block: 'nearest' });
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = STEPS[event.key];
    const chosen = results[shownActive];
    if (step !== undefined && results.length > 0) {
      event.preventDefault();
      setActive((shownActive + step + results.length) % results.length);
    } else if (event.key === 'Enter' && chosen) {
      event.preventDefault();
      onChoose(chosen);
    } else if (event.key === 'Escape' && query !== '') {
      // Handled here, so the dialog's focus trap leaves the dialog open.
      event.preventDefault();
      onQueryChange('');
    }
  };

  const placeholder = t('featureUi.settings.search.placeholder');
  let list: ReactNode = children;
  if (searching && results.length === 0) {
    list = (
      <Box style={{ padding: config.space.S300 }}>
        <Text size="T300" priority="300" role="status">
          {t('commandPalette.noResults')}
        </Text>
      </Box>
    );
  } else if (searching) {
    list = (
      <div
        id={listId}
        role="listbox"
        className={SettingsSearchResults}
        aria-label={t('commandPalette.resultsLabel')}
      >
        {results.map((result, index) => (
          <MenuItem
            key={result.setting.id}
            id={optionId(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === shownActive}
            radii="400"
            variant="Background"
            className={SettingsMenuRow}
            onMouseMove={() => setActive(index)}
            onClick={() => onChoose(result)}
          >
            <Box direction="Column" style={{ minWidth: 0, paddingBlock: config.space.S100 }}>
              <Text size="T300" truncate>
                {result.label}
              </Text>
              <Text size="T200" priority="300" className={SettingsSearchLocation} truncate>
                {result.location.join(' › ')}
              </Text>
            </Box>
          </MenuItem>
        ))}
      </div>
    );
  }

  // The key that focuses the field, while the field is empty and a keyboard is likely.
  const keyCap = keyHint && query === '' && (
    <kbd className={SettingsSearchKey} aria-hidden="true">
      {formatShortcut('settingsSearch')}
    </kbd>
  );
  // Under a phone's title bar the field is that bar's second row, not a header of its own.
  const field = (
    <PageNavHeader as={title ? 'div' : 'header'} outlined={false} className={SettingsSearchHeader}>
      <Input
        ref={fieldRef}
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={searching}
        aria-controls={searching ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={searching && results.length > 0 ? optionId(shownActive) : undefined}
        {...shortcutAttributes(keyHint ? 'settingsSearch' : undefined)}
        type="search"
        autoComplete="off"
        spellCheck={false}
        variant="Background"
        size="300"
        radii="400"
        before={<Icon size="50" src={Icons.Search} />}
        after={keyCap}
        style={FIELD_GROW}
      />
    </PageNavHeader>
  );
  const pinned = (
    <>
      {title}
      {field}
    </>
  );
  return <PageNavContent header={pinned}>{list}</PageNavContent>;
}
