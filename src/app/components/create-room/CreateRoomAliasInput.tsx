import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';

type CreateRoomAliasInputProps = {
  disabled?: boolean;
};

/** The local part of a public room's address; the form reads it as `aliasInput`. */
export function CreateRoomAliasInput({ disabled }: CreateRoomAliasInputProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const server = mx.getDomain();

  return (
    <Input
      name="aliasInput"
      variant="SurfaceVariant"
      size="500"
      radii="400"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      aria-label={t('sharedUi.createRoomAliasInput.addressOptional')}
      before={<Text size="T300">#</Text>}
      after={server ? <Text size="T300" priority="300">{`:${server}`}</Text> : undefined}
    />
  );
}
