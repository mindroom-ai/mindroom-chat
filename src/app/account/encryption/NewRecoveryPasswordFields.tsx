import { CSSProperties, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Text } from 'folds';
import { PasswordInput } from '../../ui/PasswordInput';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { isSecretPasswordLongEnough } from './secretPassword';

// Out of sight but laid out: password managers skip a field with `display: none`.
const UNSEEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

type NewRecoveryPasswordFieldsProps = { disabled: boolean };

/** The recovery password and its confirmation, read back by `readNewRecoveryPassword`. */
export function NewRecoveryPasswordFields({ disabled }: NewRecoveryPasswordFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const userId = useMatrixClient().getSafeUserId();
  return (
    <Box direction="Column" gap="300">
      {/* A new password and its confirmation alone look like a change of the login password, and
          a password manager may offer to overwrite the saved login with them. This username,
          for password managers only, makes the recovery password an entry of its own. */}
      <input
        type="text"
        autoComplete="username"
        value={`${userId} recovery password`}
        readOnly
        aria-hidden
        tabIndex={-1}
        style={UNSEEN}
      />
      <Box gap="100" direction="Column">
        <Text as="label" htmlFor={`${id}-password`} size="L400">
          {t('sharedUi.recoveryPassword.passwordLabel')}
        </Text>
        <PasswordInput
          id={`${id}-password`}
          name="recoveryPasswordInput"
          autoComplete="new-password"
          disabled={disabled}
          size="400"
          variant="Background"
          outlined
        />
      </Box>
      <Box gap="100" direction="Column">
        <Text as="label" htmlFor={`${id}-confirm`} size="L400">
          {t('sharedUi.recoveryPassword.confirmLabel')}
        </Text>
        <PasswordInput
          id={`${id}-confirm`}
          name="recoveryPasswordConfirmInput"
          autoComplete="new-password"
          disabled={disabled}
          size="400"
          variant="Background"
          outlined
        />
      </Box>
      <Text size="T200">{t('sharedUi.recoveryPassword.hint')}</Text>
    </Box>
  );
}

type NewRecoveryPasswordForm = HTMLFormElement & {
  recoveryPasswordInput?: HTMLInputElement;
  recoveryPasswordConfirmInput?: HTMLInputElement;
};

/** The typed password, trimmed, or what is wrong with it. */
export const readNewRecoveryPassword = (
  form: HTMLFormElement
): { password: string } | { error: 'tooShort' | 'mismatch' } => {
  const { recoveryPasswordInput, recoveryPasswordConfirmInput } = form as NewRecoveryPasswordForm;
  const password = recoveryPasswordInput?.value.trim() ?? '';
  const confirmation = recoveryPasswordConfirmInput?.value.trim() ?? '';
  if (!isSecretPasswordLongEnough(password)) return { error: 'tooShort' };
  if (password !== confirmation) return { error: 'mismatch' };
  return { password };
};
