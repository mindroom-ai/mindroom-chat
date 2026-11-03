import React, { MouseEventHandler, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Button, Chip, config, Icon, Icons, PopOut, type RectCords, Text, toRem } from 'folds';
import { Menu } from '../glass/GlassPrimitives';
import { SettingTile } from '../setting-tile';
import { SequenceCard } from '../sequence-card';

type RoomVersionSelectorProps = {
  versions: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/** Picks the room version for a new room from the versions the homeserver offers. */
export function RoomVersionSelector({
  versions,
  value,
  onChange,
  disabled,
}: RoomVersionSelectorProps) {



















































                          fill={version === value ? 'Solid' : 'Soft'}
                          aria-pressed={version === value}




















              after={<Icon size="50" src={menuAnchor ? Icons.ChevronTop : Icons.ChevronBottom} />}
              onClick={handleMenu}
            >
              <Text as="span" size="B300">
                {value}
              </Text>
            </Chip>
          </PopOut>
        }
      />
    </SequenceCard>
  );
}
