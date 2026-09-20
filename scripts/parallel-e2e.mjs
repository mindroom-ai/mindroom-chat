import { availableParallelism } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

export const requireLoopback = (value) => {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Fixture services must use an HTTP loopback origin without credentials.');
  return url.origin;
};

export const cleanupContainers = async (names, remove) => {
  const failures = [];
  for (const name of names) {
    try {
      const result = await remove(name);
      if (result.code !== 0)
        failures.push({
          name,
          error: `Removal exited with status ${result.code ?? result.signal}`,
        });
    } catch (error) {
      failures.push({ name, error: String(error.message ?? error) });
    }
  }
  return failures;
};

export const parseArguments = (args) => {
  const options = {
    jobs: Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2))),
    files: [],
  };
  const values = {
    '--jobs': 'jobs',
    '--artifacts': 'artifacts',
    '--computer-fixture': 'computerFixture',
    '--sso-homeserver': 'ssoHomeserver',
    '--phase': 'phase',
    '--production-url': 'productionURL',
  };
  const flags = {
    '--list': 'list',
    '--help': 'help',
    '-h': 'help',
    '--skip-build': 'skipBuild',
    '--docker-browsers': 'dockerBrowsers',
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (flags[arg]) options[flags[arg]] = true;
    else if (values[arg]) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[values[arg]] = args[++i];
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else options.files.push(arg.replace(/^\.\//, ''));
  }
  if (
    !/^\d+$/.test(String(options.jobs)) ||
    Number(options.jobs) < 1 ||
    Number(options.jobs) > 64
  ) {
    throw new Error('--jobs must be an integer from 1 to 64.');
  }
  options.jobs = Number(options.jobs);
  options.phase ??= 'all';
  if (options.productionURL) options.productionURL = requireLoopback(options.productionURL);
  if (!['all', 'parallel', 'serial'].includes(options.phase))
    throw new Error('--phase must be all, parallel, or serial.');
  if (options.ssoHomeserver) {
    const url = new URL(options.ssoHomeserver);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid --sso-homeserver URL');
  }
  return options;
};

export const usesDevelopmentServer = (file, source) =>
  source.includes('/e2e/fixtures/') ||
  /diagnostics-storage-fallback|cinny124-flight-recorder/.test(file);

const exclusiveSpec =
  /(?:^|\/)(?:perf-|ios-momentum-invariants|thread-ride-under-latency|message-rendering-performance|thinking-marker|long-message-expansion-default|app-store-screenshots|minimap-verify|worker-computer|deployed-auth-shell)/;

const flatten = (report, repo) => {
  const cases = [];
  const visit = (suite, parents = []) => {
    const titles = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      const absolute = isAbsolute(spec.file)
        ? spec.file
        : resolve(report.config?.rootDir ?? resolve(repo, 'e2e'), spec.file);
      const file = relative(repo, absolute).replaceAll('\\', '/');
      if (file.startsWith('../')) throw new Error('Discovered test outside repository');
      for (const test of spec.tests ?? []) {
        const title = [...titles.slice(1), spec.title].join(' › ');
        cases.push({
          key: JSON.stringify([file, test.projectName, title]),
          file,
          project: test.projectName,
          title,
          results: test.results ?? [],
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  visit(report);
  return cases;
};

export const planJobs = (reports, { repo, files = [] }) => {
  const jobs = new Map();
  const seen = new Set();
  for (const { config, report } of reports) {
    if (report.errors?.length) throw new Error(`Discovery failed for ${config}`);
    for (const item of flatten(report, repo)) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      const id = `${item.file}::${item.project}`;
      let job = jobs.get(id);
      if (!job) {
        job = {
          id,
          file: item.file,
          project: item.project,
          config,
          repo,
          exclusive: exclusiveSpec.test(item.file),
          cases: [],
        };
        jobs.set(id, job);
      }
      if (job.config !== config)
        throw new Error(`Conflicting test subsets for ${id}: ${job.config} and ${config}`);
      job.cases.push({ key: item.key, title: item.title });
    }
  }
  const all = [...jobs.values()];
  for (const file of files)
    if (!all.some((job) => job.file === file)) throw new Error(`Spec not discovered: ${file}`);
  const selected = all.filter((job) => !files.length || files.includes(job.file));
  if (!selected.length) throw new Error('No browser tests discovered.');
  return selected;
};

export const summarizeJob = (job, report, exitCode) => {
  const counts = { passed: 0, failed: 0, skipped: 0, missing: 0 };
  const observed = new Map();
  if (report)
    for (const item of flatten(report, job.repo)) {
      observed.set(item.key, [...(observed.get(item.key) ?? []), ...item.results]);
    }
  for (const item of job.cases) {
    const results = observed.get(item.key);
    if (!results?.length) counts.missing += 1;
    else if (results.every((result) => result.status === 'skipped')) counts.skipped += 1;
    else if (results.every((result) => result.status === 'passed')) counts.passed += 1;
    else counts.failed += 1;
  }
  return {
    status:
      exitCode === 0 && report && !report.errors?.length && !counts.failed && !counts.missing
        ? 'passed'
        : 'failed',
    counts,
  };
};

export const runJobs = async (
  jobs,
  { concurrency, execute, signal, onResult = async () => {} }
) => {
  const results = [];
  const finish = async (job, value) => {
    const result = { id: job.id, file: job.file, project: job.project, ...value };
    results.push(result);
    await onResult(result);
  };
  const runQueue = async (queue, limit) => {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (next < queue.length && !signal?.aborted) {
          const job = queue[next++];
          let result;
          try {
            result = await execute(job);
          } catch (error) {
            result = {
              status: signal?.aborted ? 'interrupted' : 'error',
              error: String(error.message ?? error),
            };
          }
          await finish(job, result);
        }
      })
    );
    for (const job of queue.slice(next)) await finish(job, { status: 'interrupted' });
  };
  await runQueue(
    jobs.filter((job) => !job.exclusive),
    concurrency
  );
  await runQueue(
    jobs.filter((job) => job.exclusive),
    1
  );
  return results;
};
