const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,64}$/i;

export const resolveBuildVersion = (environment, localCommit) => {
  const explicitVersion = environment.MINDROOM_BUILD_VERSION?.trim();
  if (explicitVersion) return explicitVersion;

  // GitHub's GITHUB_SHA and Netlify's COMMIT_REF are the documented commit
  // hashes (Netlify uses BRANCH for the branch name). Validate provider values
  // defensively before considering other sources.
  const providerCommit = [environment.GITHUB_SHA, environment.COMMIT_REF]
    .map((value) => value?.trim())
    .find((value) => value && COMMIT_HASH_PATTERN.test(value));
  if (providerCommit) return providerCommit;

  const checkedOutCommit = localCommit?.trim();
  if (checkedOutCommit) return checkedOutCommit;

  // A Netlify deploy ID is unique but is not a Git hash. Use it only when no
  // provider or local Git commit is available, such as for a manual upload.
  return environment.DEPLOY_ID?.trim() || undefined;
};
