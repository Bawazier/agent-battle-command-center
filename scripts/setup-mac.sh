#!/bin/bash
# =============================================================================
# Mac Studio Setup Script — Automated setup for ABCC on Apple Silicon
# =============================================================================
#
# Usage:
#   bash scripts/setup-mac.sh
#
# What it does:
#   1. Verifies macOS + Apple Silicon
#   2. Installs Homebrew + Ollama (if needed)
#   3. Pulls model suite (7B base + 70B heavy)
#   4. Creates context variants from Modelfiles
#   5. Copies .env.example → .env with generated secrets
#   6. Configures Ollama to start on boot
#   7. Prints network IP for Windows remote access
#
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[SETUP]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
info()  { echo -e "${BLUE}[INFO]${NC} $*"; }

# ── Step 1: Verify platform ─────────────────────────────────────────────────

log "Checking platform..."
if [[ "$(uname)" != "Darwin" ]]; then
  error "This script is for macOS only. Detected: $(uname)"
  exit 1
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
  warn "Expected Apple Silicon (arm64), detected: $ARCH"
  warn "Continuing anyway, but Metal acceleration requires Apple Silicon."
fi

MEM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
log "Detected: macOS $(sw_vers -productVersion) on $ARCH with ${MEM_GB}GB RAM"

if [[ $MEM_GB -lt 32 ]]; then
  warn "Less than 32GB RAM detected. Large models (70B) may not fit."
fi

# ── Step 2: Install Homebrew + Ollama ────────────────────────────────────────

if ! command -v brew &>/dev/null; then
  log "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
else
  log "Homebrew already installed"
fi

if ! command -v ollama &>/dev/null; then
  log "Installing Ollama..."
  brew install ollama
else
  log "Ollama already installed: $(ollama --version 2>/dev/null || echo 'unknown version')"
fi

# ── Step 3: Start Ollama if not running ──────────────────────────────────────

if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
  log "Starting Ollama..."
  OLLAMA_HOST=0.0.0.0 ollama serve &
  sleep 3
  if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
    error "Ollama failed to start. Check logs."
    exit 1
  fi
fi
log "Ollama is running"

# ── Step 4: Pull models ─────────────────────────────────────────────────────

pull_model() {
  local model="$1"
  if ollama list | grep -q "$model"; then
    log "Model $model already available"
  else
    log "Pulling $model (this may take a while)..."
    ollama pull "$model"
  fi
}

log "Pulling base models..."
pull_model "qwen2.5-coder:7b"

if [[ $MEM_GB -ge 64 ]]; then
  pull_model "qwen2.5-coder:70b"
  info "70B model pulled — recommended for C9 extreme tasks"
else
  warn "Skipping 70B model (needs 64GB+ RAM). Pull manually: ollama pull qwen2.5-coder:70b"
fi

# ── Step 5: Create context variants from Modelfiles ──────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

create_variant() {
  local name="$1"
  local modelfile="$2"
  local filepath="$PROJECT_DIR/modelfiles/$modelfile"

  if ollama list | grep -q "$name"; then
    log "Variant $name already exists"
  elif [[ -f "$filepath" ]]; then
    log "Creating variant $name from $modelfile..."
    ollama create "$name" -f "$filepath"
  else
    warn "Modelfile not found: $filepath — skipping $name"
  fi
}

create_variant "qwen2.5-coder:16k" "qwen2.5-coder-16k.Modelfile"
create_variant "qwen2.5-coder:32k" "qwen2.5-coder-32k.Modelfile"
create_variant "qwen2.5-coder:64k" "qwen2.5-coder-64k.Modelfile"

log "Available models:"
ollama list

# ── Step 6: Environment file ─────────────────────────────────────────────────

ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists — not overwriting. Review and update manually."
else
  log "Creating .env from .env.example..."
  cp "$PROJECT_DIR/.env.example" "$ENV_FILE"

  # Generate random secrets
  generate_secret() { openssl rand -hex 32; }

  POSTGRES_PW=$(generate_secret)
  API_KEY_VAL=$(generate_secret)
  JWT_SECRET_VAL=$(generate_secret)

  # Replace CHANGE_ME placeholders
  sed -i '' "s/POSTGRES_PASSWORD=CHANGE_ME.*/POSTGRES_PASSWORD=$POSTGRES_PW/" "$ENV_FILE"
  sed -i '' "s|postgresql://postgres:CHANGE_ME[^@]*@|postgresql://postgres:$POSTGRES_PW@|" "$ENV_FILE"
  sed -i '' "s/^API_KEY=CHANGE_ME.*/API_KEY=$API_KEY_VAL/" "$ENV_FILE"
  sed -i '' "s/^VITE_API_KEY=CHANGE_ME.*/VITE_API_KEY=$API_KEY_VAL/" "$ENV_FILE"
  sed -i '' "s/^JWT_SECRET=CHANGE_ME.*/JWT_SECRET=$JWT_SECRET_VAL/" "$ENV_FILE"

  log ".env created with generated secrets"
  warn "You still need to set ANTHROPIC_API_KEY in .env"
fi

# ── Step 7: Configure Ollama to start on boot ───────────────────────────────

info "To start Ollama on boot (listening on all interfaces):"
info "  brew services start ollama"
info "  Then set OLLAMA_HOST=0.0.0.0 in your shell profile (~/.zshrc)"
info ""
info "Or run manually:"
info "  OLLAMA_HOST=0.0.0.0 ollama serve"

# ── Step 8: Print network info ──────────────────────────────────────────────

echo ""
log "=== Network Configuration ==="
echo ""

# Get all active network IPs
for iface in $(ifconfig -l); do
  ip=$(ifconfig "$iface" 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1)
  if [[ -n "$ip" ]]; then
    info "$iface: $ip"
  fi
done

HOSTNAME=$(hostname)
info "mDNS hostname: ${HOSTNAME}.local"

echo ""
log "=== Windows .env Configuration ==="
echo ""
info "Add these to your Windows ABCC .env file:"
info ""
info "  REMOTE_OLLAMA_URL=http://${HOSTNAME}.local:11434"
info "  REMOTE_OLLAMA_MODEL=qwen2.5-coder:70b"
info "  REMOTE_OLLAMA_MODEL_MAP=7-8:qwen2.5-coder:32k,9:qwen2.5-coder:70b"
info "  REMOTE_OLLAMA_MIN_COMPLEXITY=7"
info "  REMOTE_OLLAMA_MAX_COMPLEXITY=9"
info "  REMOTE_OLLAMA_SLOTS=2"
echo ""

log "=== Standalone Mode ==="
echo ""
info "To run the full stack on this Mac:"
info "  docker compose -f docker-compose.yml -f docker-compose.mac.yml up --build"
echo ""

log "Setup complete!"
