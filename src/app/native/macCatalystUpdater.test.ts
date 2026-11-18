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
    // The one place the key goes. While it is the placeholder the updater never starts and a
    // signed release fails at its appcast (macUpdaterScripts.test.ts).
    expect(release).toMatch(/MINDROOM_UPDATE_PUBLIC_KEY = "PLACEHOLDER[^"]*";/);
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

describe('the Mac workflow and the update feed', () => {
  const workflow = read('.github/workflows/macos.yml');

  it('hands the private key to the appcast step alone, and puts the DMG up last', () => {
    // The private key is named in the check that it exists and in one step's environment.
    expect(workflow.match(/secrets\.SPARKLE_ED_PRIVATE_KEY/g)).toHaveLength(2);
    expect(workflow).toContain("HAS_SPARKLE_KEY: ${{ secrets.SPARKLE_ED_PRIVATE_KEY != '' }}");
    expect(workflow).toContain('| env -u SPARKLE_ED_PRIVATE_KEY scripts/macos-appcast.sh ');
    // The DMG goes up last: a release that has it has the appcast.xml that signs it.
    const upload = workflow.slice(
      workflow.indexOf('- name: Attach the appcast and the DMG to the release\n')
    );
    expect(upload.indexOf('build/macos/appcast.xml --clobber')).toBeGreaterThan(-1);
    expect(upload.indexOf('build/macos/appcast.xml --clobber')).toBeLessThan(
      upload.indexOf('build/macos/MindRoom.dmg')
    );
  });

  it('signs only a published, stable release, and backfills a pre-updater tag with its DMG alone', () => {
    type Step = {
      name?: string;
      if?: string;
      run?: string;
      uses?: string;
      env?: Record<string, string>;
    };
    const steps = (parse(workflow) as { jobs: { dmg: { steps: Step[] } } }).jobs.dmg.steps;
    const named = (name: string) => steps.find((step) => step.name === name)!;
    expect(named('Check the release').run).toContain('--json isDraft,isPrerelease');
    // One rule, from the checked-out tag: one from before the updater has no appcast script (and
    // needs no key); any other needs the key before the build and uploads its appcast or fails.
    const check = named('Check the update key');
    const checkout = steps.findIndex(({ uses }) => uses?.startsWith('actions/checkout'));
    expect(steps.indexOf(check)).toBeGreaterThan(checkout);
    expect(steps.indexOf(check)).toBeLessThan(steps.indexOf(named('Build, sign and notarize')));
    expect(check.run).toContain('if [[ -f scripts/macos-appcast.sh ]]; then');
    expect(check.run).toContain('echo updater=true >> "$GITHUB_OUTPUT"');
    expect(named('Make the appcast').if).toBe("steps.updater.outputs.updater == 'true'");
    const upload = named('Attach the appcast and the DMG to the release');
    expect(upload.env?.UPDATER).toBe('${{ steps.updater.outputs.updater }}');
    expect(upload.run).toContain('if [[ $UPDATER == true ]]; then');
    expect(upload.run).not.toContain('-f build/macos/appcast.xml');
  });

  it('publishes the feed one run at a time, and writes nothing but for a release tag', () => {
    type Step = { if?: string; run?: string };
    const parsed = parse(workflow) as {
      on: { workflow_dispatch: { inputs: Record<string, unknown> } };
      jobs: { dmg: { steps: Step[] } };
    };
    const feed = workflow.slice(workflow.indexOf('\n  feed:\n'));
    expect(feed).toContain('needs: dmg');
    // Also after a dmg job that failed at the tap: the DMG is up then.
    expect(feed).toContain(
      "if: ${{ !cancelled() && needs.dmg.result != 'skipped' && (inputs.tag || github.event.release.tag_name) }}"
    );
    // Every waiting run keeps its place: a run that finishes late may be older than one waiting.
    expect(feed).toMatch(/concurrency:\n\s+group: mac-appcast\n\s+queue: max\n/);
    expect(feed).not.toContain('cancel-in-progress');
    expect(feed).toContain('scripts/macos-publish-appcast.sh "$RELEASE_TAG"');
    expect(feed).not.toContain('secrets.');
    // Nothing but a release tag signs or writes: no other input, and every writing step asks for it.
    expect(Object.keys(parsed.on.workflow_dispatch.inputs)).toEqual(['tag']);
    const writing = parsed.jobs.dmg.steps.filter(({ run }) =>
      /gh release upload|gh release create|homebrew-tap/.test(run ?? '')
    );
    expect(writing.length).toBeGreaterThan(1);
    writing.forEach((step) =>
      expect(step.if).toMatch(/env\.RELEASE_TAG|steps\.newest\.outputs\.newest/)
    );
  });
});
