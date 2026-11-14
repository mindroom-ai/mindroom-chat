import { useState } from 'react';
import { Chip, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { copyToClipboard } from '../lib/dom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { invitationText, invitationUrl } from './invites';

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
 * send: where to sign in, with which provider, and with exactly which address. Where it cannot
 * be copied, the line is shown to select by hand.
 */
export function CopyInvitation({ email, providers, showText = false }: CopyInvitationProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  // Undefined until a copy was tried; copyToClipboard resolves false when every clipboard failed.
  const [copied, setCopied] = useState<boolean>();
  const mx = useMatrixClient();
  const listed = useOptionalClientConfig()?.homeserverList;
  const server = { name: mx.getDomain() ?? '', baseUrl: mx.baseUrl };
  const url = invitationUrl(server, listed);
  const line = invitationText(t, language, { url, providers, email });
  const label = copied ? t('messageCodeBlock.copied') : t('serverAccounts.invites.copy');

  return (
    <>
      <Chip
        type="button"
        radii="Pill"
        variant="Secondary"
        // One of these stands beside every address, so its name says which.
        aria-label={`${label}: ${email}`}
        data-copy-invitation={email}
        onClick={() => void copyToClipboard(line).then(setCopied)}
      >
        <Text size="T200">{label}</Text>
      </Chip>
      {(showText || copied === false) && (
        <Text className="selectable" size="T200" priority="300" style={{ flexBasis: '100%' }}>
          {line}
        </Text>
      )}
    </>
  );
}
