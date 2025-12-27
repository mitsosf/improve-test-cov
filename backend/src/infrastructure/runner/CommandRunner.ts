import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ICommandRunner,
  PackageManager,
  CommandResult,
} from './ICommandRunner';

// Re-export types for backward compatibility
export { PackageManager, CommandResult };

/**
 * Service for running shell commands in a working directory.
 * Used for running tests with coverage in cloned repositories.
 * Implements ICommandRunner port from domain
 */
export class CommandRunner implements ICommandRunner {
  /**
   * Detect which package manager is used in the project
   */
  detectPackageManager(workDir: string): PackageManager {
    // Check for lock files in order of preference
    if (existsSync(join(workDir, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (existsSync(join(workDir, 'yarn.lock'))) {
      return 'yarn';
    }
    // Default to npm
    return 'npm';
  }

  /**
   * Install dependencies in the project
   */
  async installDependencies(workDir: string, packageManager?: PackageManager): Promise<CommandResult> {
    const pm = packageManager || this.detectPackageManager(workDir);

    // Use --ignore-scripts to skip prepare/postinstall hooks like husky
    // We only need deps installed to run tests, not git hooks
    // Include dev dependencies since test frameworks (jest, vitest) are typically devDeps
    switch (pm) {
      case 'pnpm':
        return this.execute('pnpm', ['install', '--ignore-scripts', '--dev'], workDir);
      case 'yarn':
        return this.execute('yarn', ['install', '--ignore-scripts', '--production=false'], workDir);
      case 'npm':
      default:
        // --include=dev ensures devDependencies are installed even if NODE_ENV=production
        return this.execute('npm', ['install', '--ignore-scripts', '--include=dev'], workDir);
    }
  }

  /**
   * Run tests with coverage
   * @param hasTestScript - If false, will try running tests directly with npx vitest/jest
   */
  async runTestsWithCoverage(
    workDir: string,
    packageManager?: PackageManager,
    hasTestScript: boolean = true
  ): Promise<CommandResult> {
    const pm = packageManager || this.detectPackageManager(workDir);

    // Coverage flags to ensure files are written (not just console output)
    // Note: --collectCoverage=true forces collection even if config says false
    // --coverageDirectory forces output to current working dir (the cloned repo)
    const coverageFlags = [
      '--coverage',
      '--collectCoverage=true',
      '--coverageDirectory=./coverage',
      '--coverageReporters=text',
      '--coverageReporters=json',
      '--coverageReporters=lcov',
      '--passWithNoTests',
      '--no-cache', // Force fresh test run without cache (does NOT exit)
      '--forceExit', // Force exit after tests complete
    ];

    // If there's no test script, check what test framework is installed
    if (!hasTestScript) {
      const testFramework = this.detectTestFramework(workDir);
      console.log('Detected test framework:', testFramework);

      if (testFramework === 'vitest') {
        console.log('Running vitest with coverage...');
        return this.execute('npx', ['vitest', 'run', ...coverageFlags], workDir);
      } else if (testFramework === 'jest') {
        console.log('Running jest with coverage...');
        return this.execute('npx', ['jest', ...coverageFlags], workDir);
      } else {
        console.log('No test framework detected, skipping tests');
        return { stdout: '', stderr: 'No test framework configured', exitCode: 0 };
      }
    }

    // Different package managers have slightly different syntax
    switch (pm) {
      case 'pnpm':
        return this.execute('pnpm', ['test', '--', ...coverageFlags], workDir);
      case 'yarn':
        return this.execute('yarn', ['test', ...coverageFlags], workDir);
      case 'npm':
      default:
        return this.execute('npm', ['test', '--', ...coverageFlags], workDir);
    }
  }

  /**
   * Detect which test framework is installed in the project
   */
  detectTestFramework(workDir: string): 'vitest' | 'jest' | null {
    const packageJsonPath = join(workDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return null;
    }

    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      // Check for vitest first (preferred for Vite projects)
      if (allDeps['vitest']) {
        return 'vitest';
      }

      // Check for jest
      if (allDeps['jest'] || allDeps['@jest/core']) {
        return 'jest';
      }

      // Check for vitest config file
      if (existsSync(join(workDir, 'vitest.config.ts')) || existsSync(join(workDir, 'vitest.config.js'))) {
        return 'vitest';
      }

      // Check for jest config file
      if (existsSync(join(workDir, 'jest.config.ts')) || existsSync(join(workDir, 'jest.config.js'))) {
        return 'jest';
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Execute a command and return the result
   */
  execute(command: string, args: string[], workDir: string, timeoutMs: number = 300000): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      // shell: true is needed for npm/pnpm to work correctly
      // The deprecation warning is not a security concern since we control the args
      const proc = spawn(command, args, {
        cwd: workDir,
        env: {
          ...process.env,
          // Disable interactive mode for CI environments
          CI: 'true',
          // Force color output off to avoid parsing issues
          FORCE_COLOR: '0',
        },
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
