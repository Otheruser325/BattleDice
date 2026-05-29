import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let exitCode = 0;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    error.exitCode = result.status;
    throw error;
  }
  if (result.signal) {
    const error = new Error(`${command} ${args.join(' ')} exited with signal ${result.signal}`);
    error.exitCode = 1;
    throw error;
  }
}

try {
  run('tsc', ['--noEmit']);
  run(npmCommand, ['run', 'launcher:prepare']);
  run('vite', ['build']);
} catch (error) {
  exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  console.error(error.message);
} finally {
  try {
    run(npmCommand, ['run', 'launcher:clean']);
  } catch (cleanupError) {
    exitCode = exitCode || (Number.isInteger(cleanupError.exitCode) ? cleanupError.exitCode : 1);
    console.error(cleanupError.message);
  }
}

process.exitCode = exitCode;
