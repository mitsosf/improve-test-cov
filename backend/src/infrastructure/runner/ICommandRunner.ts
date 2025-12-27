/**
 * Port for running shell commands
 * Infrastructure provides the adapter implementation
 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ICommandRunner {
  /**
   * Detect which package manager is used in the project
   */
  detectPackageManager(workDir: string): PackageManager;

  /**
   * Install dependencies in the project
   */
  installDependencies(workDir: string, packageManager?: PackageManager): Promise<CommandResult>;

  /**
   * Run tests with coverage
   */
  runTestsWithCoverage(
    workDir: string,
    packageManager?: PackageManager,
    hasTestScript?: boolean
  ): Promise<CommandResult>;

  /**
   * Detect which test framework is installed in the project
   */
  detectTestFramework(workDir: string): 'vitest' | 'jest' | null;

  /**
   * Execute a command and return the result
   */
  execute(command: string, args: string[], workDir: string, timeoutMs?: number): Promise<CommandResult>;
}

export const COMMAND_RUNNER = Symbol('ICommandRunner');
