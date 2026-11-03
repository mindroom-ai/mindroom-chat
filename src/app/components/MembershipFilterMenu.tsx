import React, { MouseEventHandler, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Box, Icon, Icons, PopOut, type RectCords, Text, config } from 'folds';
import { IconButton, Menu, MenuItem } from './glass/GlassPrimitives';
import { MembershipFilter, type MembershipFilterItem } from '../hooks/useMemberFilter';
import { stopPropagation } from '../utils/keyboard';

type MembershipFilterMenuProps = {
  items: MembershipFilterItem[];
  /** Index of the selected filter in `items`. */
  selected: number;
  onSelect: (index: number) => void;
};

// Banned members read as a warning, as elsewhere in moderation.
const toMenuVariant = (item: MembershipFilterItem) =>
  item.filterFn === MembershipFilter.filterBanned ? 'Critical' : 'Surface';

/** Picks which members a list shows (joined, invited, banned, ...) from a small menu. */
export function MembershipFilterMenu({ items, selected, onSelect }: MembershipFilterMenuProps) {
  const [anchor, setAnchor] = useState<RectCords>();
  const selectedName = items[selected]?.name ?? items[0]?.name;

  const open: MouseEventHandler<HTMLButtonElement> = (evt) =>
    setAnchor(evt.currentTarget.getBoundingClientRect());
  const close = () => setAnchor(undefined);

  return (
    <PopOut




















                  role="menuitemradio"
                  aria-checked={index === selected}
                  size="300"
                  radii="300"
                  variant={toMenuVariant(item)}
                  fill={index === selected ? 'Soft' : 'None'}
                  after={index === selected ? <Icon size="50" src={Icons.Check} /> : undefined}
                  onClick={() => {
                    close();
                    onSelect(index);
                  }}
                >
                  <Text size="T300" style={{ flexGrow: 1 }}>
                    {item.name}
                  </Text>
                </MenuItem>
              ))}
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <IconButton
        size="300"
        radii="300"
        variant="Background"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={selectedName}
        onClick={open}
      >
        <Icon size="50" src={anchor ? Icons.ChevronTop : Icons.ChevronBottom} />
      </IconButton>
    </PopOut>
  );
}
