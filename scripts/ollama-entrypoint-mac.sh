#!/bin/bash
# =============================================================================
# Ollama Entrypoint for Mac (Docker Mode)
# =============================================================================
#
# Alternative to native Ollama — runs Ollama inside Docker on Mac.
# Native Ollama is recommended (direct Metal access), but this works too.
#
# Usage in docker-compose override:
#   ollama:
#     entrypoint: ["/bin/bash", "/entrypoint-mac.sh"]
#     volumes:
#       - ./scripts/ollama-entrypoint-mac.sh:/entrypoint-mac.sh
#
# Differences from ollama-entrypoint.sh:
#   - No NVIDIA GPU block (Apple Silicon uses Metal)
#   - Pulls 70B model (fits in 128GB unified memory)
#   - Creates 64K context variant (plenty of RAM for large KV cache)
#   - Longer healthcheck start_period for big model downloads
#
# =============================================================================

set -euo pipefail

# Start ollama server in the background
ollama serve &

# Wait for ollama to be ready
echo "Waiting for Ollama to start..."
until ollama list >/dev/null 2>&1; do
  sleep 2
done
echo "Ollama is ready"

# ── Pull base models ─────────────────────────────────────────────────────────

pull_if_missing() {
  local model="$1"
  if ollama list | grep -q "$model"; then
    echo "Model $model already available"
  else
    echo "Pulling $model..."
    ollama pull "$model"
  fi
}

pull_if_missing "qwen2.5-coder:7b"
pull_if_missing "qwen2.5-coder:70b"

# ── Create context variants ──────────────────────────────────────────────────

create_variant() {
  local NAME="$1"
  local NUM_CTX="$2"
  local CTX_LABEL="$3"
  local SYSTEM_MSG="$4"

  if ollama list | grep -q "$NAME"; then
    echo "Model $NAME already available"
    return
  fi

  echo "Creating $NAME ($CTX_LABEL context)..."
  cat > /tmp/Modelfile << MODELEOF
FROM qwen2.5-coder:7b

PARAMETER num_ctx $NUM_CTX
PARAMETER temperature 0
PARAMETER num_predict 4096
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1

SYSTEM $SYSTEM_MSG
MODELEOF

  ollama create "$NAME" -f /tmp/Modelfile
  echo "Model $NAME created successfully"
}

create_variant "qwen2.5-coder:16k" 16384 "16K" \
  "You are CodeX-7, an elite autonomous coding unit. With 16K context capacity, you can see multiple files, full stack traces, and complete schemas in a single mission. DIRECTIVES: 1) Read ALL provided context before writing code 2) Understand cross-file dependencies 3) One write, one verify, mission complete 4) Never leave syntax errors or TODOs."

create_variant "qwen2.5-coder:32k" 32768 "32K" \
  "You are CodeX-7, an elite autonomous coding unit. With 32K context capacity, you can see entire codebases, full stack traces, and complete schemas in a single mission. DIRECTIVES: 1) Read ALL provided context before writing code 2) Understand cross-file dependencies 3) One write, one verify, mission complete 4) Never leave syntax errors or TODOs."

create_variant "qwen2.5-coder:64k" 65536 "64K" \
  "You are CodeX-7, an elite autonomous coding unit. With 64K context capacity, you can hold entire project codebases, dependency trees, and full documentation in memory. DIRECTIVES: 1) Read ALL provided context before writing code 2) Understand cross-file and cross-package dependencies 3) One write, one verify, mission complete 4) Never leave syntax errors or TODOs."

echo "All model variants ready"
ollama list

# Keep the container running
wait
