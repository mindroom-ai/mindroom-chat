import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Menu, MenuItem, PopOut, RectCords, Text, config, color } from 'folds';
import FocusTrap from 'focus-trap-react';
import { stopPropagation } from '../../utils/keyboard';
import { isValidTagName, normalizeTagName } from './threadTags';

export interface ThreadTagPickerProps {
  availableTags: string[];
  onAddTag: (name: string) => void;
  disabled?: boolean;
}

const triggerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.65rem',
  fontWeight: 500,
  padding: '0.1rem 0.4rem',
  borderRadius: '0.5rem',
  border: '1px dashed currentColor',
  background: 'none',
  cursor: 'pointer',
  opacity: 0.6,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: `${config.space.S200} ${config.space.S300}`,
  border: 'none',
  outline: 'none',
  fontSize: '0.8rem',
  background: 'transparent',
};

export function ThreadTagPicker({ availableTags, onAddTag, disabled }: ThreadTagPickerProps) {
  const [menuCords, setMenuCords] = useState<RectCords>();
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(
    (evt: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      setMenuCords(evt.currentTarget.getBoundingClientRect());
      setFilter('');
    },
    [disabled]
  );

  const handleClose = useCallback(() => {
    setMenuCords(undefined);
    setFilter('');
  }, []);

  const handleAdd = useCallback(
    (name: string) => {
      if (!isValidTagName(name)) return;
      onAddTag(normalizeTagName(name));
      handleClose();
    },
    [onAddTag, handleClose]
  );

  const handleKeyDown = useCallback(
    (evt: React.KeyboardEvent<HTMLInputElement>) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        handleAdd(filter);
      }
    },
    [filter, handleAdd]
  );

  // Safety net: programmatically focus the input when the menu opens.
  // FocusTrap should handle this via its default "first tabbable element" behavior,
  // but portal rendering can introduce timing edge cases.
  useEffect(() => {
    if (!menuCords) return undefined;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [menuCords]);

  const normalized = normalizeTagName(filter);
  const filtered = availableTags.filter(
    (t) => !normalized || t.toLowerCase().includes(normalized)
  );
  const showCreate =
    normalized.length > 0 &&
    isValidTagName(normalized) &&
    !availableTags.includes(normalized) &&
    !filtered.includes(normalized);

  return (
    <>
      <button
        type="button"
        style={triggerStyle}
        onClick={handleOpen}
        disabled={disabled}
        aria-label="Add tag"
      >
        + tag
      </button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="Start"
        content={
          <FocusTrap
            focusTrapOptions={{
              onDeactivate: handleClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu style={{ minWidth: '12rem', maxWidth: '16rem' }}>
              <Box direction="Column" gap="0">
                <div
                  style={{
                    borderBottom: `1px solid ${color.SurfaceVariant.ContainerLine}`,
                    padding: `0 ${config.space.S100}`,
                  }}
                >
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Filter / new..."
                    style={inputStyle}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                <Box
                  direction="Column"
                  gap="100"
                  style={{
                    padding: config.space.S100,
                    maxHeight: '12rem',
                    overflowY: 'auto',
                  }}
                >
                  {filtered.map((tag) => (
                    <MenuItem
                      key={tag}
                      size="300"
                      variant="Surface"
                      radii="300"
                      onClick={() => handleAdd(tag)}
                    >
                      <Box grow="Yes">
                        <Text size="T300">{tag}</Text>
                      </Box>
                    </MenuItem>
                  ))}
                  {showCreate && (
                    <>
                      {filtered.length > 0 && (
                        <div
                          style={{
                            borderTop: `1px solid ${color.SurfaceVariant.ContainerLine}`,
                            margin: `${config.space.S100} 0`,
                          }}
                        />
                      )}
                      <MenuItem
                        size="300"
                        variant="Surface"
                        radii="300"
                        onClick={() => handleAdd(normalized)}
                      >
                        <Box grow="Yes">
                          <Text size="T300">
                            Create &ldquo;{normalized}&rdquo;
                          </Text>
                        </Box>
                      </MenuItem>
                    </>
                  )}
                  {filtered.length === 0 && !showCreate && (
                    <Box
                      style={{ padding: config.space.S200 }}
                      justifyContent="Center"
                    >
                      <Text size="T200" priority="300">
                        {normalized ? 'No matches' : 'Type to create a tag'}
                      </Text>
                    </Box>
                  )}
                </Box>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
