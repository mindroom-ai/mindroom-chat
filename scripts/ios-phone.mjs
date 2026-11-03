// @ts-check
// Builds the iOS app and runs it on a connected iPhone (or the given simulator or device):
// the iOS web build with its bundled config, a Capacitor sync, then `cap run ios`.
//
// Usage: node scripts/ios-phone.mjs [device id]   (or IOS_DEVICE_ID=...)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    );
  });

const target = process.argv[2] ?? process.env.IOS_DEVICE_ID;

await run('npm', ['run', 'build:ios']);
await run('npx', ['cap', 'sync', 'ios']);
await run('npx', ['cap', 'run', 'ios', ...(target ? ['--target', target] : [])]);
