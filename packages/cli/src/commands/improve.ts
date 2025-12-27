import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { createJob, getJob, getCoverage, setApiUrl } from '../api.js';
import type { AiProvider } from '../types.js';

export const improveCommand = new Command('improve')
  .description('Start test improvement jobs for files')
  .requiredOption('--repo-id <id>', 'Repository ID')
  .option('--file-id <id>', 'Single file ID to improve')
  .option('--file-ids <ids>', 'Comma-separated file IDs to improve')
  .option('--all-below <threshold>', 'Improve all files below threshold %')
  .option('-p, --provider <provider>', 'AI provider (claude or openai)', 'claude')
  .option('-w, --wait', 'Wait for job completion', false)
  .action(async (options: {
    repoId: string;
    fileId?: string;
    fileIds?: string;
    allBelow?: string;
    provider: string;
    wait: boolean;
  }) => {
    const parent = improveCommand.parent;
    if (parent?.opts().apiUrl) {
      setApiUrl(parent.opts().apiUrl);
    }

    const provider = options.provider as AiProvider;
    if (provider !== 'claude' && provider !== 'openai') {
      console.error(chalk.red('Provider must be "claude" or "openai"'));
      process.exit(1);
    }

    // Determine which files to improve
    let fileIds: string[] = [];

    if (options.fileId) {
      fileIds = [options.fileId];
    } else if (options.fileIds) {
      fileIds = options.fileIds.split(',').map((id: string) => id.trim());
    } else if (options.allBelow) {
      const threshold = parseInt(options.allBelow, 10);
      const spinner = ora('Finding files below threshold...').start();

      try {
        const report = await getCoverage(options.repoId);
        fileIds = report.files
          .filter((f) => f.coveragePercentage < threshold && f.status === 'pending')
          .map((f) => f.id);

        if (fileIds.length === 0) {
          spinner.succeed(chalk.green(`No files below ${threshold}% coverage need improvement`));
          return;
        }

        spinner.succeed(`Found ${fileIds.length} files below ${threshold}%`);
      } catch (error) {
        spinner.fail('Failed to get coverage report');
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
        process.exit(1);
      }
    }

    if (fileIds.length === 0) {
      console.error(chalk.red('Specify --file-id, --file-ids, or --all-below'));
      process.exit(1);
    }

    const spinner = ora(`Creating improvement job for ${fileIds.length} file${fileIds.length > 1 ? 's' : ''} with ${provider}...`).start();

    try {
      // Create a single job for all files
      const job = await createJob(options.repoId, fileIds, provider);
      spinner.succeed(`Job created: ${job.id}`);

      console.log();
      console.log(chalk.bold('Job Details'));
      console.log(`  ID: ${job.id}`);
      console.log(`  Files: ${job.fileCount}`);
      if (job.fileCount <= 5) {
        for (const path of job.filePaths) {
          console.log(`    - ${path}`);
        }
      } else {
        for (const path of job.filePaths.slice(0, 3)) {
          console.log(`    - ${path}`);
        }
        console.log(chalk.gray(`    ... and ${job.fileCount - 3} more`));
      }
      console.log(`  Provider: ${job.aiProvider}`);
      console.log(`  Status: ${chalk.yellow(job.status)}`);

      if (options.wait) {
        console.log();
        await waitForJob(job.id, spinner);
      } else {
        console.log();
        console.log(chalk.gray(`Use 'cov status ${job.id}' to check progress`));
      }
    } catch (error) {
      spinner.fail('Failed to create job');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

async function waitForJob(jobId: string, spinner: Ora): Promise<void> {
  spinner.start('Waiting for job completion...');

  let lastProgress = 0;

  while (true) {
    const job = await getJob(jobId);

    if (job.progress !== lastProgress) {
      spinner.text = `Progress: ${job.progress}% - ${getProgressMessage(job.progress)}`;
      lastProgress = job.progress;
    }

    if (job.status === 'completed') {
      spinner.succeed(`Job completed successfully! (${job.fileCount} file${job.fileCount > 1 ? 's' : ''})`);
      console.log();
      console.log(chalk.green.bold('Pull Request Created:'));
      console.log(`  ${chalk.underline(job.prUrl)}`);
      return;
    }

    if (job.status === 'failed') {
      spinner.fail('Job failed');
      console.error(chalk.red(`Error: ${job.error}`));
      process.exit(1);
    }

    if (job.status === 'cancelled') {
      spinner.warn('Job was cancelled');
      return;
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function getProgressMessage(progress: number): string {
  if (progress < 10) return 'Starting...';
  if (progress < 20) return 'Cloning repository...';
  if (progress < 30) return 'Creating branch...';
  if (progress < 50) return 'Generating tests with AI...';
  if (progress < 70) return 'Validating tests...';
  if (progress < 85) return 'Committing changes...';
  if (progress < 95) return 'Creating pull request...';
  return 'Finalizing...';
}
