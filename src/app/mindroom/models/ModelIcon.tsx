import React, { useState } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../utils/matrix';
import { ProviderModelIcon } from './ProviderModelIcon';
import * as css from './ModelPicker.css';

type ModelIconProps = {
  provider?: string;
  id?: string;
  /** A custom icon the runtime publishes for the model, as an `mxc://` URI. */
  iconUrl?: string;
  size: number;
  className?: string;
};

/**
 * A model's icon: its custom icon from Matrix media when it has one, else the provider's mark.
 * A custom icon that fails to load falls back to the provider's mark.
 */
export function ModelIcon({ provider, id, iconUrl, size, className }: ModelIconProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  // Remembers the URL that failed, so a different icon URL gets its own attempt.
  const [failedUrl, setFailedUrl] = useState<string>();
  // Thumbnails at twice the drawn size stay sharp on high-density screens.
  const src = iconUrl?.startsWith('mxc://')
    ? mxcUrlToHttp(mx, iconUrl, useAuthentication, size * 2, size * 2, 'scale') ?? undefined
    : undefined;

  if (src && failedUrl !== src) {
    return (
      <img
        className={className ? `${css.IconImage} ${className}` : css.IconImage}
        src={src}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailedUrl(src)}
      />
    );
  }
  return <ProviderModelIcon provider={provider} id={id} size={size} className={className} />;
}
