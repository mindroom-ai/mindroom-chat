import React from 'react';
import { Box, Text } from 'folds';
import * as css from './styles.css';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MINDROOM_AUTH_BRANDING } from '../../mindroom/auth/authUi';

export function AuthFooter() {
  const { auth } = useClientConfig();

  const optionalLinks = [
    auth?.supportUrl ? { label: 'Support', href: auth.supportUrl } : undefined,
    auth?.privacyPolicyUrl ? { label: 'Privacy', href: auth.privacyPolicyUrl } : undefined,
    auth?.termsUrl ? { label: 'Terms', href: auth.termsUrl } : undefined,
  ].filter((item): item is { label: string; href: string } => Boolean(item));

  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      <Text size="T300">
        Powered by{' '}
        <a href={MINDROOM_AUTH_BRANDING.chatSourceUrl} target="_blank" rel="noreferrer">
          {MINDROOM_AUTH_BRANDING.appName}
        </a>
        ,{' '}
        <a href="https://matrix.org" target="_blank" rel="noreferrer">
          Matrix
        </a>
        ,{' '}
        <a href="https://github.com/ajbura/cinny" target="_blank" rel="noreferrer">
          Cinny
        </a>
      </Text>
      {optionalLinks.map((link) => (
        <Text key={link.label} size="T300">
          <a href={link.href} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        </Text>
      ))}
    </Box>
  );
}
