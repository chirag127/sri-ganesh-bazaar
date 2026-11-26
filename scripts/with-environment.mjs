import { spawn } from 'node:child_process';
import { stat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.mjs';

const defaultAppDir = fileURLToPath(new URL('../', import.meta.url));
const usage = 'Usage: node scripts/with-environment.mjs --profile frontend|commerce-server|admin-alerts [--app-dir ABSOLUTE_DIR] [--shared ABSOLUTE_FILE] [--npm-cli ABSOLUTE_FILE] -- COMMAND [ARG ...]';

function parseArguments(argv) {
  const options = { appDir: defaultAppDir };
  const fields = { '--profile': 'profile', '--app-dir': 'appDir', '--shared': 'sharedPath', '--npm-cli': 'npmCli' };
  const seen = new Set();
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i += 2) {
    const flag = argv[i];
    if (!Object.hasOwn(fields, flag) || seen.has(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(usage);
    seen.add(flag);
    options[fields[flag]] = argv[i + 1];
  }
  if (!options.profile || argv[i] !== '--' || !argv[i + 1]) throw new Error(usage);
  return { options, command: argv[i + 1], args: argv.slice(i + 2) };
}

async function resolveNpm(explicit) {
  if (explicit !== undefined && !isAbsolute(explicit)) throw new Error('npm CLI path must be absolute');
  const nodeDir = dirname(await realpath(process.execPath));
  // Invoke npm's JS entry point with Node: .cmd shims require a shell on Windows.
  // Do not interpolate argv into cmd.exe or trust a CLI path from an env file.
  const candidates = explicit !== undefined ? [explicit] : [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const path of candidates) {
    try { if ((await stat(path)).isFile()) return path; }
    catch { /* Try the next installed layout, without inspecting environment files. */ }
  }
  throw new Error('Installed npm CLI not found; provide --npm-cli with its absolute npm-cli.js path');
}

async function main() {
  let options, command, args, env;
  try {
    ({ options, command, args } = parseArguments(process.argv.slice(2)));
    env = await loadEnvironment(options);
    if (command === 'npm' || command === 'npm.cmd') {
      args = [await resolveNpm(options.npmCli), ...args];
      command = process.execPath;
    } else if (/\.(?:cmd|bat)$/i.test(command)) {
      throw new Error('Batch commands require a shell; use an executable or a Node entry point');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  let child;
  try { child = spawn(command, args, { cwd: options.appDir, env, shell: false, stdio: 'inherit' }); }
  catch { console.error('Cannot start command'); process.exitCode = 126; return; }
  const forward = signal => { if (!child.killed) child.kill(signal); };
  const onInterrupt = () => forward('SIGINT');
  const onTerminate = () => forward('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  child.once('error', error => {
    console.error('Cannot start command');
    process.exitCode = error.code === 'ENOENT' ? 127 : 126;
  });
  child.once('close', (code, signal) => {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    if (process.exitCode === undefined) process.exitCode = code ?? (128 + (constants.signals[signal] ?? 1));
  });
}

await main();
