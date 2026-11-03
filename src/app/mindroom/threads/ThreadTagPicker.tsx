import React, { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Menu, MenuItem, PopOut, Text, color, config, type RectCords } from 'folds';
import { isValidTagName, normalizeTagName } from './threadTags';
import * as css from './ThreadContextBanner.css';

export type ThreadTagPickerProps = {
  /** Tags used elsewhere in the room, offered as suggestions. */
  availableTags: string[];
  onAddTag: (tagName: string) => void;
  disabled?: boolean;
};

const addButtonStyle: React.CSSProperties = {



  border: `1px dashed ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: '0.5rem',
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  fontSize: '0.65rem',
  lineHeight: 1.6,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** The "+ tag" control: a filterable list of the room's tags that also creates new ones. */
export function ThreadTagPicker({ availableTags, onAddTag, disabled }: ThreadTagPickerProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const [query, setQuery] = useState('');

  const close = () => {
    setAnchor(undefined);
    setQuery('');
  };

  const normalizedQuery = normalizeTagName(query);
  const suggestions = useMemo(
    () =>
      normalizedQuery
        ? availableTags.filter((tag) => tag.includes(normalizedQuery))
        : availableTags,
    [availableTags, normalizedQuery]
  );
  const canCreate = isValidTagName(normalizedQuery) && !availableTags.includes(normalizedQuery);

  const choose = (tagName: string) => {
    onAddTag(tagName);
    close();
  };

  const handleOpen = (evt: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    setAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  };

  const handleKeyDown = (evt: KeyboardEvent<HTMLInputElement>) => {
    if (evt.key !== 'Enter') return;
    evt.preventDefault();
    if (canCreate) choose(normalizedQuery);
    else if (suggestions[0]) choose(suggestions[0]);
  };

  return (
    <>
      <button
        type="button"
        style={addButtonStyle}
        aria-label={t('thread.tagPicker.add')}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        disabled={disabled}
        onClick={handleOpen}
      >
        {t('thread.tagPicker.trigger')}
      </button>
      <PopOut
        anchor={anchor}
        position="Bottom"
        align="Start"
        offset={4}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              clickOutsideDeactivates: () => {
                close();
                return true;
              },
              escapeDeactivates: () => {
                close();
                return true;
              },
            }}
          >
            <Menu style={{ minWidth: '12rem', maxWidth: '16rem' }}>
              <div className={css.TagPickerInputContainer}>
                <input
                  // The popover opens from a click; focus the field so typing works at once.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  className={css.TagPickerInput}
                  aria-label={t('thread.tagPicker.filterLabel')}
                  placeholder={t('thread.tagPicker.placeholder')}
                  value={query}
                  maxLength={50}
                  onChange={(evt) => setQuery(evt.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <Box direction="Column" style={{ padding: config.space.S100 }}>
                {canCreate && (
                  <MenuItem size="300" radii="300" onClick={() => choose(normalizedQuery)}>
                    <Text size="T300" truncate>
                      {t('thread.tagPicker.create', { name: normalizedQuery })}
                    </Text>
                  </MenuItem>
                )}
                {suggestions.map((tag) => (
                  <MenuItem key={tag} size="300" radii="300" onClick={() => choose(tag)}>
                    <Text size="T300" truncate>
                      {tag}
                    </Text>
                  </MenuItem>
                ))}
                {!canCreate && suggestions.length === 0 && (
                  <Text size="T200" priority="300" style={{ padding: config.space.S200 }}>
                    {t('thread.tagPicker.empty')}
                  </Text>
                )}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
