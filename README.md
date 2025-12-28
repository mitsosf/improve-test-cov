# TypeScript Coverage Improver

A tool that automatically improves test coverage for TypeScript projects by generating tests via AI (Claude/OpenAI) and submitting them as GitHub PRs.

## Live Demo
Try the demo dashboard at: https://coverage.frangiadakis.com

Check out already completed jobs here: https://coverage.frangiadakis.com/jobs

Already opened PRs: 
- https://github.com/mitsosf/test-coverage-improvements/pull/28
- https://github.com/mitsosf/test-coverage-improvements/pull/29

## Features

- Analyze test coverage for any TypeScript repository
- Identify files below coverage threshold
- Generate tests using Claude or OpenAI
- Automatically create PRs with improved tests
- Web dashboard for monitoring
- CLI for local development

## Quick Start

### One-Command Setup

```bash
./run.sh
```

This interactive script will:
- Create `.env` from `.env.example` if needed
- Guide you through all the setup

### Using Docker (Recommended)

1. Clone and configure:
```bash
git clone git@github.com:mitsosf/improve-test-cov.git
```

2. Setup and run project:
```bash
cd improve-test-cov
./run.sh
```

3. Access the dashboard at http://localhost:8080

### Local Development (More complex to set up, prefer Docker)

Requirements:
- Node.js 24+
- pnpm 9.15.1+

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start development servers
pnpm dev
```

Backend runs at http://localhost:3000
Frontend runs at http://localhost:5173

## CLI Usage

```bash
# Install CLI globally
cd packages/cli && pnpm link --global

# Analyze a repository
cov analyze https://github.com/user/repo

# List files below threshold
cov list <repo-id>

# Start improvement job
cov improve --file-id <file-id> --repo-id <repo-id>

# Check job status
cov status <job-id>
```

## Configuration

| Variable             | Description                        | Required        |
|----------------------|------------------------------------|-----------------|
| `GITHUB_TOKEN`       | GitHub token for creating PRs      | Yes (for PRs)   |
| `ANTHROPIC_API_KEY`  | Anthropic API key for Claude       | One AI required |
| `OPENAI_API_KEY`     | OpenAI API key for GPT-4           | One AI required |
| `COVERAGE_THRESHOLD` | Threshold percentage (default: 80) | No              |
| `DATABASE_PATH`      | SQLite database path               | No              |

## Architecture

```
/
├── backend/          # NestJS API (DDD architecture)
├── frontend/         # React dashboard (Vite)
└── packages/
    ├── cli/          # Command-line interface
    └── shared/       # Shared types
```

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  CLIENTS                                    │
│                                                                             │
│                    ┌──────────────┐      ┌──────────────────┐               │
│                    │ CLI Package  │      │  React Dashboard │               │
│                    └──────┬───────┘      └────────┬─────────┘               │
│                           │                       │                         │
└───────────────────────────┼───────────────────────┼─────────────────────────┘
                            │                       │
                            ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  BACKEND                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        INFRASTRUCTURE LAYER                           │  │
│  │                                                                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │  │
│  │  │ NestJS          │  │ GitHub API      │  │ AI Providers    │        │  │
│  │  │ Controllers     │  │ Client          │  │ Claude/Codex    │        │  │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘        │  │
│  │           │                    │                    │                 │  │
│  │  ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐        │  │
│  │  │ SQLite DB       │  │ Docker Sandbox  │  │ Command Runner  │        │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         APPLICATION LAYER                             │  │
│  │                                                                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │  │
│  │  │ CoverageService │  │ Improvement     │  │ JobProcessor    │        │  │
│  │  │                 │  │ Service         │  │                 │        │  │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘        │  │
│  └───────────┼────────────────────┼────────────────────┼────────────────┘  │
│              │                    │                    │                   │
│              ▼                    ▼                    ▼                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                           DOMAIN LAYER                                │  │
│  │                    (Pure Business Logic)                              │  │
│  │                                                                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │  │
│  │  │ Job Entity      │  │ CoverageFile    │  │ GitHubRepo      │        │  │
│  │  │                 │  │ Entity          │  │ Entity          │        │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘        │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────┐      │  │
│  │  │ Value Objects: CoveragePercentage, JobStatus, FilePath      │      │  │
│  │  └─────────────────────────────────────────────────────────────┘      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Backend (DDD Layers)
- **Domain**: Pure business logic, entities, value objects
- **Application**: Use cases, orchestration services
- **Infrastructure**: Database, GitHub, AI providers, NestJS

## Domain Glossary

| Term                   | Definition                                                             |
|------------------------|------------------------------------------------------------------------|
| **Repository**         | A GitHub repository being tracked for coverage improvement             |
| **CoverageFile**       | A TypeScript source file with its coverage metrics and uncovered lines |
| **Job**                | A background task (analysis or improvement) with status tracking       |
| **Analysis Job**       | Clones repo, runs tests with coverage, stores results in database      |
| **Improvement Job**    | Generates tests for a specific file via AI, creates GitHub PR          |
| **Coverage Threshold** | Minimum acceptable coverage percentage (default: 80%)                  |
| **AI Provider**        | Claude or OpenAI - generates test code targeting uncovered lines       |

## How It Works

1. **Analyze**: Clone repo, run tests with coverage, parse results
2. **Identify**: Find files below coverage threshold
3. **Generate Tests & Submit PR**: Send source + coverage to AI for test generation + submit PR

## Repository Compatibility

### Requirements

| Category        | Supported                      |
|-----------------|--------------------------------|
| Test Framework  | Jest, Vitest                   |
| Package Manager | npm, yarn, pnpm                |
| Language        | TypeScript (`.ts` files only)  |
| Coverage Format | Istanbul JSON or LCOV          |
| Git Host        | GitHub.com                     |
| AI Provider     | Claude, OpenAI                 |

### Limitations

**Post-install scripts are skipped**
- All installations run with `--ignore-scripts` flag
- Projects requiring native module compilation (node-gyp, etc.) will fail
- Husky and other prepare/postinstall hooks won't run

**TypeScript only**
- Only `.ts` source files are analyzed
- No support for JavaScript (`.js`), JSX (`.jsx`), or TSX (`.tsx`)
- Declaration files (`.d.ts`) are excluded

**Test file naming**
- Only `*.test.ts` and `*.spec.ts` patterns are recognized
- Other conventions (`.e2e.ts`, `.integration.ts`) are not detected

**Source file limit**
- Maximum of 200 TypeScript files are analyzed per repository
- Large projects may have incomplete coverage analysis

**Container resource limits**
- 10 minute timeout per job
- 2GB RAM limit
- 2 CPU cores

**Monorepo detection**
- Only scans root and specific subdirectories: `ui`, `frontend`, `web`, `client`, `app`, `backend`, `server`, `api`, `src`
- Custom directory structures may not be detected

**GitHub only**
- GitLab, Bitbucket, and self-hosted Git are not supported
- Requires GitHub token for PR creation

## License

MIT
