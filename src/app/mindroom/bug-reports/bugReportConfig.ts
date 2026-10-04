import type { AutoDiscoveryInfo } from '../../cs-api';
import { isUserId } from '../../utils/matrix';

export const BUG_REPORTS_WELL_KNOWN_KEY = 'io.mindroom.bug_reports';

/** Administrators that receive bug reports, from the homeserver's client well-known. */
export const getBugReportAdmins = (info: AutoDiscoveryInfo | null | undefined): string[] => {
  const section = info?.[BUG_REPORTS_WELL_KNOWN_KEY];
  if (!section || typeof section !== 'object' || Array.isArray(section)) return [];
  const { admins } = section as { admins?: unknown };
  if (!Array.isArray(admins)) return [];
  return [
    ...new Set(
      admins.filter((admin): admin is string => typeof admin === 'string' && isUserId(admin))
    ),
  ];
};
