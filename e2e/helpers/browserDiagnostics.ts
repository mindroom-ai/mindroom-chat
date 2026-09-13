import { expect, Page } from '@playwright/test';

type BrowserDiagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
};

const CRITICAL_DIAGNOSTIC_PATTERNS = [
  /Unexpected Application Error!/i,
  /MatrixClient not initialized/i,
  /Maximum update depth/i,
  /the account in the store doesn't match/i,
  /Cannot access .* before initialization/i,
];

const matchesPatterns = (value: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(value));

export const attachBrowserDiagnostics = (page: Page): BrowserDiagnostics => {
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    diagnostics.requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`);
  });

  return diagnostics;
};

export const expectNoUnexpectedBrowserDiagnostics = async (
  diagnostics: BrowserDiagnostics,
  label: string
) => {
  const criticalConsoleErrors = diagnostics.consoleErrors.filter((message) =>
    matchesPatterns(message, CRITICAL_DIAGNOSTIC_PATTERNS)
  );
  const criticalPageErrors = diagnostics.pageErrors.filter((message) =>
    matchesPatterns(message, CRITICAL_DIAGNOSTIC_PATTERNS)
  );
  const criticalRequestFailures = diagnostics.requestFailures.filter((message) =>
    matchesPatterns(message, CRITICAL_DIAGNOSTIC_PATTERNS)
  );

  // Keep a concise summary in the test output so live runs can be reviewed quickly.
  // eslint-disable-next-line no-console
  console.log(
    `[diag:${label}] consoleErrors=${diagnostics.consoleErrors.length} pageErrors=${diagnostics.pageErrors.length} requestFailures=${diagnostics.requestFailures.length}`
  );

  await expect(
    {
      criticalConsoleErrors,
      criticalPageErrors,
      criticalRequestFailures,
    },
    `Unexpected browser diagnostics during ${label}`
  ).toEqual({
    criticalConsoleErrors: [],
    criticalPageErrors: [],
    criticalRequestFailures: [],
  });
};
