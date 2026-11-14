import { useState } from 'react';
import { Button, Chip, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { copyToClipboard } from '../lib/dom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import * as css from './Invites.css';
import { invitationText, invitationUrl } from './invites';

type CopyInvitationProps = {
  /** The invited address, as the server stores it. */
  email: string;
  /** The names of the providers the homeserver signs people in with. */
  providers: readonly string[];
  /** Shows the line in a panel with a Copy button, for an invite that was just made. */
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
  const url = invitationUrl(mx.getDomain() ?? '', useOptionalClientConfig()?.hashRouter);
  const line = invitationText(t, language, { url, providers, email });
  const label = copied ? t('messageCodeBlock.copied') : t('serverAccounts.invites.copy');

  const copy = () => void copyToClipboard(line).then(setCopied);

  if (showText) {
    return (
      <div className={css.Invitation} data-invitation={email}>
        <Text
          className="selectable"
          size="T300"
          style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}
        >
          {line}
        </Text>
        <Button
          type="button"
          size="300"
          variant="Primary"
          radii="300"
          aria-label={`${label}: ${email}`}
          data-copy-invitation={email}
          onClick={copy}
        >
          <Text size="B300">{label}</Text>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Chip
        type="button"
        radii="Pill"
        variant="Secondary"
        // One of these stands beside every address, so its name says which.
        aria-label={`${label}: ${email}`}
        data-copy-invitation={email}
        onClick={copy}
      >
        <Text size="T200">{label}</Text>
      </Chip>
      {copied === false && (
        <Text
          className="selectable"
          size="T200"
          priority="300"
          style={{ flexBasis: '100%', overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}
        >
          {line}
        </Text>
      )}
    </>
  );
}
