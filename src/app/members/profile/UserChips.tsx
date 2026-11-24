import { MouseEventHandler, ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FocusTrap, type FocusTrapProps } from 'focus-trap-react';
import { Chip, Icon, Icons, type RectCords, Text, config } from 'folds';
import { PopOut } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { copyToClipboard } from '../../lib/dom';
import { externalOpenProps, isDesktopApp } from '../../lib/nativeShell';
import { stopPropagation } from '../../lib/keyboard';
import { getMatrixToUser } from '../../matrix/matrix-to';

const COPIED_FEEDBACK_MS = 2000;

/** True for a moment after `show()`, for "copied" feedback. */
const useCopiedFeedback = (): [boolean, () => void] => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timeout = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [copied]);
  return [copied, () => setCopied(true)];
};

/** Where a chip's menu opens: below the chip that was clicked, until `close`. */
const useMenuAnchor = () => {
  const [anchor, setAnchor] = useState<RectCords>();
  const openMenu: MouseEventHandler<HTMLElement> = (evt) =>
    setAnchor(evt.currentTarget.getBoundingClientRect());
  const close = () => setAnchor(undefined);
  return { anchor, openMenu, close };
};

type TrapOptions = NonNullable<FocusTrapProps['focusTrapOptions']>;

// A click outside or Escape closes the menu; Escape does not reach handlers behind it.
const DISMISSIBLE = { clickOutsideDeactivates: true, escapeDeactivates: stopPropagation };

type ChipMenuProps = {
  anchor: RectCords | undefined;
  requestClose: () => void;
  children: ReactNode;
  menu: ReactNode;
};

/** A chip that opens a small menu of actions below it. */
function ChipMenu({ anchor, requestClose, children, menu }: ChipMenuProps) {
  const trapOptions: TrapOptions = {
    ...DISMISSIBLE,
    initialFocus: false,
    onDeactivate: requestClose,
  };
  return (
    <PopOut
      anchor={anchor}
      position="Bottom"
      align="Start"
      offset={4}
      content={
        <FocusTrap focusTrapOptions={trapOptions}>
          <Menu role="menu" style={{ display: 'grid', padding: config.space.S100 }}>
            {menu}
          </Menu>
        </FocusTrap>
      }
    >
      {children}
    </PopOut>
  );
}

function ChipMenuItem({
  onClick,
  children,
  ...props
}: {
  onClick: () => void;
  children: ReactNode;
  'data-open-external'?: string;
}) {
  return (
    <MenuItem size="300" radii="300" role="menuitem" onClick={onClick} {...props}>
      <Text size="B300">{children}</Text>
    </MenuItem>
  );
}

type ServerChipProps = { server: string };

/** The user's homeserver, with actions to copy it or open it in the browser. */
export function ServerChip({ server }: ServerChipProps) {
  const { t } = useTranslation();
  const { anchor, openMenu, close } = useMenuAnchor();
  const [copied, showCopied] = useCopiedFeedback();

  const copyServer = async () => {
    close();
    if (await copyToClipboard(server)) showCopied();
  };
  const serverUrl = `https://${server}`;
  const openInBrowser = () => {
    close();
    if (!isDesktopApp()) window.open(serverUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <ChipMenu
      anchor={anchor}
      requestClose={close}
      menu={
        <>
          <ChipMenuItem onClick={() => void copyServer()}>
            {t('sharedUi.userChips.copyServer')}
          </ChipMenuItem>
          <ChipMenuItem onClick={openInBrowser} {...externalOpenProps(serverUrl)}>
            {t('sharedUi.userChips.openInBrowser')}
          </ChipMenuItem>
        </>
      }
    >
      <Chip
        variant={copied ? 'Success' : 'SurfaceVariant'}
        radii="Pill"
        aria-pressed={!!anchor}
        before={<Icon size="50" src={copied ? Icons.Check : Icons.Server} />}
        onClick={openMenu}
      >
        <Text size="B300" truncate>
          {server}
        </Text>
      </Chip>
    </ChipMenu>
  );
}

type ShareChipProps = { userId: string };

/** Copies the user's ID or matrix.to link. */
export function ShareChip({ userId }: ShareChipProps) {
  const { t } = useTranslation();
  const { anchor, openMenu, close } = useMenuAnchor();
  const [copied, showCopied] = useCopiedFeedback();

  const copy = async (text: string) => {
    close();
    if (await copyToClipboard(text)) showCopied();
  };

  return (
    <ChipMenu
      anchor={anchor}
      requestClose={close}
      menu={
        <>
          <ChipMenuItem onClick={() => void copy(userId)}>
            {t('sharedUi.userChips.copyUserId')}
          </ChipMenuItem>
          <ChipMenuItem onClick={() => void copy(getMatrixToUser(userId))}>
            {t('sharedUi.userChips.copyUserLink')}
          </ChipMenuItem>
        </>
      }
    >
      <Chip
        variant={copied ? 'Success' : 'SurfaceVariant'}
        radii="Pill"
        aria-pressed={!!anchor}
        before={<Icon size="50" src={Icons.Link} />}
        onClick={openMenu}
      >
        <Text size="B300">{t('sharedUi.userChips.share')}</Text>
      </Chip>
    </ChipMenu>
  );
}
