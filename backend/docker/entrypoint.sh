#!/bin/sh
set -e

# Fix Docker socket permissions for non-root user (runs as root initially)
if [ -S /var/run/docker.sock ]; then
    chmod 666 /var/run/docker.sock 2>/dev/null || true
fi

# Drop to non-root user and run the main command
exec su-exec appuser "$@"
