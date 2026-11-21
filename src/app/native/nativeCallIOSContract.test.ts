import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const projectSource = read('ios/App/App.xcodeproj/project.pbxproj');

describe('LiveKit Swift package', () => {
  it('is pinned to exactly 2.19.0', () => {
    expect(projectSource).toMatch(
      /isa = XCRemoteSwiftPackageReference;\s*repositoryURL = "https:\/\/github\.com\/livekit\/client-sdk-swift";\s*requirement = \{\s*kind = exactVersion;\s*version = 2\.19\.0;\s*\};/
    );
    const resolved = JSON.parse(
      read('ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved')
    ) as { pins: Array<{ identity: string; state: { version?: string } }> };
    const version = (identity: string) =>
      resolved.pins.find((pin) => pin.identity === identity)?.state.version;
    expect(version('client-sdk-swift')).toBe('2.19.0');
    expect(version('webrtc-xcframework')).toBe('150.7871.4');
    expect(version('livekit-ffi-xcframework')).toBe('0.13.1');
  });

  it('is linked by both Mac targets, for Mac Catalyst only', () => {
    const links = projectSource.match(
      /\/\* LiveKit in Frameworks \*\/ = \{isa = PBXBuildFile; platformFilter = maccatalyst; productRef = [0-9A-F]{24} \/\* LiveKit \*\/; \};/g
    );
    expect(links).toHaveLength(2);
    expect(projectSource.match(/productName = LiveKit;/g)).toHaveLength(2);
  });
});
