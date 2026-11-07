import {
  expect,
  test,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

// A deployment's own branding on the signed-out pages (config.json `branding`, docs/configuration.md
// "Branding"): the logo, its dark variant and the title in the sign-in card's header, the footer's
// text and links, and the page title, on login, register and the pairing page. Desktop 1280x800
// and a 390x844 touch phone, light and dark, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, WebKit. Without the key the pages keep MindRoom Chat's own look, and a
// malformed key falls back to it. Set AUTH_BRANDING_SHOTS=<directory> to save every screen.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const SHOTS = process.env.AUTH_BRANDING_SHOTS;
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const BRAND_HOST = 'https://brand.example.test';

const LAYOUTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
} as const;
const THEMES = ['light', 'dark'] as const;
type Layout = keyof typeof LAYOUTS;
type Theme = (typeof THEMES)[number];

/** A wide 3:1 logo, so the header shows it at its own proportions. */
const logoSvg = (background: string, foreground: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" rx="8" fill="${background}"/><circle cx="20" cy="20" r="10" fill="${foreground}"/><rect x="38" y="14" width="70" height="12" rx="6" fill="${foreground}"/></svg>`;
const LOGOS: Record<string, string> = {
  '/logo-light.svg': logoSvg('#1f4e79', '#ffffff'),
  '/logo-dark.svg': logoSvg('#d9e8f5', '#1f4e79'),
};

const BRANDING = {
  title: 'Example Co',
  logo: {
    src: `${BRAND_HOST}/logo-light.svg`,
    srcDark: `${BRAND_HOST}/logo-dark.svg`,
    alt: 'Example Co logo',
  },
  footer: {
    text: 'Example Co team chat. Ask the help desk for an account.',
    links: [
      { label: 'Imprint', url: 'https://example.test/imprint' },
      { label: 'Help desk', url: 'mailto:help@example.test' },
    ],
  },
};

type Deployment = { name: string; branding?: unknown };

/** A context for one layout and theme whose config.json carries `branding` when given. */
const openContext = async (
  browser: Browser,
  baseURL: string,
  layout: Layout,
  theme: Theme,
  deployment: Deployment
): Promise<BrowserContext> => {
  // Signed out, the app follows the system's light or dark (AppTheme). A service worker would
  // answer config.json itself instead of the route.
  const context = await browser.newContext({
    ...LAYOUTS[layout],
    colorScheme: theme,
    baseURL,
    serviceWorkers: 'block',
  });
  await context.route(`${BRAND_HOST}/**`, (route) => {
    const body = LOGOS[new URL(route.request().url()).pathname];
    return body
      ? route.fulfill({ contentType: 'image/svg+xml', body })
      : route.fulfill({ status: 404 });
  });
  if (deployment.branding !== undefined) {
    await context.route('**/config.json', async (route) => {
      const response = await route.fetch();
      const config = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...config, branding: deployment.branding } });
    });
  }
  return context;
};

/** The card's header: the one with the logo (operator notices above the page have none). */
const header = (page: Page) =>
  page
    .locator('header')
    .filter({ has: page.getByRole('img') })
    .first();

/** The header logo has loaded, sits 28px high, and keeps its proportions up to the width cap. */
const expectLogo = async (page: Page, alt: string, src: RegExp, width: number) => {
  const logo = header(page).getByRole('img', { name: alt, exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', src);
  await expect
    .poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth))
    .toBeGreaterThan(0);
  const box = (await logo.boundingBox())!;
  expect(Math.round(box.height)).toBe(28);
  expect(Math.round(box.width)).toBe(width);
};

/** The title and logo stay inside the header, whatever the width. */
const expectHeaderFits = async (page: Page) => {
  const overflow = await header(page).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('img, h1, p')]
      .map((child) => child.getBoundingClientRect())
      .some((box) => box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5);
  });
  expect(overflow).toBe(false);
};

type Screen = { name: string; path: string; ready: (page: Page) => Promise<void> };

const SCREENS: Screen[] = [
  {
    name: 'login',
    path: `/login/${encodeURIComponent(HOMESERVER)}`,
    ready: (page) => expect(page.locator('input[name="usernameInput"]')).toBeVisible(),
  },
  {
    name: 'register',
    path: `/register/${encodeURIComponent(HOMESERVER)}`,
    ready: (page) =>
      expect(page.getByRole('paragraph').filter({ hasText: /^Register$/ })).toBeVisible(),
  },
];

const shoot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const checkBranded = async (browser: Browser, baseURL: string, browserName: string) => {
  for (const layout of Object.keys(LAYOUTS) as Layout[]) {
    for (const theme of THEMES) {
      /* eslint-disable no-await-in-loop -- one screen after the other. */
      const context = await openContext(browser, baseURL, layout, theme, {
        name: 'branded',
        branding: BRANDING,
      });
      try {
        const page = await context.newPage();
        for (const screen of SCREENS) {
          await page.goto(screen.path);
          await screen.ready(page);
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-theme\\b`));
          await expect(header(page).getByRole('heading', { level: 1 })).toHaveText('Example Co');
          await expectLogo(
            page,
            'Example Co logo',
            theme === 'dark' ? /\/logo-dark\.svg$/ : /\/logo-light\.svg$/,
            84
          );
          await expectHeaderFits(page);
          await expect(page).toHaveTitle('Example Co');
          await expect(page.getByText('MindRoom Chat', { exact: true })).toHaveCount(0);

          const footer = page.locator('footer');
          await expect(footer.getByText(BRANDING.footer.text, { exact: true })).toBeVisible();
          await expect(footer.getByRole('link', { name: 'Imprint' })).toHaveAttribute(
            'href',
            'https://example.test/imprint'
          );
          await expect(footer.getByRole('link', { name: 'Help desk' })).toHaveAttribute(
            'href',
            'mailto:help@example.test'
          );
          // The credits stay as auth.poweredBy says: the default here.
          await expect(footer).toContainText('Powered by MindRoom and Matrix');
          await shoot(page, `${browserName}-${layout}-${theme}-${screen.name}-branded`);
        }

        // The Local MindRoom pairing page has the same card header.
        await page.goto('/connect?code=ABCD-EFGH');
        await expect(header(page).getByText('Example Co', { exact: true })).toBeVisible();
        await expectLogo(
          page,
          'Example Co logo',
          theme === 'dark' ? /\/logo-dark\.svg$/ : /\/logo-light\.svg$/,
          84
        );
        await shoot(page, `${browserName}-${layout}-${theme}-connect-branded`);
      } finally {
        await context.close();
      }
      /* eslint-enable no-await-in-loop */
    }
  }
};

/** Without branding, or with a malformed one, the pages look as MindRoom Chat's always did. */
const checkDefault = async (browser: Browser, baseURL: string, browserName: string) => {
  const deployments: Deployment[] = [
    { name: 'default' },
    { name: 'malformed', branding: { title: 42, logo: { src: 'javascript:alert(1)' }, footer: 7 } },
  ];
  for (const deployment of deployments) {
    for (const layout of Object.keys(LAYOUTS) as Layout[]) {
      for (const theme of THEMES) {
        /* eslint-disable no-await-in-loop -- one screen after the other. */
        const context = await openContext(browser, baseURL, layout, theme, deployment);
        try {
          const page = await context.newPage();
          const warnings: string[] = [];
          page.on('console', (message) => {
            if (message.type() === 'warning') warnings.push(message.text());
          });
          for (const screen of SCREENS) {
            await page.goto(screen.path);
            await screen.ready(page);
            await expect(header(page).getByRole('heading', { level: 1 })).toHaveText(
              'MindRoom Chat'
            );
            await expectLogo(page, 'MindRoom Chat Logo', /mindroom-logo/, 28);
            await expect(page).toHaveTitle('MindRoom');
            await expect(page.locator('footer')).toHaveText('Powered by MindRoom and Matrix');
            await shoot(
              page,
              `${browserName}-${layout}-${theme}-${screen.name}-${deployment.name}`
            );
          }
          if (deployment.name === 'malformed') {
            expect(warnings.some((text) => text.includes('branding.title'))).toBe(true);
            expect(warnings.some((text) => text.includes('branding.logo'))).toBe(true);
            expect(warnings.some((text) => text.includes('branding.footer'))).toBe(true);
          }
        } finally {
          await context.close();
        }
        /* eslint-enable no-await-in-loop */
      }
    }
  }
};

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('a configured brand replaces the logo, title and footer on the signed-out pages', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await checkBranded(browser, baseURL!, 'chromium');
});

test('without branding the signed-out pages keep the MindRoom Chat look', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await checkDefault(browser, baseURL!, 'chromium');
});

test('branding and its defaults in WebKit', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(360_000);
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
  try {
    await checkBranded(browser, baseURL!, 'webkit');
    await checkDefault(browser, baseURL!, 'webkit');
  } finally {
    await browser.close();
  }
});
