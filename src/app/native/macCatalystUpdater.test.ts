import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { getSingleAppTargetBuildSettingValue } from '../../../scripts/ios-xcode-project.mjs';

// Xcode, Swift and the project file cannot run on Linux: these pin the fewest strings that hold the
// contract that only the Developer ID Mac app carries Sparkle.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const project = read('ios/App/App.xcodeproj/project.pbxproj');
/** The text of the project object with this ID, `<id> /* ... *\/ = {` to its closing brace. */
const object = (id: string) => {
  const start = project.search(new RegExp(`\\n\\t\\t${id} (/\\*[^*]*\\*/ )?= \\{`));
  expect(start, id).toBeGreaterThan(-1);
  return project.slice(start, project.indexOf('\n\t\t};', start));
};
const targetId = (name: string) =>
  new RegExp(`\\n\\t\\t(\\w{24}) /\\* ${name} \\*/ = \\{\\n\\t\\t\\tisa = PBXNativeTarget;`).exec(
    project
  )?.[1] ?? '';
const target = (name: string) => object(targetId(name));
const ids = (text: string, key: string) =>
  (new RegExp(`${key} = \\(([^)]*)\\)`).exec(text)?.[1] ?? '').match(/\w{24}/g) ?? [];
const configurations = (name: string) =>
  ids(
    object(/buildConfigurationList = (\w{24})/.exec(target(name))?.[1] ?? ''),
    'buildConfigurations'
  ).map(object);
const updaterSetting = (name: string) =>
  getSingleAppTargetBuildSettingValue(project, name, 'MindRoomMacUpdater').replace(/^"|"$/g, '');

describe('the Mac updater in the Xcode project', () => {
  it('builds the updater as a macOS bundle that finds its embedded Sparkle', () => {
    expect(updaterSetting('PRODUCT_BUNDLE_IDENTIFIER')).toBe('chat.mindroom.app.mac-updater');
    expect(updaterSetting('SDKROOT')).toBe('macosx');
    expect(updaterSetting('MACOSX_DEPLOYMENT_TARGET')).toBe('13.3');
    configurations('MindRoomMacUpdater').forEach((configuration) =>
      expect(configuration).toMatch(
        /LD_RUNPATH_SEARCH_PATHS = \(\n(\s*"[^"]*",\n)*\s*"@loader_path\/\.\.\/Frameworks"/
      )
    );
  });

  it('embeds it in the Mac Catalyst App only, and adds its Info.plist keys there', () => {
    const app = target('App');
    expect(app).toContain('/* Embed Mac Updater */,');
    expect(app).toContain("/* Add the updater's Info.plist keys */,");
    expect(
      ids(app, 'dependencies')
        .map(object)
        .filter((dependency) => dependency.includes('name = MindRoomMacUpdater;'))
    ).toEqual([expect.stringContaining('platformFilter = maccatalyst;')]);
    expect(project).toMatch(
      /\/\* MindRoomMacUpdater\.bundle in Embed Mac Updater \*\/ = \{[^\n]*platformFilter = maccatalyst;/
    );
    // iOS compiles none of it: the shared protocol is filtered too (the rest is behind #if).
    const appSources = object(
      ids(app, 'buildPhases').find((id) => object(id).includes('isa = PBXSourcesBuildPhase;')) ?? ''
    );
    const protocolFile =
      /(\w{24}) \/\* MindRoomMacUpdaterProtocol\.swift in Sources \*\//.exec(appSources)?.[1] ?? '';
    expect(project).toMatch(new RegExp(`\\t${protocolFile} [^\\n]*platformFilter = maccatalyst;`));
  });

  it('names the feed in the Release App only, with a placeholder key until the real one', () => {
    const [debug, release] = ['Debug', 'Release'].map(
      (name) => configurations('App').find((text) => text.includes(`name = ${name};`)) ?? ''
    );
    expect(release).toContain(
      'MINDROOM_UPDATE_FEED_URL = "https://github.com/mindroom-ai/mindroom-chat/releases/download/mac-appcast/appcast.xml";'
    );
    // The one place the key goes: the public half of the SPARKLE_ED_PRIVATE_KEY secret
    // (docs/ios-release.md, "Making the key").
    expect(release).toContain(
      'MINDROOM_UPDATE_PUBLIC_KEY = "he65VFC6KQjH8xkoYxPKmIe6cbbspSFr7oMsttWYPRE=";'
    );
    expect(project.match(/MINDROOM_UPDATE_(FEED_URL|PUBLIC_KEY) =/g)).toHaveLength(2);
    expect(debug).not.toContain('MINDROOM_UPDATE_');
  });

  it('keeps the Store app free of it', () => {
    const store = target('AppStoreMac');
    expect(store).not.toContain('Embed Mac Updater');
    expect(store).not.toContain("Add the updater's Info.plist keys");
    const sources = object(
      ids(store, 'buildPhases').find((id) => object(id).includes('isa = PBXSourcesBuildPhase;')) ??
        ''
    );
    ['MacUpdater.swift', 'MindRoomMacUpdaterProtocol.swift', 'MindRoomUpdatePlugin.swift'].forEach(
      (file) => expect(sources).not.toContain(`/* ${file} in Sources */`)
    );
  });

  it('compiles and starts the updater only in the Developer ID Mac app', () => {
    expect(
      read('ios/App/App/MacUpdater.swift')
        .trimStart()
        .startsWith('#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE')
    ).toBe(true);
    expect(read('ios/App/App/AppDelegate.swift')).toMatch(
      /#if targetEnvironment\(macCatalyst\) && !MINDROOM_MAC_APP_STORE\n(\s*\/\/[^\n]*\n)*\s*MacUpdater\.start\(\)\n#endif/
    );
  });
});

describe('the Mac Catalyst workflow after moving releases to Electron', () => {
  const workflow = read('.github/workflows/macos.yml');

  it('only validates unsigned builds on pull requests and no longer signs or publishes DMG/appcast', () => {
    const parsed = parse(workflow) as {
      on: Record<string, unknown>;
      permissions?: Record<string, string>;
      jobs: Record<
        string,
        { permissions?: Record<string, string>; steps: Array<{ run?: string }> }
      >;
    };

    expect(Object.keys(parsed.on)).toEqual(['pull_request']);
    expect(parsed.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(parsed.jobs)).toEqual(['dmg']);
    expect(parsed.jobs.dmg?.permissions).toBeUndefined();

    expect(workflow).not.toContain('secrets.');
    expect(workflow).not.toContain('import-codesign-certs');
    expect(workflow).not.toContain('--sign');
    expect(workflow).not.toContain('macos-appcast.sh');
    expect(workflow).not.toContain('macos-publish-appcast.sh');
    expect(workflow).not.toContain('gh release upload');
    expect(workflow).not.toContain('homebrew-tap');
    expect(workflow).not.toContain('contents: write');

    const runs = (parsed.jobs.dmg?.steps ?? []).map((step) => step.run ?? '');
    expect(runs.some((run) => run.includes('scripts/test-macos-support.sh'))).toBe(true);
    expect(runs.some((run) => run.includes('scripts/build-macos-store.sh --unsigned'))).toBe(true);
    expect(runs.some((run) => run.includes('scripts/build-macos-app.sh'))).toBe(true);
  });
});
