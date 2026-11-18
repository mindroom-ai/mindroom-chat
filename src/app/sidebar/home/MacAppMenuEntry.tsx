import { Line } from 'folds';
import { useTranslation } from 'react-i18next';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { MacAppIcon } from '../../native/MacAppIcon';
import { MAC_APP_DOWNLOAD_URL, useOffersMacApp } from '../../native/macApp';

/**
 * Home's menu entry that downloads the Mac app, at the end of the menu after a line, where the
 * deployment offers the app (`macApp.offer`) and this is a browser on a Mac. It stays after the account answered the offer of the app (shell/MacAppOffer.tsx).
 */
export function MacAppMenuEntry({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  if (!useOffersMacApp()) return null;
  return (
    <>
      <Line variant="Surface" size="300" />
      <MenuGroup>
        <MenuEntry
          icon={MacAppIcon}
          label={t('featureUi.macApp.menu')}
          data-mac-app-download="menu"
          onSelect={() => {
            onClose();
            window.open(MAC_APP_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
          }}
        />
      </MenuGroup>
    </>
  );
}
