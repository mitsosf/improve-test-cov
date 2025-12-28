#!/bin/sh
set -e

# Fix Docker socket access for non-root user (runs as root initially)
if [ -S /var/run/docker.sock ]; then
    # Get the GID of the docker socket
    SOCK_GID=$(stat -c '%g' /var/run/docker.sock)

    # Create a group with that GID if it doesn't exist, then add appuser to it
    if ! getent group "$SOCK_GID" > /dev/null 2>&1; then
        addgroup -g "$SOCK_GID" -S dockersock 2>/dev/null || true
    fi

    # Add appuser to the docker socket group
    SOCK_GROUP=$(getent group "$SOCK_GID" | cut -d: -f1)
    if [ -n "$SOCK_GROUP" ]; then
        adduser appuser "$SOCK_GROUP" 2>/dev/null || true
    fi
fi

# Drop to non-root user and run the main command
exec su-exec appuser "$@"
