#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║         TypeScript Coverage Improver - Setup               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Prerequisites check
echo -e "${BLUE}Checking prerequisites...${NC}"
echo ""

MISSING_REQUIRED=false
MISSING_AI_CLI=true

# Check Docker
if command_exists docker; then
    if docker info >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Docker (running)"
    else
        echo -e "  ${YELLOW}!${NC} Docker (installed but not running)"
    fi
else
    echo -e "  ${RED}✗${NC} Docker - Required for sandboxed execution"
    echo -e "    Install from: https://docs.docker.com/get-docker/"
    MISSING_REQUIRED=true
fi

# Check Docker Compose
if command_exists docker && docker compose version >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Docker Compose"
else
    echo -e "  ${RED}✗${NC} Docker Compose - Required for running services"
    echo -e "    Included with Docker Desktop, or install separately"
    MISSING_REQUIRED=true
fi

# Check AI CLIs (at least one required)
echo ""
echo -e "${BLUE}AI CLI Tools (at least one required):${NC}"

if command_exists claude; then
    echo -e "  ${GREEN}✓${NC} Claude CLI"
    MISSING_AI_CLI=false
else
    echo -e "  ${YELLOW}!${NC} Claude CLI - Not installed"
    echo -e "    Install: curl -fsSL https://claude.ai/install.sh | bash"
fi

if command_exists codex; then
    echo -e "  ${GREEN}✓${NC} Codex CLI (OpenAI)"
    MISSING_AI_CLI=false
else
    echo -e "  ${YELLOW}!${NC} Codex CLI - Not installed"
    echo -e "    Install: brew install --cask codex"
fi

# AI CLIs only needed for local development, Docker containers have them pre-installed
if [ "$MISSING_AI_CLI" = true ]; then
    echo ""
    echo -e "  ${YELLOW}Note: AI CLIs not found locally.${NC}"
    echo -e "  ${YELLOW}This is fine for Docker mode - CLIs are pre-installed in containers.${NC}"
fi

echo ""

if [ "$MISSING_REQUIRED" = true ]; then
    echo -e "${RED}Some required dependencies are missing. Please install them first.${NC}"
    echo ""
    exit 1
fi

# Check if .env exists, if not create from example
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}Creating .env from .env.example...${NC}"
        cp .env.example .env
        echo -e "${YELLOW}Please edit .env with your API keys before running.${NC}"
        echo ""
        echo "Required configuration:"
        echo "  - GITHUB_TOKEN: For creating PRs (get from https://github.com/settings/tokens)"
        echo "  - ANTHROPIC_API_KEY or OPENAI_API_KEY: At least one AI provider. If you're logged in locally, you can skip this part."
        echo ""
        read -p "Press Enter after configuring .env, or Ctrl+C to exit..."
    else
        echo -e "${RED}Error: .env.example not found${NC}"
        exit 1
    fi
fi

# Function to run with Docker
run_docker() {
    echo -e "${BLUE}Starting with Docker Compose...${NC}"

    if ! command_exists docker; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        echo "Install Docker from: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}Error: Docker daemon is not running${NC}"
        echo "Please start Docker and try again."
        exit 1
    fi

    echo -e "${GREEN}Building and starting services...${NC}"
    docker compose up --build
}

# Function to install CLI globally
install_cli() {
    echo -e "${BLUE}Installing CLI globally...${NC}"

    if ! command_exists pnpm; then
        echo -e "${YELLOW}pnpm not found, installing...${NC}"
        npm install -g pnpm
    fi

    pnpm install
    pnpm build

    cd packages/cli
    pnpm link --global
    cd ../..

    echo -e "${GREEN}CLI installed! Run 'cov --help' to get started.${NC}"
}

# Show menu
echo "Select an option:"
echo ""
echo "  1) Docker (Recommended) - Run with Docker Compose"
echo "  2) Install CLI          - Install 'cov' command globally (optional - web UI available)"
echo "  3) Exit"
echo ""
read -p "Enter choice [1-3]: " choice

case $choice in
    1)
        run_docker
        ;;
    2)
        install_cli
        ;;
    3)
        echo "Goodbye!"
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac
