import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconSrc, Icons, Text, color, config } from 'folds';
import { CreateRoomAccess } from './types';

type AccessOption = {
  access: CreateRoomAccess;
  icon: IconSrc;
  label: ReactNode;
  hint: ReactNode;
};

type CreateRoomAccessSelectorProps = {
  value: CreateRoomAccess;
  onSelect: (access: CreateRoomAccess) => void;
  /** Offer "space members" access; only rooms created inside a space can have it. */
  canRestrict?: boolean;
  disabled?: boolean;
};

/** Who may join a new room: invited people, members of the parent space, or anyone. */
export function CreateRoomAccessSelector(props: CreateRoomAccessSelectorProps) {
  const { value, onSelect, canRestrict = false, disabled = false } = props;
  const { t } = useTranslation();

  const options: AccessOption[] = [
    {
      access: CreateRoomAccess.Private,
      icon: Icons.HashLock,
      label: t('sharedUi.createRoomAccessSelector.private'),
      hint: t('sharedUi.createRoomAccessSelector.onlyPeopleWithInviteCanJoin'),
    },
    ...(canRestrict
      ? [
          {
            access: CreateRoomAccess.Restricted,
            icon: Icons.Space,
            label: t('sharedUi.createRoomAccessSelector.restricted'),
            hint: t('sharedUi.createRoomAccessSelector.onlyMemberOfParentSpaceCanJoin'),
          },
        ]
      : []),
    {
      access: CreateRoomAccess.Public,
      icon: Icons.HashGlobe,
      label: t('sharedUi.createRoomAccessSelector.public'),
      hint: t('sharedUi.createRoomAccessSelector.anyoneWithTheAddressCanJoin'),
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
              alignItems: 'center',
              gap: config.space.S300,
              padding: `${config.space.S300} ${config.space.S400}`,
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
              <Text size="H6">{option.label}</Text>
              <Text size="T300" priority="300">
                {option.hint}
              </Text>
            </Box>
            {selected && <Icon size="100" src={Icons.Check} />}
          </button>
        );
      })}
    </Box>
  );
}
