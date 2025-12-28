# Backend Dockerfile - Multi-stage build
# Stage 1: Build
FROM node:24-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.26.2 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/shared ./packages/shared
COPY backend ./backend

# Build shared first, then backend
RUN pnpm --filter=@coverage-improver/shared build
RUN pnpm --filter=@coverage-improver/backend build

# Create a production deployment
WORKDIR /app/backend
RUN pnpm deploy --filter=@coverage-improver/backend --prod --legacy /prod

# Stage 2: Production
FROM node:24-alpine AS runner

# Install git, curl, and su-exec (for dropping privileges)
RUN apk add --no-cache git curl su-exec

# Install AI CLIs globally
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# Create non-root user (required for Claude CLI --dangerously-skip-permissions)
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copy production deployment
COPY --from=builder /prod ./

# Copy built artifacts
COPY --from=builder /app/backend/dist ./dist

# Copy entrypoint script
COPY backend/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create data directory for SQLite and set permissions
RUN mkdir -p /app/data /tmp/coverage-improver && \
    chown -R appuser:appgroup /app /tmp/coverage-improver

# Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start as root, entrypoint fixes socket permissions then drops to appuser
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/main.js"]
