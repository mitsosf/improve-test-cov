import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { listRepositoriesPaginated, getCoverage, setApiUrl } from '../api.js';

export const listCommand = new Command('list')
  .description('List repositories or files below coverage threshold')
  .option('-r, --repos', 'List all registered repositories')
  .option('--repo-id <id>', 'List files for a specific repository')
  .option('-t, --threshold <percent>', 'Coverage threshold (default: 80)', '80')
  .option('--page <page>', 'Page number for files list', '1')
  .option('--limit <limit>', 'Items per page', '20')
  .action(async (options: {
    repos?: boolean;
    repoId?: string;
    threshold: string;
    page: string;
    limit: string;
  }) => {
    const parent = listCommand.parent;
    if (parent?.opts().apiUrl) {
      setApiUrl(parent.opts().apiUrl);
    }

    const spinner = ora('Fetching data...').start();

    try {
      if (options.repos) {
        // List all repositories with pagination
        const page = parseInt(options.page, 10);
        const limit = parseInt(options.limit, 10);
        const result = await listRepositoriesPaginated(page, limit);
        const repos = result.repositories;
        const pagination = result.pagination;

        spinner.succeed(`Found ${pagination.total} repositories`);

        if (repos.length === 0) {
          console.log(chalk.yellow('No repositories registered. Use `cov analyze <url>` to add one.'));
          return;
        }

        const table = new Table({
          head: [chalk.cyan('ID'), chalk.cyan('Name'), chalk.cyan('Branch'), chalk.cyan('Last Analyzed')],
          colWidths: [40, 30, 15, 25],
        });

        for (const repo of repos) {
          table.push([
            repo.id,
            repo.name,
            repo.branch,
            repo.lastAnalyzedAt ? new Date(repo.lastAnalyzedAt).toLocaleString() : chalk.gray('Never'),
          ]);
        }

        console.log(table.toString());

        // Show pagination info
        if (pagination.totalPages > 1) {
          console.log();
          console.log(
            chalk.gray(
              `Page ${pagination.page} of ${pagination.totalPages} ` +
                `(${pagination.total} total repositories)`,
            ),
          );
          if (pagination.page < pagination.totalPages) {
            console.log(chalk.gray(`Use --page ${pagination.page + 1} to see next page`));
          }
        }
      } else if (options.repoId) {
        // List files for a specific repository
        const threshold = parseInt(options.threshold, 10);
        const page = parseInt(options.page, 10);
        const limit = parseInt(options.limit, 10);
        const report = await getCoverage(options.repoId, page, limit);

        const belowThreshold = report.files.filter(f => f.coveragePercentage < threshold);
        spinner.succeed(`Found ${belowThreshold.length} files below ${threshold}% coverage`);

        if (belowThreshold.length === 0) {
          console.log(chalk.green(`All files are above ${threshold}% coverage!`));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('File ID'),
            chalk.cyan('Path'),
            chalk.cyan('Coverage'),
            chalk.cyan('Status'),
          ],
          colWidths: [40, 35, 12, 12],
        });

        for (const file of belowThreshold.sort((a, b) => a.coveragePercentage - b.coveragePercentage)) {
          const coverageColor = file.coveragePercentage < 50 ? chalk.red : chalk.yellow;
          table.push([
            file.id,
            file.path.length > 33 ? '...' + file.path.slice(-30) : file.path,
            coverageColor(`${file.coveragePercentage.toFixed(1)}%`),
            file.status,
          ]);
        }

        console.log(table.toString());

        // Show pagination info
        if (report.pagination) {
          console.log();
          console.log(
            chalk.gray(
              `Page ${report.pagination.page} of ${report.pagination.totalPages} ` +
                `(${report.pagination.total} total files)`,
            ),
          );
          if (report.pagination.page < report.pagination.totalPages) {
            console.log(chalk.gray(`Use --page ${report.pagination.page + 1} to see next page`));
          }
        }

        console.log();
        console.log(chalk.gray(`Use 'cov improve --file-id <id> --repo-id ${options.repoId}' to improve coverage`));
        console.log(chalk.gray(`Or use 'cov improve --all-below ${threshold} --repo-id ${options.repoId}' to improve all`));
      } else {
        spinner.fail('Please specify --repos or --repo-id');
        console.log(chalk.yellow('Examples:'));
        console.log('  cov list --repos                    # List all repositories');
        console.log('  cov list --repo-id <id>             # List files below threshold');
        console.log('  cov list --repo-id <id> -t 70       # Files below 70%');
      }
    } catch (error) {
      spinner.fail('Failed to fetch data');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });
