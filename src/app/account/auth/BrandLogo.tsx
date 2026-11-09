import { useState } from 'react';
import classNames from 'classnames';
import { ThemeKind, useTheme } from '../../theme/useTheme';
import { MINDROOM_LOGO_ALT, MINDROOM_LOGO_SRC } from '../../ui/branding/branding';
import { useDeploymentBranding } from '../../ui/branding/deploymentBranding';
import * as css from './styles.css';

/**
 * The deployment's logo in the sign-in card's header: its dark variant in dark themes, and
 * MindRoom's own when none is configured or the configured image fails to load.
 */
export function BrandLogo({ className }: { className: string }) {
  const { logo } = useDeploymentBranding();
  const dark = useTheme().kind === ThemeKind.Dark;
  const src = dark ? logo.srcDark : logo.src;
  const [failedSrc, setFailedSrc] = useState<string>();

  if (!logo.custom || failedSrc === src) {
    return <img className={className} src={MINDROOM_LOGO_SRC} alt={MINDROOM_LOGO_ALT} />;
  }
  return (
    <img
      className={classNames(className, css.AuthLogoCustom)}
      src={src}
      alt={logo.alt}
      // The image may come from another host, which then learns nothing of the page's address.
      referrerPolicy="no-referrer"
      onError={() => {
        console.warn(`[branding] the logo ${src} did not load; showing the default logo.`);
        setFailedSrc(src);
      }}
    />
  );
}
