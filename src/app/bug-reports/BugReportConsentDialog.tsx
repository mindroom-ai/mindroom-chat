import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Checkbox, Text, color } from 'folds';
import { ActionDialog } from '../ui/ActionDialog';

const CONTENTS = [
  'mindroomUi.messages.bugReport.contentsMessages',
  'mindroomUi.messages.bugReport.contentsAccount',
  'mindroomUi.messages.bugReport.contentsDevice',
  'mindroomUi.messages.bugReport.contentsDiagnostics',
] as const;

/**
 * What a bug report holds and who reads it, before anything is uploaded. The report room is not
 * end-to-end encrypted, so from an encrypted room the report leaves message text out unless the
 * person includes it, after a warning.
 */
export function BugReportConsentDialog({
  encrypted,
  onSend,
  onClose,
}: {
  encrypted: boolean;
  onSend: (includeText: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [includeText, setIncludeText] = useState(false);
  return (
    <ActionDialog
      label={t('mindroomUi.messages.bugReport.consentTitle')}
      onClose={onClose}
      busy={false}
    >
      <Text size="T300">{t('mindroomUi.messages.bugReport.consentIntro')}</Text>
      <Box
        as="ul"
        direction="Column"
        gap="100"
        style={{ marginBlock: 0, paddingInlineStart: '1.25rem' }}
      >
        {CONTENTS.map((key) => (
          <Text as="li" size="T300" key={key}>
            {t(key)}
          </Text>
        ))}
      </Box>
      {encrypted && (
        <>
          <Text size="T300">{t('mindroomUi.messages.bugReport.encryptedTextLeftOut')}</Text>
          <Box as="label" alignItems="Center" gap="200">
            <Checkbox
              variant="Critical"
              size="200"
              checked={includeText}
              // folds leaves onChange out of its Checkbox type; the click toggles the choice.
              readOnly
              onClick={() => setIncludeText((included) => !included)}
            />
            <Text size="T300">{t('mindroomUi.messages.bugReport.includeText')}</Text>
          </Box>
          {includeText && (
            <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
              {t('mindroomUi.messages.bugReport.includeTextWarning')}
            </Text>
          )}
        </>
      )}
      <Box justifyContent="End" gap="200">
        <Button type="button" size="300" variant="Secondary" fill="Soft" onClick={onClose}>
          <Text size="B300">{t('threadActions.cancel')}</Text>
        </Button>
        <Button type="button" size="300" variant="Primary" onClick={() => onSend(includeText)}>
          <Text size="B300">{t('mindroomUi.messages.bugReport.send')}</Text>
        </Button>
      </Box>
    </ActionDialog>
  );
}
