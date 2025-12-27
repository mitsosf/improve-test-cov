# TypeScript Coverage Improver

A tool that automatically improves test coverage for TypeScript projects by generating tests via AI (Claude/OpenAI) and submitting them as GitHub PRs.

## Features

- Analyze test coverage for any TypeScript repository
- Identify files below coverage threshold
- Generate tests using Claude or OpenAI
- Automatically create PRs with improved tests
- Web dashboard for monitoring
- CLI for local development

## Quick Start

### Using Docker (Recommended)

1. Clone and configure:
```bash
git clone https://github.com/yourusername/coverage-improver.git
cd coverage-improver
cp .env.example .env
# Edit .env with your API keys
```

2. Start the services:
```bash
docker compose up -d
```

3. Access the dashboard at http://localhost:8080

### Local Development

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
cov improve <file-id> --provider claude

# Check job status
cov status <job-id>
```

## Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | GitHub token for creating PRs | Yes (for PRs) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude | One AI required |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4 | One AI required |
| `COVERAGE_THRESHOLD` | Threshold percentage (default: 80) | No |
| `DATABASE_PATH` | SQLite database path | No |

## Architecture

```
/
├── backend/          # NestJS API (DDD architecture)
├── frontend/         # React dashboard (Vite)
└── packages/
    ├── cli/          # Command-line interface
    └── shared/       # Shared types
```

### Backend (DDD Layers)
- **Domain**: Pure business logic, entities, value objects
- **Application**: Use cases, orchestration services
- **Infrastructure**: Database, GitHub, AI providers, NestJS

## Domain Glossary

| Term | Definition |
|------|------------|
| **Repository** | A GitHub repository being tracked for coverage improvement |
| **CoverageFile** | A TypeScript source file with its coverage metrics and uncovered lines |
| **Job** | A background task (analysis or improvement) with status tracking |
| **Analysis Job** | Clones repo, runs tests with coverage, stores results in database |
| **Improvement Job** | Generates tests for a specific file via AI, creates GitHub PR |
| **Coverage Threshold** | Minimum acceptable coverage percentage (default: 80%) |
| **AI Provider** | Claude or OpenAI - generates test code targeting uncovered lines |

## How It Works

1. **Analyze**: Clone repo, run tests with coverage, parse results
2. **Identify**: Find files below coverage threshold
3. **Generate**: Send source + coverage to AI for test generation
4. **Submit**: Create branch, commit tests, open PR

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/repositories` | Add repository to track |
| GET | `/api/repositories` | List repositories |
| GET | `/api/repositories/:id/coverage` | Get coverage report |
| POST | `/api/analysis-jobs` | Start coverage analysis |
| POST | `/api/jobs` | Start improvement job |
| GET | `/api/jobs/:id` | Get job status |

## Docker Images

Published to GitHub Container Registry on each push to main:
- `ghcr.io/<user>/coverage-improver/backend`
- `ghcr.io/<user>/coverage-improver/frontend`

## License

MIT
