import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';
import { Injectable } from '@nestjs/common';
import { ISandbox, SandboxAnalysisResult, SandboxTestResult } from './ISandbox';

// Force rebuild when entrypoint changes (increment this when updating docker/sandbox/*)
const SANDBOX_VERSION = '2';

const SANDBOX_IMAGE_BASE = 'coverage-improver-sandbox';
const SANDBOX_IMAGE = `${SANDBOX_IMAGE_BASE}:v${SANDBOX_VERSION}`;
const CONTAINER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MEMORY_LIMIT = 2 * 1024 * 1024 * 1024; // 2GB
const CPU_PERIOD = 100000;
const CPU_QUOTA = 200000; // 2 CPUs

@Injectable()
export class DockerSandbox implements ISandbox {
  private docker: Docker;
  private imageBuilt = false;

  constructor() {
    this.docker = new Docker();
  }

  async runAnalysis(options: {
    repoUrl: string;
    branch: string;
    onProgress?: (message: string) => void;
  }): Promise<SandboxAnalysisResult> {
    const { repoUrl, branch, onProgress } = options;
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      onProgress?.(msg);
    };

    try {
      await this.ensureImageBuilt();

      const outputDir = await this.createTempDir('sandbox-output');

      log(`Starting analysis sandbox for ${repoUrl} (${branch})`);

      const container = await this.docker.createContainer({
        Image: SANDBOX_IMAGE,
        Cmd: ['analyze', repoUrl, branch],
        HostConfig: {
          Memory: MEMORY_LIMIT,
          CpuPeriod: CPU_PERIOD,
          CpuQuota: CPU_QUOTA,
          Binds: [`${outputDir}:/output:rw`],
          AutoRemove: true,
          NetworkMode: 'bridge', // Allow network for git clone
        },
      });

      await container.start();

      // Stream logs
      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

      stream.on('data', (chunk: Buffer) => {
        const line = chunk.toString().replace(/[\x00-\x08]/g, '').trim();
        if (line) log(line);
      });

      // Wait for container to finish with timeout
      const exitCode = await this.waitWithTimeout(container, CONTAINER_TIMEOUT_MS);

      if (exitCode !== 0) {
        log(`Container exited with code ${exitCode}`);
      }

      // Read results
      log(`Reading results from ${outputDir}`);

      // Debug: List output directory contents
      try {
        const outputContents = await fs.promises.readdir(outputDir);
        log(`Output dir contents: ${outputContents.join(', ')}`);

        const coverageDir = path.join(outputDir, 'coverage');
        if (fs.existsSync(coverageDir)) {
          const coverageContents = await fs.promises.readdir(coverageDir);
          log(`Coverage dir contents: ${coverageContents.join(', ')}`);
        } else {
          log('No coverage directory found in output');
        }
      } catch (e) {
        log(`Error listing output: ${e}`);
      }

      const coverageJson = await this.readCoverageJson(outputDir);
      log(`Coverage JSON loaded: ${coverageJson ? 'yes' : 'no'}`);

      const sourceFiles = await this.readSourceFiles(outputDir);
      log(`Source files found: ${sourceFiles.length}`);

      // Cleanup
      await this.cleanupDir(outputDir);

      return {
        success: coverageJson !== undefined || sourceFiles.length > 0,
        coverageJson,
        sourceFiles,
        logs,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`Error: ${errorMsg}`);
      return {
        success: false,
        logs,
        error: errorMsg,
      };
    }
  }

  async runTests(options: {
    repoUrl: string;
    branch: string;
    testFiles: Array<{ path: string; content: string }>;
    onProgress?: (message: string) => void;
  }): Promise<SandboxTestResult> {
    const { repoUrl, branch, testFiles, onProgress } = options;
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      onProgress?.(msg);
    };

    try {
      await this.ensureImageBuilt();

      const inputDir = await this.createTempDir('sandbox-input');
      const outputDir = await this.createTempDir('sandbox-output');

      // Write test files to input directory
      for (const file of testFiles) {
        const filePath = path.join(inputDir, file.path);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, file.content);
      }

      log(`Starting test sandbox for ${repoUrl} (${branch})`);
      log(`Test files: ${testFiles.map(f => f.path).join(', ')}`);

      const container = await this.docker.createContainer({
        Image: SANDBOX_IMAGE,
        Cmd: ['test', repoUrl, branch],
        HostConfig: {
          Memory: MEMORY_LIMIT,
          CpuPeriod: CPU_PERIOD,
          CpuQuota: CPU_QUOTA,
          Binds: [
            `${inputDir}:/input:ro`,
            `${outputDir}:/output:rw`,
          ],
          AutoRemove: true,
          NetworkMode: 'bridge',
        },
      });

      await container.start();

      // Stream logs
      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

      stream.on('data', (chunk: Buffer) => {
        const line = chunk.toString().replace(/[\x00-\x08]/g, '').trim();
        if (line) log(line);
      });

      // Wait for container to finish with timeout
      const exitCode = await this.waitWithTimeout(container, CONTAINER_TIMEOUT_MS);

      log(`Container exited with code ${exitCode}`);

      // Read results
      const testsPassed = await this.readTestResult(outputDir);
      const coverageJson = await this.readCoverageJson(outputDir);

      // Cleanup
      await this.cleanupDir(inputDir);
      await this.cleanupDir(outputDir);

      return {
        success: true,
        testsPassed,
        coverageJson,
        logs,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`Error: ${errorMsg}`);
      return {
        success: false,
        testsPassed: false,
        logs,
        error: errorMsg,
      };
    }
  }

  private async ensureImageBuilt(): Promise<void> {
    if (this.imageBuilt) return;

    // Check if image already exists
    try {
      await this.docker.getImage(SANDBOX_IMAGE).inspect();
      this.imageBuilt = true;
      return;
    } catch {
      // Image doesn't exist, need to build
    }

    // Build the image
    const dockerfilePath = path.join(__dirname, '../../../docker/sandbox');

    if (!fs.existsSync(path.join(dockerfilePath, 'Dockerfile'))) {
      throw new Error(`Dockerfile not found at ${dockerfilePath}. Please build the sandbox image first.`);
    }

    const tarStream = await this.createTarStream(dockerfilePath);
    const stream = await this.docker.buildImage(tarStream, {
      t: SANDBOX_IMAGE,
    });

    // Wait for build to complete
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.imageBuilt = true;
  }

  private async createTarStream(dir: string): Promise<NodeJS.ReadableStream> {
    const files = await fs.promises.readdir(dir);
    // tar.create returns a Pack which is a stream
    return tar.create(
      { gzip: false, cwd: dir },
      files
    ) as unknown as NodeJS.ReadableStream;
  }

  private async waitWithTimeout(container: Docker.Container, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        try {
          await container.kill();
        } catch {
          // Container may already be stopped
        }
        reject(new Error('Container timeout exceeded'));
      }, timeoutMs);

      container.wait().then((result) => {
        clearTimeout(timeout);
        resolve(result.StatusCode);
      }).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private async createTempDir(prefix: string): Promise<string> {
    // Use shared volume path when running in Docker (for DinD volume mounting to work)
    const baseDir = process.env.NODE_ENV === 'production'
      ? '/tmp/coverage-improver'
      : os.tmpdir();
    await fs.promises.mkdir(baseDir, { recursive: true });
    return fs.promises.mkdtemp(path.join(baseDir, `${prefix}-`));
  }

  private async cleanupDir(dir: string): Promise<void> {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  private async readCoverageJson(outputDir: string): Promise<Record<string, unknown> | undefined> {
    const coveragePath = path.join(outputDir, 'coverage', 'coverage-final.json');
    try {
      const content = await fs.promises.readFile(coveragePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  private async readSourceFiles(outputDir: string): Promise<Array<{ path: string; content: string }>> {
    const tarPath = path.join(outputDir, 'sources.tar');
    const extractDir = path.join(outputDir, 'sources');
    const sourceFiles: Array<{ path: string; content: string }> = [];

    try {
      if (!fs.existsSync(tarPath)) {
        return sourceFiles;
      }

      await fs.promises.mkdir(extractDir, { recursive: true });
      await tar.extract({ file: tarPath, cwd: extractDir });

      const files = await this.findFilesRecursive(extractDir);
      for (const file of files) {
        const relativePath = path.relative(extractDir, file);
        const content = await fs.promises.readFile(file, 'utf-8');
        sourceFiles.push({ path: relativePath, content });
      }
    } catch {
      // Ignore errors reading source files
    }

    return sourceFiles;
  }

  private async findFilesRecursive(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.findFilesRecursive(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  private async readTestResult(outputDir: string): Promise<boolean> {
    const resultPath = path.join(outputDir, 'result.txt');
    try {
      const content = await fs.promises.readFile(resultPath, 'utf-8');
      return content.includes('TESTS_PASSED=true');
    } catch {
      return false;
    }
  }
}
