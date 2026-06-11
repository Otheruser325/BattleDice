import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let buildFailed = false;

function run(command, args) {
  if (buildFailed) {
    // Skip remaining commands if build already failed
    return;
  }
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    // Handle ENOENT (command not found) or other spawn errors
    const error = new Error(`${command} ${args.join(' ')} failed: ${result.error.code || result.error.message}`);
    error.exitCode = 127; // Command not found
    throw error;
  }
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
  buildFailed = true;
  console.error(error.message);
  process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
} finally {
  if (!buildFailed) {
    try {
      run(npmCommand, ['run', 'launcher:clean']);
    } catch (cleanupError) {
      // Cleanup failure after successful build - log but don't fail the build
      console.error(cleanupError.message);
    }
  } else {
    // Build failed - still attempt cleanup but don't fail on cleanup errors
    try {
      run(npmCommand, ['run', 'launcher:clean']);
    } catch {
      // Ignore cleanup errors on failed build
    }
  }
}
