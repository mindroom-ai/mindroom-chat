import React, { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Input, Text, color } from 'folds';
import { normalizePairCode } from './devicePairing';

type PairCodeFormProps = {
  /** The code to start with, as the user or a link gave it. */
  defaultValue?: string;
  inputId?: string;
  /** Called with the code in its canonical `ABCD-EFGH` form. */
  onSubmit: (code: string) => void;
};

/** The field for the eight-character code `mindroom connect` shows in the terminal. */
export function PairCodeForm({ defaultValue = '', inputId, onSubmit }: PairCodeFormProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const [invalid, setInvalid] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = normalizePairCode(value);
    if (!code) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSubmit(code);
  };

  return (
    <Box as="form" direction="Column" gap="200" onSubmit={handleSubmit}>
      <Box gap="200" alignItems="Center">
        <Box grow="Yes">
          <Input
            id={inputId}
            size="400"
            variant="Background"
            radii="300"
            outlined
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD-EFGH"
            aria-label={t('mindroomUi.local-mindroom.localMindroom.pairCode')}
            aria-invalid={invalid || undefined}
            value={value}
            onChange={(event: { currentTarget: { value: string } }) => {
              setValue(event.currentTarget.value);
              setInvalid(false);
            }}
          />
        </Box>
        <Button type="submit" variant="Primary" size="400" radii="300">
          <Text size="B400">{t('mindroomUi.local-mindroom.connect.continue')}</Text>
        </Button>
      </Box>
      {invalid && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('mindroomUi.local-mindroom.connect.invalidCode')}
        </Text>
      )}
    </Box>
  );
}
