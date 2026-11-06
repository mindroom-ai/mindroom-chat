import React, { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Text, config, type RectCords } from 'folds';
import { PopOut } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { isValidTagName, normalizeTagName } from '../../event-store/threads/threadTags';
import * as css from '../ThreadContextBanner.css';

type ThreadTagPickerProps = {
  /** Tags used elsewhere in the room, offered as suggestions. */
  availableTags: string[];
  onAddTag: (tagName: string) => void;
  disabled?: boolean;
};

// A dashed outline of the tag pills beside it: the same type size, an empty slot to fill. Text
// and outline share the muted text colour, so the control reads as a placeholder. A pixel taller
// than the pills (19.7 px), as in the original, which sets the banner's tag row height.
const addButtonStyle: React.CSSProperties = {
  padding: '0 0.4rem',
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px dashed currentColor',
  borderRadius: '0.5rem',
  background: 'none',
  color: 'inherit',
  opacity: 0.6,
  font: 'inherit',
  fontSize: '0.65rem',
  lineHeight: 1.7,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** The "+ tag" control: a filterable list of the room's tags that also creates new ones. */
export function ThreadTagPicker({ availableTags, onAddTag, disabled }: ThreadTagPickerProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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
        aria-label={t('mindroomUi.threads.threadTagPicker.addTag')}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        disabled={disabled}
        onClick={handleOpen}
      >
        {t('mindroomUi.threads.threadTagPicker.tag')}
      </button>
      <PopOut
        anchor={anchor}
        position="Bottom"
        align="Start"
        offset={4}
        content={
          <FocusTrap
            focusTrapOptions={{
              // The trap focuses the field once it is active. Focusing it on mount instead
              // loses the focus inside a dialog, whose own trap is still active then and pulls
              // the focus back into the dialog.
              initialFocus: () => inputRef.current ?? false,
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
            <Menu role="none" style={{ minWidth: '12rem', maxWidth: '16rem' }}>
              <div className={css.TagPickerInputContainer}>
                <input
                  ref={inputRef}
                  className={css.TagPickerInput}
                  aria-label={t('mindroomUi.threads.threadTagPicker.filterOrCreateTag')}
                  placeholder={t('mindroomUi.threads.threadTagPicker.filterNew')}
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
                      {t('mindroomUi.threads.threadTagPicker.createTag', { tag: normalizedQuery })}
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
                    {normalizedQuery
                      ? t('mindroomUi.threads.threadTagPicker.noMatches')
                      : t('mindroomUi.threads.threadTagPicker.typeToCreateATag')}
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
