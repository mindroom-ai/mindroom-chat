import { expect, test, type Page } from '@playwright/test';

// A namespace registered beside the app's catalog, as a plugin registers `plugin.<id>`, follows the
// language picked on the Language & region settings page: its English ships with it, and another
// language's strings load from its loader once that language is picked. When an earlier pick is
// still loading, the language picked last stays, whichever load finishes last. The fixture's
// loader fetches /plugin-locales/<code>.json, which this spec serves.
const FIXTURE = '/e2e/fixtures/i18n-namespaces.html';
const GREETINGS: Record<string, string> = { de: 'Hallo vom Plugin', fr: 'Bonjour du plugin' };

type FixtureWindow = { fixtureI18n: Pick<typeof import('i18next').default, 'hasResourceBundle'> };

/** Answers `pattern` only once the returned function is called. */
const holdBack = async (page: Page, pattern: string): Promise<() => void> => {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    await released;
    await route.fallback();
  });
  return release;
};

const servePluginCatalogs = (page: Page) =>
  page.route('**/plugin-locales/*.json', async (route) => {
    const language = /plugin-locales\/([\w-]+)\.json/.exec(route.request().url())?.[1] ?? '';
    const greeting = GREETINGS[language];
    await route.fulfill(greeting ? { json: { greeting } } : { status: 404 });
  });

const pickLanguage = async (page: Page, current: string, next: string) => {
  await page.getByRole('button', { name: current, exact: true }).click();
  await page.getByRole('menuitemradio', { name: next, exact: true }).click();
};

test('a registered namespace follows the language picked in settings', async ({ page }) => {
  await servePluginCatalogs(page);
  await page.goto(FIXTURE);
  const greeting = page.getByTestId('plugin-greeting');
  await expect(greeting).toHaveText('Hello from the plugin');

  await pickLanguage(page, 'English', 'Deutsch');
  await expect(greeting).toHaveText('Hallo vom Plugin');
  await expect(page.getByText('Sprache der App', { exact: true })).toBeVisible();

  await pickLanguage(page, 'Deutsch', 'Français');
  await expect(greeting).toHaveText('Bonjour du plugin');
  await expect(page.getByText("Langue de l'application", { exact: true })).toBeVisible();
});

for (const { held, pattern, namespace } of [
  { held: 'its namespace', pattern: '**/plugin-locales/de.json', namespace: 'plugin.demo' },
  { held: 'the app catalog', pattern: '**/public/locales/de.json*', namespace: 'translation' },
]) {
  test(`the language picked last stays when ${held} for an earlier pick arrives later`, async ({
    page,
  }) => {
    await servePluginCatalogs(page);
    const releaseGerman = await holdBack(page, pattern);
    await page.goto(FIXTURE);
    const greeting = page.getByTestId('plugin-greeting');
    await expect(greeting).toHaveText('Hello from the plugin');

    await pickLanguage(page, 'English', 'Deutsch');
    await pickLanguage(page, 'English', 'Français');
    await expect(greeting).toHaveText('Bonjour du plugin');

    releaseGerman();
    // The German catalog arriving finishes the earlier pick, in the same task.
    await page.waitForFunction(
      (ns) => (window as unknown as FixtureWindow).fixtureI18n.hasResourceBundle('de', ns),
      namespace
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(greeting).toHaveText('Bonjour du plugin');
    await expect(page.getByText("Langue de l'application", { exact: true })).toBeVisible();
  });
}
