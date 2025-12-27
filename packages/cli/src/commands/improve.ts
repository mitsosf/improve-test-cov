import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { createJob, createBulkJobs, getJob, getCoverage, setApiUrl } from '../api.js';
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

    const spinner = ora(`Creating improvement job(s) with ${provider}...`).start();

    try {
      if (fileIds.length === 1) {
        // Single file - use existing logic
        const job = await createJob(options.repoId, fileIds[0], provider);
        spinner.succeed(`Job created: ${job.id}`);

        console.log();
        console.log(chalk.bold('Job Details'));
        console.log(`  ID: ${job.id}`);
        console.log(`  File: ${job.filePath}`);
        console.log(`  Provider: ${job.aiProvider}`);
        console.log(`  Status: ${chalk.yellow(job.status)}`);

        if (options.wait) {
          console.log();
          await waitForJob(job.id, spinner);
        } else {
          console.log();
          console.log(chalk.gray(`Use 'cov status ${job.id}' to check progress`));
        }
      } else {
        // Multiple files - use bulk endpoint
        const result = await createBulkJobs(options.repoId, fileIds, provider);
        spinner.succeed(`Created ${result.created} jobs (${result.skipped} skipped - already active)`);

        console.log();
        console.log(chalk.bold('Bulk Job Summary'));
        console.log(`  Total requested: ${result.total}`);
        console.log(`  Created: ${chalk.green(result.created.toString())}`);
        console.log(`  Skipped: ${chalk.yellow(result.skipped.toString())}`);

        if (result.jobs.length > 0) {
          console.log();
          console.log(chalk.bold('Jobs Created:'));
          for (const job of result.jobs.slice(0, 10)) {
            console.log(`  ${job.id} - ${job.filePath}`);
          }
          if (result.jobs.length > 10) {
            console.log(chalk.gray(`  ... and ${result.jobs.length - 10} more`));
          }
        }

        if (options.wait && result.jobs.length > 0) {
          console.log();
          await waitForJobs(result.jobs.map((j) => j.id), spinner);
        } else if (result.jobs.length > 0) {
          console.log();
          console.log(chalk.gray(`Use 'cov status --repo-id ${options.repoId}' to check progress`));
        }
      }
    } catch (error) {
      spinner.fail('Failed to create job(s)');
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
      spinner.succeed('Job completed successfully!');
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
  if (progress < 40) return 'Reading source file...';
  if (progress < 60) return 'Generating tests with AI...';
  if (progress < 70) return 'Writing test file...';
  if (progress < 85) return 'Committing changes...';
  if (progress < 95) return 'Creating pull request...';
  return 'Finalizing...';
}

async function waitForJobs(jobIds: string[], spinner: Ora): Promise<void> {
  spinner.start(`Waiting for ${jobIds.length} jobs to complete...`);

  const completed: string[] = [];
  const failed: string[] = [];

  while (completed.length + failed.length < jobIds.length) {
    for (const jobId of jobIds) {
      if (completed.includes(jobId) || failed.includes(jobId)) continue;

      try {
        const job = await getJob(jobId);

        if (job.status === 'completed') {
          completed.push(jobId);
          console.log(chalk.green(`  ✓ ${job.filePath} - PR: ${job.prUrl}`));
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          failed.push(jobId);
          console.log(chalk.red(`  ✗ ${job.filePath} - ${job.error || 'Cancelled'}`));
        }
      } catch (error) {
        // Ignore errors during polling
      }
    }

    spinner.text = `Waiting for jobs... (${completed.length + failed.length}/${jobIds.length} done)`;

    if (completed.length + failed.length < jobIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (failed.length === 0) {
    spinner.succeed(`All ${completed.length} jobs completed successfully!`);
  } else if (completed.length === 0) {
    spinner.fail(`All ${failed.length} jobs failed`);
  } else {
    spinner.warn(`${completed.length} completed, ${failed.length} failed`);
  }
}
