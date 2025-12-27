import { spawn } from 'child_process';
import { TestGenerationContext, GeneratedTest } from './IAiProvider';
import { BaseAiProvider } from './BaseAiProvider';
import { AiProvider } from '../../domain';

/**
 * Claude provider for test generation.
 * Uses Claude CLI (claude-code) in agentic mode.
 */
export class ClaudeProvider extends BaseAiProvider {
  readonly name: AiProvider = 'claude';

  async generateTests(context: TestGenerationContext): Promise<GeneratedTest> {
    const prompt = this.buildPrompt(context);

    // Run Claude in agentic mode - it will create/modify files directly
    await this.callClaude(prompt, context.projectDir);

    // AI agent writes files directly, we just return a placeholder
    return {
      testContent: '',
      testFilePath: '',
    };
  }

  async isAvailable(): Promise<boolean> {
    // Check if API key is set OR if CLI is authenticated (for local dev)
    if (process.env.ANTHROPIC_API_KEY) {
      return true;
    }
    // Check if Claude CLI is authenticated by trying a simple prompt
    try {
      await this.executeCommand('claude', ['-p', 'say ok', '--tools', '']);
      return true;
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

  private async callClaude(prompt: string, workDir?: string): Promise<string> {
    // Use Claude CLI (claude-code) in agentic mode (without -p)
    // --dangerously-skip-permissions allows auto-approval of file writes
    const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || '300000', 10); // 5 min default

    return new Promise((resolve, reject) => {
      console.log('[ClaudeProvider] Starting Claude CLI in agentic mode...');

      // Agentic mode: Claude will create/modify files directly
      // --dangerously-skip-permissions: auto-approve all tool calls
      // --allowedTools: restrict to file operations only (+ Glob for exploration)
      // NO -p flag - we want agentic mode with tool use, not print mode!
      const args = [
        '--dangerously-skip-permissions', // Auto-approve file operations
        '--allowedTools', 'Write,Edit,Read,Glob,Grep', // File tools + exploration (no Bash for safety)
        '--model', 'haiku', // Use Haiku for fast execution
        '--output-format', 'text',
      ];

      const proc = spawn('claude', args, {
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
        cwd: workDir,
      });

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`[ClaudeProvider] CLI exited with code ${code}`);
        // Accept exit code 0 or 1 (Claude sometimes exits with 1 even on success)
        if (code === 0 || code === 1) {
          resolve(stdout);
        } else {
          reject(new Error(`Claude CLI failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Claude CLI not found or failed: ${err.message}`));
      });

      // Write prompt via stdin (avoids command line length limits)
      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }
}
