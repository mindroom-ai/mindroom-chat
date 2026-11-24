import { ComponentPropsWithRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, Input } from 'folds';

type PasswordInputProps = Omit<ComponentPropsWithRef<typeof Input>, 'type' | 'after'>;

/** A password field with a button that shows or hides what was typed. */
export function PasswordInput({ size = '400', ref, ...props }: PasswordInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...props}
      ref={ref}
      type={visible ? 'text' : 'password'}
      size={size}
      autoComplete={props.autoComplete ?? 'current-password'}
      after={
        <IconButton
          type="button"
          variant={props.variant}
          size="300"
          radii="300"
          aria-label={visible ? t('sharedUi.passwordInput.hide') : t('sharedUi.passwordInput.show')}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon size="100" src={visible ? Icons.EyeBlind : Icons.Eye} />
        </IconButton>
      }
    />
  );
}
