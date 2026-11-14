import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Use the same parsers as the declared Capacitor CLI dependency.
const requireCapacitor = createRequire(require.resolve('@capacitor/cli/package.json'));
const plist = requireCapacitor('plist');
const xcode = requireCapacitor('xcode');
const appDirectory = resolve('ios/App/App');
const info = plist.parse(readFileSync(resolve(appDirectory, 'Info.plist'), 'utf8'));

const projectSource = readFileSync(resolve('ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
const appBuildSettings = projectSource
  .split('isa = XCBuildConfiguration;')
  .filter((section) => section.includes('PRODUCT_BUNDLE_IDENTIFIER = chat.mindroom.app;'));

describe('iOS scene launch configuration', () => {
  it('provides the application scene first, and a second one only the Mac opens', () => {
    const manifest = info.UIApplicationSceneManifest;
    expect(manifest, 'iOS 27 rejects legacy application-only startup').toBeDefined();
    // One scene on iPhone and iPad; the Mac also opens the Quick Capture window.
    expect(manifest.UIApplicationSupportsMultipleScenes).toBe(
      '$(MINDROOM_SUPPORTS_MULTIPLE_SCENES)'
    );
    expect(appBuildSettings).toHaveLength(2);
    appBuildSettings.forEach((settings) => {
      expect(settings).toContain('MINDROOM_SUPPORTS_MULTIPLE_SCENES = NO;');
      expect(settings).toContain('"MINDROOM_SUPPORTS_MULTIPLE_SCENES[sdk=macosx*]" = YES;');
    });
    const scenes = manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication;
    expect(scenes).toHaveLength(2);
    expect(scenes[0].UISceneConfigurationName).toBe('Default Configuration');
    expect(scenes[1]).toEqual({
      UISceneConfigurationName: 'Quick Capture',
      UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).QuickCaptureSceneDelegate',
    });
    // This app creates its custom bridge in the scene delegate, so UIKit must
    // not create a second bridge from the old application or scene storyboard.
    expect(info.UIMainStoryboardFile).toBeUndefined();
    expect(scenes[0].UISceneStoryboardFile).toBeUndefined();
  });

  it('compiles the scene delegates referenced by the launch manifest into the App target', () => {
    const scenes: { UISceneDelegateClassName: string }[] =
      info.UIApplicationSceneManifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
    const fileNames = scenes.map(({ UISceneDelegateClassName: delegateName }) => {
      expect(delegateName).toMatch(/^\$\(PRODUCT_MODULE_NAME\)\.[A-Za-z]+$/);
      const fileName = `${delegateName.split('.').at(-1)}.swift`;
      expect(existsSync(resolve(appDirectory, fileName))).toBe(true);
      return fileName;
    });

    const project = xcode.project(resolve('ios/App/App.xcodeproj/project.pbxproj'));
    project.parseSync();
    const target = project.getFirstTarget();
    const phase = project.pbxSourcesBuildPhaseObj(target.uuid);
    const buildFiles = project.pbxBuildFileSection();
    const fileReferences = project.pbxFileReferenceSection();
    const compiledPaths = phase.files.map(({ value }: { value: string }) => {
      const reference = fileReferences[buildFiles[value].fileRef];
      return reference.path.replace(/^"|"$/g, '');
    });
    fileNames.forEach((fileName) => expect(compiledPaths).toContain(fileName));
    expect(compiledPaths).toContain('MindRoomBridgeViewController.swift');
    ['MacWindowing.swift', 'MacScreenshot.swift', 'MindRoomQuickCapturePlugin.swift'].forEach(
      (fileName) => expect(compiledPaths).toContain(fileName)
    );
  });
});
