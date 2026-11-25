const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('app-builder-lib');

const HELPER_APP_NAME = 'MindRoom Desktop Helper.app';
const HELPER_EXEC_REL = path.join('Contents', 'MacOS', 'MindRoom Desktop Helper');
const DEFAULT_STAGED_HELPER = path.resolve(__dirname, '../build/electron', HELPER_APP_NAME);

function shouldBundleHelper(context) {
  if (context.electronPlatformName !== 'darwin') return false;
  const isArmOrUniversal =
    context.arch === Arch.arm64 ||
    context.arch === Arch.universal ||
    context.arch === 'arm64' ||
    context.arch === 'universal';
  if (!isArmOrUniversal) return false;
  return !/-(arm64|x64)-temp$/.test(path.resolve(context.appOutDir));
}

/** @param {import('app-builder-lib').AfterPackContext} context */
module.exports = async function afterPack(context) {
  if (!shouldBundleHelper(context)) return;

  const sign = process.env.MINDROOM_DESKTOP_SIGN === '1';
  const src = sign
    ? DEFAULT_STAGED_HELPER
    : process.env.MINDROOM_DESKTOP_HELPER_STAGED || DEFAULT_STAGED_HELPER;

  if (!fs.existsSync(src)) {
    if (sign) {
      throw new Error(`Missing staged ${HELPER_APP_NAME} for signed build: ${src}`);
    }
    return;
  }

  const execPath = path.join(src, HELPER_EXEC_REL);
  if (!fs.existsSync(execPath)) {
    throw new Error(`Invalid ${HELPER_APP_NAME} bundle at ${src}: missing ${HELPER_EXEC_REL}`);
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const dest = path.join(context.appOutDir, appName, 'Contents', 'Helpers', HELPER_APP_NAME);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
};
