import { describe, expect, it } from 'vitest';
import { mindroomBuildAssets } from '../scripts/vite-build-assets.mjs';
import { defined } from './app/test-utils/defined';

type Emitted = { type: string; fileName: string; source: string };

const emitAssets = async (env: Record<string, string | undefined>) => {
  const plugin = mindroomBuildAssets(env);
  const emitted: Emitted[] = [];
  const generateBundle = plugin.generateBundle as unknown as (this: unknown) => Promise<void>;
  await generateBundle.call({ emitFile: (file: Emitted) => emitted.push(file) });
  return { plugin, emitted };
};

describe('mindroomBuildAssets', () => {
  it('defines the build and release versions the bundle reports', () => {
    const plugin = mindroomBuildAssets({
      MINDROOM_BUILD_VERSION: 'build-1',
      MINDROOM_RELEASE_VERSION: 'v1.2.3',
    });
    const config = (plugin.config as unknown as () => { define: Record<string, string> })();
    expect(config.define).toEqual({
      __MINDROOM_BUILD_VERSION__: '"build-1"',
      __MINDROOM_RELEASE_VERSION__: '"v1.2.3"',
    });
  });

  it('writes the bootstrap scripts and version.json into the build', async () => {
    const { emitted } = await emitAssets({
      MINDROOM_BUILD_VERSION: 'build-1',
      MINDROOM_RELEASE_VERSION: 'v1.2.3',
    });
    expect(emitted.map((file) => file.fileName).sort()).toEqual([
      'authentication-recovery.js',
      'runtime-config.js',
      'version.json',
    ]);
    const byName = Object.fromEntries(emitted.map((file) => [file.fileName, file.source]));
    expect(JSON.parse(defined(byName['version.json'], 'version.json'))).toEqual({
      version: 'build-1',
      release: 'v1.2.3',
    });
    expect(byName['runtime-config.js']).toContain('__ENABLE_SERVICE_WORKER__');
    expect(byName['runtime-config.js']).toContain('authentication-recovery.js');
    expect(byName['authentication-recovery.js']).toContain('__AUTHENTICATION_RECOVERY__');
  });
});
