import { ChangeEvent, KeyboardEvent, ReactNode, useEffect, useId, useState } from 'react';
import { Box, Icon, Icons, Input, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import type { SettingsSearchResult } from './settingsSearch';
import { SettingsSearchField, SettingsSearchLocation } from './frame.css';

/** How far ↑ and ↓ move through the results. */
const STEPS: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

type SettingsSearchProps = {
  query: string;
  onQueryChange: (query: string) => void;
  results: SettingsSearchResult[];
  onChoose: (result: SettingsSearchResult) => void;
  /** The menu, shown while the field is empty. */
  children: ReactNode;
};

/**
 * The search field over the settings menu. While it holds text the menu gives way to the
 * matching settings, each with the page it lives on. The field keeps focus: ↑ and ↓ move through
 * the results, Enter opens one, and Escape empties the field (and closes the dialog once empty).
 */
export function SettingsSearch({
  query,
  onQueryChange,
  results,
  onChoose,
  children,
}: SettingsSearchProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [active, setActive] = useState(0);
  const searching = query.trim() !== '';
  const optionId = (index: number) => `${listId}-${index}`;
  const shownActive = Math.min(active, results.length - 1);

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
      <div id={listId} role="listbox" aria-label={t('commandPalette.resultsLabel')}>
        {results.map((result, index) => (
          <MenuItem
            key={result.setting.id}
            id={optionId(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === shownActive}
            radii="500"
            variant={index === shownActive ? 'SurfaceVariant' : 'Background'}
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

  return (
    <>
      <Box className={SettingsSearchField}>
        <Input
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={searching}
          aria-controls={searching ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            searching && results.length > 0 ? optionId(shownActive) : undefined
          }
          type="search"
          autoComplete="off"
          spellCheck={false}
          variant="Background"
          size="400"
          radii="400"
          before={<Icon size="50" src={Icons.Search} />}
          style={{ flexGrow: 1 }}
        />
      </Box>
      {list}
    </>
  );
}
