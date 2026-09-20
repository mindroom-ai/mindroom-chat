#!/usr/bin/env node
/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArguments,
  planJobs,
  requireLoopback,
  runJobs,
  summarizeJob,
  usesDevelopmentServer,
} from './parallel-e2e.mjs';
import { createProcessManager } from './parallel-e2e-process.mjs';
import { provisionSpec } from './parallel-e2e-fixtures.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(repo, 'node_modules/@playwright/test/cli.js');
const vite = resolve(repo, 'node_modules/vite/bin/vite.js');
const help = `Usage: npm run test:e2e:parallel -- [options] [e2e/file.spec.ts ...]

Discover all Playwright configurations, run isolated specs concurrently, then
run timing-sensitive specs alone. Requires Node 22+, Docker Compose, npm ci,
and installed Playwright browsers (npx playwright install --with-deps).

  --jobs N                 Concurrent spec processes (default: up to 8)
  --list                   Print the complete plan without starting services
  --phase all|parallel|serial  Run all cases or an explicitly selected queue
  --artifacts DIRECTORY    Parent for a new run directory (default: test-results/parallel)
  --skip-build             Use an existing dist/ build; copy it into this run
  --docker-browsers        Use the matching Playwright image (Linux host networking)
  --production-url URL     Use an existing loopback app server instead of building
  --computer-fixture FILE  Isolated worker gateway JSON (or E2E_COMPUTER_FIXTURE)
  --sso-homeserver URL     Hosted SSO server (or E2E_SSO_HOMESERVER)
  --help                   Show this help

Missing external fixtures, failed specs, missing reports, or interrupted work
produce a nonzero exit. Platform skips remain visible in summary.json.
See docs/testing.md for setup, complete coverage, reruns, and known failures.
`;

const unusedPort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });

const waitForServer = async (url, handle, signal) => {
  let exited = false;
  handle?.exited.then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    }
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (exited) throw new Error(`Server exited before becoming ready: ${url}`);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await new Promise((done) => {
      setTimeout(done, 250);
    });
  }
  throw new Error(`Server did not become ready: ${url}`);
};

async function main(options) {
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const directory = resolve(options.artifacts ?? resolve(repo, 'test-results/parallel'), runId);
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error('Browser run interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const manager = createProcessManager({ cwd: repo, signal: abort.signal });
  const managers = [manager];
  // Unrelated E2E credentials must never leak into fresh local fixture jobs.
  const cleanEnv = Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => key.startsWith('E2E_'))
      .map((key) => [key, undefined])
  );
  Object.assign(cleanEnv, { CI: '1', E2E_NO_WEB_SERVER: '1', FORCE_COLOR: '0' });
  const checked = async (command, args, settings) => {
    const result = await manager.run(command, args, settings);
    if (result.code !== 0)
      throw new Error(
        `${command} failed (${result.code ?? result.signal}); see ${
          settings?.logFile ?? 'command output'
        }`
      );
    return result;
  };
  let composeStarted = false;
  let composeArgs;
  let composeEnv;
  const containers = new Set();
  let exitCode = 1;
  const summary = {
    runId,
    startedAt: new Date().toISOString(),
    scope: { phase: options.phase, files: options.files },
    jobs: [],
    results: [],
  };
  let reportWrites = Promise.resolve();
  const writeSummary = () => {
    reportWrites = reportWrites.then(() =>
      writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {
        mode: 0o600,
      })
    );
    return reportWrites;
  };

  try {
    const configs = (await readdir(repo)).filter((name) =>
      /^playwright(?:\.[\w-]+)?\.config\.(?:ts|js|mjs)$/.test(name)
    );
    configs.sort((a, b) =>
      a === 'playwright.config.ts' ? -1 : b === 'playwright.config.ts' ? 1 : a.localeCompare(b)
    );
    const reports = [];
    for (const config of configs) {
      const result = await checked(
        process.execPath,
        [cli, 'test', '--config', resolve(repo, config), '--list', '--reporter=json'],
        { env: cleanEnv, capture: true }
      );
      reports.push({ config, report: JSON.parse(result.stdout) });
    }
    const jobs = planJobs(reports, { repo, files: options.files }).filter(
      (job) => options.phase === 'all' || job.exclusive === (options.phase === 'serial')
    );
    if (!jobs.length) throw new Error('The selected queue contains no specs.');
    summary.jobs = jobs;
    summary.expectedCases = jobs.reduce((sum, job) => sum + job.cases.length, 0);
    console.log(
      `${jobs.length} spec/project jobs, ${summary.expectedCases} cases: ${
        jobs.filter((job) => !job.exclusive).length
      } parallel, ${jobs.filter((job) => job.exclusive).length} exclusive.`
    );
    if (options.list) {
      for (const job of jobs)
        console.log(
          `${job.exclusive ? 'serial  ' : 'parallel'} ${job.project.padEnd(8)} ${job.file} (${
            job.cases.length
          })`
        );
      return 0;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeSummary();
    console.log(`Artifacts: ${directory}`);

    if (options.dockerBrowsers && process.platform !== 'linux')
      throw new Error('--docker-browsers requires Linux host networking.');
    const version = JSON.parse(
      await readFile(resolve(repo, 'node_modules/@playwright/test/package.json'), 'utf8')
    ).version;
    const browserImage =
      process.env.E2E_PLAYWRIGHT_IMAGE ?? `mcr.microsoft.com/playwright:v${version}-noble`;
    if (options.dockerBrowsers) {
      const image = await manager.run('docker', ['image', 'inspect', browserImage], {
        logFile: resolve(directory, 'browser-image.log'),
      });
      if (image.code !== 0)
        await checked('docker', ['pull', browserImage], {
          logFile: resolve(directory, 'browser-image.log'),
        });
    }

    const matrixPort = await unusedPort();
    const homeserver = `http://127.0.0.1:${matrixPort}`;
    composeEnv = {
      E2E_MATRIX_PORT: `127.0.0.1:${matrixPort}`,
      E2E_MATRIX_SERVER_NAME: 'matrix.localhost',
      E2E_HOMESERVER_PUBLIC_URL: homeserver,
    };
    composeArgs = [
      'compose',
      '-p',
      `mindroom-e2e-${runId}`,
      '-f',
      resolve(repo, 'e2e/docker-compose.matrix.yaml'),
    ];
    composeStarted = true;
    await checked('docker', [...composeArgs, 'up', '-d'], {
      env: composeEnv,
      logFile: resolve(directory, 'matrix.log'),
    });
    await waitForServer(`${homeserver}/_matrix/client/versions`, null, abort.signal);

    let productionURL = options.productionURL;
    if (!productionURL) {
      if (!options.skipBuild)
        await checked('npm', ['run', 'build'], { logFile: resolve(directory, 'build.log') });
      await access(resolve(repo, 'dist/index.html'));
      const site = resolve(directory, 'site');
      await cp(resolve(repo, 'dist'), site, { recursive: true });
      const port = await unusedPort();
      productionURL = `http://127.0.0.1:${port}`;
      const preview = manager.start(
        process.execPath,
        [
          vite,
          'preview',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
          '--outDir',
          site,
        ],
        { logFile: resolve(directory, 'preview.log') }
      );
      await waitForServer(productionURL, preview, abort.signal);
    } else await waitForServer(productionURL, null, abort.signal);

    const developmentPort = await unusedPort();
    const developmentURL = `http://127.0.0.1:${developmentPort}`;
    const development = manager.start(
      process.execPath,
      [vite, '--host', '127.0.0.1', '--port', String(developmentPort), '--strictPort'],
      { logFile: resolve(directory, 'vite.log') }
    );
    await waitForServer(developmentURL, development, abort.signal);

    const execute = async (job) => {
      const index = jobs.indexOf(job);
      const label = `${String(index + 1).padStart(3, '0')}-${job.file.replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      )}-${job.project}`;
      const jobDirectory = resolve(directory, label);
      await mkdir(jobDirectory, { recursive: true, mode: 0o700 });
      const start = Date.now();
      console.log(`START ${index + 1}/${jobs.length} ${job.project} ${job.file}`);
      const env = { ...cleanEnv, E2E_BASE_URL: productionURL };
      if (job.file === 'e2e/worker-computer.spec.ts') {
        if (!options.computerFixture)
          return {
            status: 'blocked',
            reason: 'Supply --computer-fixture and its matching --production-url.',
            directory: jobDirectory,
          };
        const fixturePath = resolve(options.computerFixture);
        const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
        for (const key of ['api_origin', 'ui_origin', 'homeserver']) requireLoopback(fixture[key]);
        if (new URL(fixture.ui_origin).origin !== productionURL)
          return {
            status: 'blocked',
            reason: 'Worker fixture ui_origin must match --production-url.',
            directory: jobDirectory,
          };
        env.E2E_COMPUTER_FIXTURE = fixturePath;
      } else if (job.file === 'e2e/deployed-auth-shell.spec.ts') {
        if (!options.ssoHomeserver)
          return {
            status: 'blocked',
            reason: 'Supply --sso-homeserver for the hosted SSO shell checks.',
            directory: jobDirectory,
          };
        env.E2E_HOMESERVER = options.ssoHomeserver;
      } else {
        Object.assign(
          env,
          await provisionSpec({
            file: job.file,
            homeserver,
            runId,
            index,
            productionURL,
            developmentURL,
            signal: abort.signal,
            runSeed: async (script, seedEnv) =>
              checked(process.execPath, [resolve(repo, script)], {
                env: { ...cleanEnv, ...seedEnv },
                logFile: resolve(jobDirectory, 'setup.log'),
              }),
          })
        );
      }
      const source = await readFile(resolve(repo, job.file), 'utf8');
      if (usesDevelopmentServer(job.file, source)) env.E2E_BASE_URL = developmentURL;
      env.PLAYWRIGHT_JSON_OUTPUT_FILE = resolve(jobDirectory, 'report.json');
      const pattern = resolve(repo, job.file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
      const args = [
        cli,
        'test',
        pattern,
        '--config',
        resolve(repo, job.config),
        '--project',
        job.project,
        '--workers=1',
        '--retries=0',
        '--reporter=list,json',
        '--output',
        resolve(jobDirectory, 'test-results'),
      ];
      // Legacy relative screenshot paths, including release captures, stay inside this job.
      const jobManager = createProcessManager({ cwd: jobDirectory, signal: abort.signal });
      managers.push(jobManager);
      let outcome;
      let containerName;
      try {
        if (options.dockerBrowsers) {
          const name = `mindroom-e2e-browser-${runId}-${index}`;
          containerName = name;
          containers.add(name);
          const mountArgs = ['-v', `${repo}:${repo}`];
          if (!directory.startsWith(repo + sep)) mountArgs.push('-v', `${directory}:${directory}`);
          if (
            env.E2E_COMPUTER_FIXTURE &&
            !env.E2E_COMPUTER_FIXTURE.startsWith(repo + sep) &&
            !env.E2E_COMPUTER_FIXTURE.startsWith(directory + sep)
          ) {
            mountArgs.push('-v', `${env.E2E_COMPUTER_FIXTURE}:${env.E2E_COMPUTER_FIXTURE}:ro`);
          }
          outcome = await jobManager.run(
            'docker',
            [
              'run',
              '--rm',
              '--init',
              '--name',
              name,
              '--network',
              'host',
              '--ipc',
              'host',
              '--user',
              `${process.getuid()}:${process.getgid()}`,
              ...mountArgs,
              '-w',
              jobDirectory,
              ...Object.keys(env)
                .filter((key) => env[key] !== undefined)
                .flatMap((key) => ['-e', key]),
              browserImage,
              'node',
              ...args,
            ],
            { env, logFile: resolve(jobDirectory, 'playwright.log'), timeoutMs: 45 * 60_000 }
          );
          containers.delete(name);
        } else {
          outcome = await jobManager.run(process.execPath, args, {
            env,
            logFile: resolve(jobDirectory, 'playwright.log'),
            timeoutMs: 45 * 60_000,
          });
        }
      } finally {
        await jobManager.stopAll();
        managers.splice(managers.indexOf(jobManager), 1);
        if (containerName && containers.has(containerName)) {
          const cleanup = createProcessManager({ cwd: repo });
          const stopped = await cleanup
            .run('docker', ['rm', '-f', containerName], {
              logFile: resolve(jobDirectory, 'container-cleanup.log'),
              timeoutMs: 30_000,
            })
            .catch(() => null);
          if (stopped?.code === 0) containers.delete(containerName);
          await cleanup.stopAll();
        }
      }
      let report;
      try {
        report = JSON.parse(await readFile(env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'utf8'));
      } catch {
        /* Missing or invalid reports fail below. */
      }
      return {
        ...summarizeJob(job, report, outcome.code),
        exitCode: outcome.code,
        seconds: Math.round((Date.now() - start) / 1000),
        directory: jobDirectory,
      };
    };
    await runJobs(jobs, {
      concurrency: options.jobs,
      execute,
      signal: abort.signal,
      onResult: async (result) => {
        summary.results.push(result);
        console.log(
          `${result.status.toUpperCase()} ${result.project} ${result.file}${
            result.reason ? `: ${result.reason}` : ''
          }`
        );
        await writeSummary();
      },
    });
    summary.counts = summary.results.reduce((counts, result) => {
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      return counts;
    }, {});
    summary.caseCounts = summary.results.reduce(
      (counts, result) => {
        for (const [key, count] of Object.entries(result.counts ?? {}))
          counts[key] = (counts[key] ?? 0) + count;
        if (!result.counts) counts.unrun += jobs.find((job) => job.id === result.id).cases.length;
        return counts;
      },
      { passed: 0, failed: 0, skipped: 0, missing: 0, unrun: 0 }
    );
    summary.finishedAt = new Date().toISOString();
    await writeSummary();
    console.log(
      `Cases: ${JSON.stringify(summary.caseCounts)}. Jobs: ${JSON.stringify(summary.counts)}`
    );
    exitCode = abort.signal.aborted
      ? 130
      : summary.results.every((result) => result.status === 'passed')
      ? 0
      : 1;
  } catch (error) {
    if (!options.list) {
      summary.error = String(error.message ?? error);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeSummary();
    }
    console.error(error.message ?? error);
    exitCode = abort.signal.aborted ? 130 : 1;
  } finally {
    await Promise.all(managers.map((item) => item.stopAll()));
    const cleanup = createProcessManager({ cwd: repo });
    for (const name of containers) await cleanup.run('docker', ['rm', '-f', name]).catch(() => {});
    if (composeStarted) {
      const result = await cleanup
        .run('docker', [...composeArgs, 'down', '--volumes'], {
          env: composeEnv,
          logFile: resolve(directory, 'matrix-cleanup.log'),
        })
        .catch(() => null);
      if (!result || result.code !== 0) {
        summary.cleanupError = `Matrix cleanup failed; see ${resolve(
          directory,
          'matrix-cleanup.log'
        )}`;
        console.error(summary.cleanupError);
        await writeSummary();
      }
    }
    await cleanup.stopAll();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (summary.cleanupError) exitCode = 1;
  }
  return exitCode;
}

let options;
try {
  const args = process.argv.slice(2);
  if (process.env.E2E_SSO_HOMESERVER && !args.includes('--sso-homeserver'))
    args.push('--sso-homeserver', process.env.E2E_SSO_HOMESERVER);
  options = parseArguments(args);
  options.computerFixture ??= process.env.E2E_COMPUTER_FIXTURE;
} catch (error) {
  console.error(error.message);
  process.exitCode = 64;
}
if (options?.help) console.log(help);
else if (options) process.exitCode = await main(options);
