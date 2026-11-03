import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconSrc, Icons, Text, color, config } from 'folds';
import { CreateRoomAccess } from './types';

type AccessOption = {



  description: ReactNode;
};

type CreateRoomAccessSelectorProps = {
  value: CreateRoomAccess;
  onSelect: (access: CreateRoomAccess) => void;
  /** Offer "space members" access; only rooms created inside a space can have it. */
  canRestrict?: boolean;
  disabled?: boolean;
};

/** Who may join a new room: invited people, members of the parent space, or anyone. */







  const options: AccessOption[] = [
    {
      access: CreateRoomAccess.Private,
      icon: Icons.HashLock,
      title: t('sharedUi.createRoomAccess.private'),
      description: t('sharedUi.createRoomAccess.privateDescription'),
    },
    ...(canRestrict
      ? [
          {
            access: CreateRoomAccess.Restricted,
            icon: Icons.Space,
            title: t('sharedUi.createRoomAccess.restricted'),
            description: t('sharedUi.createRoomAccess.restrictedDescription'),
          },
        ]
      : []),
    {
      access: CreateRoomAccess.Public,
      icon: Icons.HashGlobe,
      title: t('sharedUi.createRoomAccess.public'),
      description: t('sharedUi.createRoomAccess.publicDescription'),
    },
  ];

  return (
    <Box direction="Column" gap="100" role="radiogroup">
      {options.map((option) => {
        const selected = option.access === value;
        return (
          <button
            key={option.access}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onSelect(option.access)}
            style={{
              display: 'flex',



              textAlign: 'start',
              font: 'inherit',
              color: 'inherit',
              cursor: disabled ? 'default' : 'pointer',
              borderRadius: config.radii.R400,
              border: `${config.borderWidth.B300} solid ${
                selected ? color.Primary.Main : color.SurfaceVariant.ContainerLine
              }`,
              backgroundColor: selected ? color.Primary.Container : color.SurfaceVariant.Container,
            }}
          >
            <Icon size="200" src={option.icon} filled={selected} />
            <Box grow="Yes" direction="Column" gap="100">
              <Text size="H6">{option.title}</Text>
              <Text size="T300" priority="300">
                {option.description}
              </Text>
            </Box>
            {selected && <Icon size="100" src={Icons.Check} />}
          </button>
        );
      })}
    </Box>
  );
}
