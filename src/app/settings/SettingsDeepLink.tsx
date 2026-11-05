import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useNavigate, useParams } from 'react-router-dom';
import { settingsModalAtom } from '../navigation/settingsModal';
import { HOME_PATH } from '../routes/paths';
import { isSettingsPageRequest } from '../preferences/settingsRegistry';

/**
 * `/settings/<page>`: opens the Settings dialog on that page, by its id or an earlier one such
 * as `general` or `devices`, over Home. An unknown page opens the dialog where it opens anyway.
 */
export function SettingsDeepLink() {
  const { page } = useParams();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const navigate = useNavigate();

  useEffect(() => {
    setSettingsModal({ initialPage: isSettingsPageRequest(page) ? page : undefined });
    navigate(HOME_PATH, { replace: true });
  }, [navigate, page, setSettingsModal]);

  return null;
}
