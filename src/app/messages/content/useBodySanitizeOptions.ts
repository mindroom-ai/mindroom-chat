import { useMemo } from 'react';
import { useOptionalClientConfig } from '../../config/useClientConfig';
import type { SanitizeCustomHtmlOptions } from '../../rich-text/sanitize';

/**
 * The options a message body's HTML is sanitized with (the deployment's extra link schemes), the
 * same object while they stay the same. Everything that reads a body's HTML as it renders, such as
 * where its work folds, sanitizes with these.
 */
export const useBodySanitizeOptions = (): SanitizeCustomHtmlOptions => {
  const schemes = useOptionalClientConfig()?.messageRendering?.additionalAllowedUriSchemes;
  const schemesKey = JSON.stringify(schemes ?? null);
  return useMemo(
    () => ({
      additionalAllowedUriSchemes: (JSON.parse(schemesKey) as string[] | null) ?? undefined,
    }),
    [schemesKey]
  );
};
