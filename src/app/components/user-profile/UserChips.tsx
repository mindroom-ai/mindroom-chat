import React, { MouseEventHandler, ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Chip, Icon, Icons, PopOut, type RectCords, Text, config } from 'folds';
import { Menu, MenuItem } from '../glass/GlassPrimitives';
import { copyToClipboard } from '../../utils/dom';
import { stopPropagation } from '../../utils/keyboard';
import { getMatrixToUser } from '../../plugins/matrix-to';

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

type ChipMenuProps = {
  anchor: RectCords | undefined;
  requestClose: () => void;
  children: ReactNode;
  menu: ReactNode;
};

/** A chip that opens a small menu of actions below it. */
function ChipMenu({ anchor, requestClose, children, menu }: ChipMenuProps) {



















          </Menu>
        </FocusTrap>
      }
    >
      {children}
    </PopOut>
  );
}

function ChipMenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <MenuItem size="300" radii="300" onClick={onClick}>
      <Text size="B300">{children}</Text>
    </MenuItem>
  );
}

/** The user's homeserver, with actions to copy it or open it in the browser. */



  const [copied, showCopied] = useCopiedFeedback();

  const open: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setAnchor(evt.currentTarget.getBoundingClientRect());
  };
  const close = () => setAnchor(undefined);

  const copyServer = async () => {
    close();
    if (await copyToClipboard(server)) showCopied();
  };
  const openInBrowser = () => {
    close();
    window.open(`https://${server}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <ChipMenu
      anchor={anchor}
      requestClose={close}
      menu={
        <>
          <ChipMenuItem onClick={copyServer}>{t('sharedUi.userChips.copyServer')}</ChipMenuItem>
          <ChipMenuItem onClick={openInBrowser}>
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
        onClick={open}
      >
        <Text size="B300" truncate>
          {server}
        </Text>
      </Chip>
    </ChipMenu>
  );
}

/** Copies the user's ID or matrix.to link. */



  const [copied, showCopied] = useCopiedFeedback();

  const open: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setAnchor(evt.currentTarget.getBoundingClientRect());
  };
  const close = () => setAnchor(undefined);

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
          <ChipMenuItem onClick={() => copy(userId)}>
            {t('sharedUi.userChips.copyUserId')}
          </ChipMenuItem>
          <ChipMenuItem onClick={() => copy(getMatrixToUser(userId))}>
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
        onClick={open}
      >
        <Text size="B300">
          {copied ? t('sharedUi.userChips.copied') : t('sharedUi.userChips.share')}
        </Text>
      </Chip>
    </ChipMenu>
  );
}
