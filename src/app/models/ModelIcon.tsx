import { useAvatarImage } from '../avatars/useAvatarImage';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/matrix';
import { ProviderModelIcon, iconSizeStyle } from '../ui/ProviderModelIcon';
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
  // Thumbnails at twice the drawn size stay sharp on high-density screens.
  const src = iconUrl?.startsWith('mxc://')
    ? (mxcUrlToHttp(mx, iconUrl, useAuthentication, size * 2, size * 2, 'scale') ?? undefined)
    : undefined;
  const { imageSrc, onImageError } = useAvatarImage(src, mx);

  if (imageSrc) {
    return (
      <img
        className={className ? `${css.IconImage} ${className}` : css.IconImage}
        src={imageSrc}
        width={size}
        height={size}
        style={iconSizeStyle(size)}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={onImageError}
      />
    );
  }
  return <ProviderModelIcon provider={provider} id={id} size={size} className={className} />;
}
