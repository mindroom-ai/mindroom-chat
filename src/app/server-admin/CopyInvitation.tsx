import { useState } from 'react';
import { Chip, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { copyToClipboard } from '../lib/dom';
import { chatUrl, invitationText } from './invites';

type CopyInvitationProps = {
  /** The invited address, as the server stores it. */
  email: string;
  /** The names of the providers the homeserver signs people in with. */
  providers: readonly string[];
  /** Also shows the line, for an invite that was just made. */
  showText?: boolean;
};

/**
 * Copies the line an administrator sends to an invited person, which the homeserver does not
 * send: where to sign in, with which provider, and with exactly which address.
 */
export function CopyInvitation({ email, providers, showText = false }: CopyInvitationProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [copied, setCopied] = useState(false);
  const url = chatUrl();
  if (url === undefined) return null;
  const line = invitationText(t, language, { url, providers, email });

  return (
    <>
      <Chip
        type="button"
        radii="Pill"
        variant="Secondary"
        data-copy-invitation={email}
        // copyToClipboard resolves false when every clipboard path failed.
        onClick={() => void copyToClipboard(line).then(setCopied)}
      >
        <Text size="T200">
          {copied ? t('messageCodeBlock.copied') : t('serverAccounts.invites.copy')}
        </Text>
      </Chip>
      {showText && (
        <Text size="T200" priority="300" style={{ flexBasis: '100%' }}>
          {line}
        </Text>
      )}
    </>
  );
}
