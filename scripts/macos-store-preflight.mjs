// @ts-check
// Checks emitted Mac Store artifacts. Structure-only checks do not establish signing or eligibility.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{app: Record<string, unknown>, support: Record<string, unknown>, web: Record<string, unknown>, version: string, build: string, commit: string}} MacStoreMetadata */
/** @param {MacStoreMetadata} input @returns {string[]} */
export const macStoreMetadataProblems = ({ app, support, web, version, build, commit }) => {
  const problems = [];
  if (!/^[1-9]\d{3}\.(?:[1-9]|1[0-2])\.(?:0|[1-9]\d*)$/.test(version)) {
    problems.push('Expected version must be a calendar version YYYY.M.N.');
  }
  if (!/^[1-9]\d*$/.test(build)) problems.push('Expected build must be a positive integer.');
  if (!/^[a-f0-9]{40}$/.test(commit)) problems.push('Expected commit must be a full Git SHA.');
  for (const [name, info] of Object.entries({ app, 'native support': support })) {
    const id = name === 'app' ? 'chat.mindroom.app' : 'chat.mindroom.app.mac-support';
    if (info.CFBundleIdentifier !== id) problems.push(`${name} CFBundleIdentifier differs.`);
    if (info.CFBundleShortVersionString !== version) {
      problems.push(`${name} CFBundleShortVersionString differs from ${version}.`);
    }
    if (info.CFBundleVersion !== build)
      problems.push(`${name} CFBundleVersion differs from ${build}.`);
  }
  if (
    !Array.isArray(app.CFBundleSupportedPlatforms) ||
    !app.CFBundleSupportedPlatforms.includes('MacOSX')
  ) {
    problems.push('The app must support MacOSX.');
  }
  if (
    typeof app.LSApplicationCategoryType !== 'string' ||
    !app.LSApplicationCategoryType.startsWith('public.app-category.')
  ) {
    problems.push('LSApplicationCategoryType is missing or invalid.');
  }
  if (typeof app.NSHumanReadableCopyright !== 'string' || !app.NSHumanReadableCopyright.trim()) {
    problems.push('NSHumanReadableCopyright is missing.');
  }
  if (app.ITSAppUsesNonExemptEncryption !== false) {
    problems.push(
      'ITSAppUsesNonExemptEncryption must preserve the resolved exempt-encryption declaration.'
    );
  }
  if (web.release !== `v${version}`)
    problems.push('Bundled web release differs from the app version.');
  // Client plugins add `-plugins-` and a digest of their files to the version (scripts/build-version.mjs).
  if (String(web.version).replace(/-plugins-[0-9a-f]{16}$/, '') !== commit)
    problems.push('Bundled web source commit differs from the candidate commit.');
  return problems;
};

/** @param {Record<string, unknown>} entitlements @param {string} team @returns {string[]} */
export const macStoreEntitlementProblems = (entitlements, team) => {
  const problems = [];
  if (team !== 'DNA6966LGZ') problems.push('The signing team must be DNA6966LGZ.');
  for (const key of [
    'com.apple.security.app-sandbox',
    'com.apple.security.network.client',
    'com.apple.security.device.microphone',
    'com.apple.security.device.audio-input',
    'com.apple.security.device.camera',
    'com.apple.security.files.user-selected.read-write',
  ]) {
    if (entitlements[key] !== true) problems.push(`Signed entitlement ${key} must be enabled.`);
  }
  if (
    entitlements['com.apple.security.get-task-allow'] === true ||
    entitlements['get-task-allow'] === true
  ) {
    problems.push('Store distribution must not enable get-task-allow.');
  }
  if (entitlements['com.apple.developer.aps-environment'] !== 'production') {
    problems.push('Store com.apple.developer.aps-environment must be production.');
  }
  const domains = entitlements['com.apple.developer.associated-domains'];
  if (!Array.isArray(domains) || !domains.includes('applinks:chat.mindroom.chat')) {
    problems.push('Signed associated domains must include applinks:chat.mindroom.chat.');
  }
  return problems;
};

/** @param {string[]} app @param {string[]} support @returns {string[]} */
export const macStoreArchitectureProblems = (app, support) => {
  const problems = [];
  if (app.length === 0) problems.push('The app has no architecture.');
  for (const arch of app) {
    if (!support.includes(arch))
      problems.push(`Native support is missing the app's ${arch} architecture.`);
  }
  return problems;
};

/** @param {string} file */
const plist = (file) =>
  JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }));
/** @param {string} file */
const signatureDetails = (file) => {
  const result = spawnSync('codesign', ['-d', '--verbose=4', file], { encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`Cannot read code signature for ${path.basename(file)}.`);
  return {
    team: /^TeamIdentifier=(.+)$/m.exec(result.stderr)?.[1] ?? '',
    authority: /^Authority=(.+)$/m.exec(result.stderr)?.[1] ?? '',
  };
};

/**
 * The Store app must carry no trace of the Developer ID app's updater (Sparkle).
 * @param {{paths: string[], infoKeys: string[], strings: string[]}} input
 * @returns {string[]}
 */
export const macStoreUpdaterProblems = ({ paths, infoKeys, strings }) => {
  const problems = [];
  // The web bundle (Contents/Resources/public) carries every license text, Sparkle's too.
  const native = paths.filter((file) => !file.startsWith('Contents/Resources/public/'));
  if (native.some((file) => /Sparkle|MindRoomMacUpdater/.test(file)))
    problems.push('A Mac Store artifact must not embed the updater or Sparkle.');
  // Sparkle's keys (SUFeedURL, SUPublicEDKey, ...), not words such as SUPPORTED.
  if (infoKeys.some((key) => /^SU[A-Z][a-z]/.test(key)))
    problems.push("A Mac Store artifact must not have Sparkle's Info.plist keys.");
  if (strings.some((text) => /SPUUpdater|MindRoomMacUpdater/.test(text)))
    problems.push('A Mac Store binary must not reference the updater.');
  return problems;
};

/**
 * Inspect either an xcarchive or its extracted .app. Never uploads or changes the artifact.
 * @param {{artifact: string, version: string, build: string, commit: string, structureOnly?: boolean}} input
 */
export const inspectMacStoreArtifact = ({
  artifact,
  version,
  build,
  commit,
  structureOnly = false,
}) => {
  const app = artifact.endsWith('.app')
    ? artifact
    : path.join(artifact, 'Products/Applications/MindRoom.chat.app');
  const support = path.join(app, 'Contents/PlugIns/MindRoomMacSupport.bundle');
  if (!existsSync(support)) throw new Error('The native Mac support bundle is missing.');
  const info = plist(path.join(app, 'Contents/Info.plist'));
  const nativeInfo = plist(path.join(support, 'Contents/Info.plist'));
  const web = JSON.parse(
    readFileSync(path.join(app, 'Contents/Resources/public/version.json'), 'utf8')
  );
  const problems = macStoreMetadataProblems({
    app: info,
    support: nativeInfo,
    web,
    version,
    build,
    commit,
  });
  if (['Watch', 'Contents/Watch'].some((folder) => existsSync(path.join(app, folder)))) {
    problems.push('A Mac Store artifact must not embed Watch products.');
  }
  const binaries = [
    path.join(app, 'Contents/MacOS/MindRoom.chat'),
    path.join(support, 'Contents/MacOS/MindRoomMacSupport'),
  ];
  const architectures = binaries.map((binary) =>
    execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  );
  problems.push(...macStoreArchitectureProblems(architectures[0] ?? [], architectures[1] ?? []));
  /** @type {string[]} */
  const binaryStrings = [];
  binaries.forEach((binary, index) => {
    const strings = execFileSync('strings', ['-a', binary], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    binaryStrings.push(...strings.split('\n'));
    if (strings.split('\n').includes('uiWindows'))
      problems.push('An emitted binary contains the private uiWindows selector.');
    const platforms = [
      ...execFileSync('xcrun', ['vtool', '-show-build', binary], { encoding: 'utf8' }).matchAll(
        /^\s*platform (\w+)$/gm
      ),
    ].map((match) => match[1]);
    const expected = index === 0 ? 'MACCATALYST' : 'MACOS';
    if (platforms.length === 0 || platforms.some((platform) => platform !== expected)) {
      problems.push(`${path.basename(binary)} must use the ${expected} platform in every slice.`);
    }
  });
  problems.push(
    ...macStoreUpdaterProblems({
      paths: readdirSync(app, { recursive: true, encoding: 'utf8' }),
      infoKeys: Object.keys(info),
      strings: binaryStrings,
    })
  );
  if (!structureOnly) {
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
    const mainSignature = signatureDetails(app);
    const nativeSignature = signatureDetails(support);
    const xml = execFileSync('codesign', ['-d', '--entitlements', ':-', app], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const entitlements = JSON.parse(
      execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml, encoding: 'utf8' })
    );
    problems.push(...macStoreEntitlementProblems(entitlements, mainSignature.team));
    if (nativeSignature.team !== 'DNA6966LGZ')
      problems.push('Native support has a different signing team.');
    for (const signature of [mainSignature, nativeSignature]) {
      if (!/^(Apple Distribution|3rd Party Mac Developer Application):/.test(signature.authority)) {
        problems.push(
          'App Store artifacts require Mac App Store distribution signing, not Developer ID or development signing.'
        );
      }
    }
  }
  return {
    problems,
    app,
    version,
    build,
    commit,
    architectures: architectures[0] ?? [],
    signingChecked: !structureOnly,
  };
};

/**
 * Inspect the Cloud export, including a flat installer package, without installing it.
 * Temporary extraction is removed before returning. Unknown/ambiguous layouts fail closed.
 * @param {{artifact: string, version: string, build: string, commit: string, structureOnly?: false}} input
 */
export const inspectMacStoreExport = (input) => {
  let artifact = input.artifact;
  if (!existsSync(artifact)) throw new Error('The Store-signed export is missing.');
  if (
    !artifact.endsWith('.app') &&
    !artifact.endsWith('.pkg') &&
    !artifact.endsWith('.xcarchive')
  ) {
    const candidates = readdirSync(artifact).filter((name) => /\.(app|pkg)$/.test(name));
    if (candidates.length !== 1 || !candidates[0])
      throw new Error('The Store export must contain exactly one app or installer package.');
    artifact = path.join(artifact, candidates[0]);
  }
  if (!artifact.endsWith('.pkg'))
    return inspectMacStoreArtifact({ ...input, artifact, structureOnly: false });
  if (!statSync(artifact).isFile()) throw new Error('The Store installer must be a flat package.');
  const signature = execFileSync('pkgutil', ['--check-signature', artifact], { encoding: 'utf8' });
  if (
    !/1\.\s+(?:3rd Party Mac Developer Installer|Mac Installer Distribution):[^\n]+\(DNA6966LGZ\)/.test(
      signature
    )
  ) {
    throw new Error(
      'The Store installer must use Mac App Store installer signing for team DNA6966LGZ.'
    );
  }
  const scratch = mkdtempSync(path.join(tmpdir(), 'mindroom-store-export-'));
  try {
    const expanded = path.join(scratch, 'expanded');
    execFileSync('pkgutil', ['--expand-full', artifact, expanded], { stdio: 'pipe' });
    /** @param {string} directory @returns {string[]} */
    const appsIn = (directory) =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (!entry.isDirectory()) return [];
        const file = path.join(directory, entry.name);
        return entry.name.endsWith('.app') ? [file] : appsIn(file);
      });
    const apps = appsIn(expanded);
    if (apps.length !== 1 || !apps[0])
      throw new Error('The Store installer must contain exactly one app.');
    return inspectMacStoreArtifact({ ...input, artifact: apps[0], structureOnly: false });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [artifact, version, build, commit, mode, ...extra] = process.argv.slice(2);
  try {
    if (
      !artifact ||
      !version ||
      !build ||
      !commit ||
      (mode && mode !== '--structure-only') ||
      extra.length
    ) {
      throw new Error(
        'Usage: node scripts/macos-store-preflight.mjs <archive-app-or-export> <version> <build> <commit> [--structure-only]'
      );
    }
    const input = {
      artifact,
      version,
      build,
      commit,
    };
    const result =
      mode === '--structure-only'
        ? inspectMacStoreArtifact({ ...input, structureOnly: true })
        : inspectMacStoreExport(input);
    if (result.problems.length) throw new Error(result.problems.join('\n'));
    console.log(
      JSON.stringify({
        ...result,
        status: result.signingChecked
          ? 'signed checks passed; Apple upload validation still required'
          : 'structure checks passed; signing not checked',
      })
    );
  } catch (error) {
    console.error(
      `Mac Store preflight failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
