import { spawn } from 'child_process';
import { TestGenerationContext, GeneratedTest } from './IAiProvider';
import { BaseAiProvider } from './BaseAiProvider';
import { AiProvider } from '../../domain';

/**
 * OpenAI provider for test generation.
 * Uses Codex CLI in agentic mode.
 */
export class OpenAiProvider extends BaseAiProvider {
  readonly name: AiProvider = 'openai';

  async generateTests(context: TestGenerationContext): Promise<GeneratedTest> {
    const prompt = this.buildPrompt(context);

    // Codex is agentic - it writes files directly
    await this.callCodex(prompt, context.projectDir);

    // AI agent writes files directly, we just return a placeholder
    return {
      testContent: '',
      testFilePath: '',
    };
  }

  async isAvailable(): Promise<boolean> {
    // Check if API key is set OR if CLI is authenticated (for local dev)
    if (process.env.OPENAI_API_KEY) {
      return true;
    }
    // Check if Codex CLI is authenticated
    try {
      const result = await this.executeCommand('codex', ['auth', 'status']);
      // If output contains "logged in" or similar, we're authenticated
      return result.toLowerCase().includes('logged in') || result.toLowerCase().includes('authenticated');
    } catch {
      return false;
    }
  }

  private executeCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);
      let stdout = '';
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Command failed with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  private async loginWithApiKey(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }

    return new Promise((resolve, reject) => {
      console.log('[OpenAiProvider] Authenticating with API key...');

      const proc = spawn('codex', ['login', '--with-api-key'], {
        env: process.env,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log('[OpenAiProvider] Authentication successful');
          resolve();
        } else {
          console.log(`[OpenAiProvider] Login failed: ${stderr}`);
          // Don't reject - maybe already logged in
          resolve();
        }
      });

      proc.on('error', (err) => {
        console.log(`[OpenAiProvider] Login error: ${err.message}`);
        resolve(); // Don't fail, try to continue
      });

      // Pipe API key via stdin
      proc.stdin.write(apiKey);
      proc.stdin.end();
    });
  }

  private async callCodex(prompt: string, workDir?: string): Promise<string> {
    // Codex is an agentic CLI that modifies files directly
    // Use exec with full sandbox access to allow file writes
    const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || '300000', 10); // 5 min default
    const outputFile = `/tmp/codex-output-${Date.now()}.txt`;

    // First, authenticate with API key (required for non-interactive/Docker)
    await this.loginWithApiKey();

    return new Promise((resolve, reject) => {
      console.log('[OpenAiProvider] Starting Codex CLI in agentic mode...');

      const args = [
        'exec',
        '-', // Read prompt from stdin
        '--sandbox', 'danger-full-access', // Full file access
        '--skip-git-repo-check', // Allow running without git
        '--output-last-message', outputFile, // Capture final message
      ];

      if (workDir) {
        args.push('-C', workDir);
      }

      const proc = spawn('codex', args, {
        env: {
          ...process.env,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        },
        cwd: workDir,
      });

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`[OpenAiProvider] CLI exited with code ${code}`);
        if (stderr) console.log(`[OpenAiProvider] stderr: ${stderr}`);
        if (stdout) console.log(`[OpenAiProvider] stdout: ${stdout}`);

        // Check for authentication errors - fail fast with clear message
        if (stdout.includes('token_expired') || stdout.includes('401 Unauthorized')) {
          reject(new Error('Codex authentication expired. Run "codex auth login" to re-authenticate.'));
          return;
        }

        // Try to read the output file if it exists
        try {
          const { readFileSync, unlinkSync, existsSync } = require('fs');
          if (existsSync(outputFile)) {
            const output = readFileSync(outputFile, 'utf-8');
            unlinkSync(outputFile);
            resolve(output || stdout);
            return;
          }
        } catch (e) {
          // Ignore, fall through to stdout
        }

        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Codex CLI failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Codex CLI not found or failed: ${err.message}`));
      });

      // Write prompt via stdin
      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

}
