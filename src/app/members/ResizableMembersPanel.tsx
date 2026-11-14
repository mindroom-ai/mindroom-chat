import { ReactNode } from 'react';
import { Overlay, OverlayBackdrop } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { ResizablePanel } from '../ui/panels/ResizablePanel';
import { usePanelForm } from '../ui/panels/panelPresence';
import { useMembersOverlay } from './PanelRow';
import { PhoneMembersSheet, usePhoneSheetSlot } from './PhoneMembersSheet';
import * as css from './ResizableMembersPanel.css';
import { membersWidthStorageKey } from '../preferences/accountStorageKeys';

export function ResizableMembersPanel({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const userId = useMatrixClient().getSafeUserId();
  // A room too narrow for the panel beside it shows it over the room, as a phone does.
  const overlay = useMembersOverlay();
  // A closing panel keeps its form: one that closes as the window narrows never opens over the room.
  const mobile = usePanelForm(useScreenSizeContext() === ScreenSize.Mobile || overlay);
  const phoneSheetSlot = usePhoneSheetSlot();
  const panel = (
    <ResizablePanel
      side="end"
      storageKey={membersWidthStorageKey(userId)}
      defaultWidth={266}
      minContentWidth={mobile ? 0 : 200}
      resizeLabel={t('mindroomUi.sidebar.resizeMemberPanel')}
      collapseLabel={t('mindroomUi.threads.mindroomRoomViewHeader.hideMembers')}
      onCollapse={onClose}
      testId="resizable-members-panel"
    >
      {children}
    </ResizablePanel>
  );

  if (!mobile) return panel;
  // A phone slides the members in below its top bar, as its navigation drawer.
  if (phoneSheetSlot) {
    return (
      <PhoneMembersSheet slot={phoneSheetSlot} onClose={onClose}>
        {children}
      </PhoneMembersSheet>
    );
  }

  return (
    <Overlay open backdrop={<OverlayBackdrop onClick={onClose} />}>
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          escapeDeactivates: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return false;
          },
        }}
      >
        <div
          className={css.MobileOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.members')}
        >
          {panel}
        </div>
      </FocusTrap>
    </Overlay>
  );
}
