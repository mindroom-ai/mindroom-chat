import React from 'react';
import { Icon, IconButton, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';

export type PhoneBackButtonProps = {
  /** The section list this page was opened from. */
  to: string;
};

/**
 * Leads a page header on phones, where a section's list and its pages take turns on screen: the
 * arrow returns to the list. Wider screens show both side by side, so it renders nothing there.
 */
export function PhoneBackButton({ to }: PhoneBackButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  if (!phone) return null;
  return (
    <IconButton
      size="400"
      radii="300"
      variant="Surface"
      fill="None"
      aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.back')}
      onClick={() => navigate(to)}
      style={{ flexShrink: 0 }}
    >
      <Icon size="400" src={Icons.ArrowLeft} />
    </IconButton>
  );
}
