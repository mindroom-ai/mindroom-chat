import { Line } from 'folds';
import { useTranslation } from 'react-i18next';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { MacAppIcon } from '../../native/MacAppIcon';
import { useMacAppDownloadUrl, useOffersMacApp } from '../../native/macApp';

/**
 * Home's menu entry that downloads the Mac app, at the end of the menu after a line, where the
 * deployment offers the app (`macApp.offer`) and this is a browser on a Mac. It stays after the account answered the offer of the app (shell/MacAppOffer.tsx).
 */
export function MacAppMenuEntry({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const offered = useOffersMacApp();
  const downloadUrl = useMacAppDownloadUrl(offered);
  if (!offered) return null;
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
            window.open(downloadUrl, '_blank', 'noopener,noreferrer');
          }}
        />
      </MenuGroup>
    </>
  );
}
