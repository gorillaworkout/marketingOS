#!/bin/bash
# Codex Image Generator via tmux
# Usage: ./codex-image-gen.sh /path/to/prompt.txt /path/to/cwd [model]
#
# This script:
# 1. Kills any leftover codex tmux sessions
# 2. Writes the instruction to a temp file and pipes it to codex via stdin
# 3. Monitors for output.png in CWD and ~/.codex/generated_images/
# 4. Reports IMAGE_SUCCESS:<path> or IMAGE_FAILED:<reason>
#
# NOTE: We do NOT use set -euo pipefail here because any transient tmux or
# filesystem error would cause the entire script to exit silently WITHOUT
# emitting IMAGE_SUCCESS or IMAGE_FAILED. Instead we handle errors explicitly.

PROMPT_FILE="$1"
CWD="${2:-$(pwd)}"
MODEL="${3:-gpt-5.6-terra}"
SESSION="codex-img-$$"
MARKER="CODEX_DONE_$$"
IMAGE_FOUND=0
MAX_WAIT=240  # 240 seconds (4 minutes)

# Clean up stale temp files
rm -f /tmp/codex-instruction-*.tmp 2>/dev/null || true

# Ensure output dir exists
mkdir -p "$CWD/public/outputs/images" 2>/dev/null || true

cd "$CWD" || { echo "IMAGE_FAILED:failed to cd to $CWD"; exit 1; }

# Kill any leftover codex tmux sessions — intentional ignore of pipe failures
tmux list-sessions 2>/dev/null | grep "codex-img-" | cut -d: -f1 | xargs -I{} tmux kill-session -t {} 2>/dev/null || true

PROMPT=$(cat "$PROMPT_FILE" 2>/dev/null | tr -d '\000-\010\013\014\016-\037')
if [ -z "$PROMPT" ]; then
  echo "IMAGE_FAILED:empty prompt from $PROMPT_FILE"
  exit 1
fi
rm -f "$CWD/output.png" 2>/dev/null || true

# Record timestamp BEFORE starting codex so we can detect new files
BEFORE_TS=$(date +%s)

# Write instruction to a temp file to avoid all shell escaping issues
INSTRUCTION_FILE=$(mktemp /tmp/codex-instruction-XXXXXXXX.tmp 2>/dev/null)
if [ -z "$INSTRUCTION_FILE" ] || [ ! -f "$INSTRUCTION_FILE" ]; then
  echo "IMAGE_FAILED:failed to create temp instruction file"
  exit 1
fi

cat > "$INSTRUCTION_FILE" <<'INST_EOF'
Generate a photorealistic image using the built-in image_gen tool.

INSTRUCTIONS:
- Use the built-in image_gen tool (NOT ImageMagick, NOT PIL, NOT any code)
- Set quality to 'high'
- Set size to '1024x1536' (portrait) or '1536x1024' (landscape)
- The image must be photorealistic, cinematic quality, 8K detail
- After generation, copy the result to output.png using: cp <source> output.png

Description:
INST_EOF
# Write prompt safely (avoid shell interpretation)
printf '%s\n' "$PROMPT" >> "$INSTRUCTION_FILE"

# Resolve Codex on both macOS development machines and Linux VPS hosts.
CODEX_BIN="${CODEX_BIN:-}"
if [ -z "$CODEX_BIN" ]; then
  CODEX_BIN="$(command -v codex 2>/dev/null || true)"
fi
if [ -z "$CODEX_BIN" ] && [ -x "$HOME/.npm-global/bin/codex" ]; then
  CODEX_BIN="$HOME/.npm-global/bin/codex"
fi
if [ -z "$CODEX_BIN" ] && [ -x "/opt/homebrew/bin/codex" ]; then
  CODEX_BIN="/opt/homebrew/bin/codex"
fi
if [ -z "$CODEX_BIN" ]; then
  echo "IMAGE_FAILED:Codex CLI not found. Set CODEX_BIN or install Codex."
  exit 1
fi

# Cross-platform mtime + path listing (GNU stat on Linux, BSD stat on macOS).
list_image_files_by_mtime() {
  if stat -c '%Y %n' /dev/null >/dev/null 2>&1; then
    find "$1" -name "*.png" -type f -exec stat -c '%Y %n' {} \; 2>/dev/null
  else
    find "$1" -name "*.png" -type f -exec stat -f '%m %N' {} \; 2>/dev/null
  fi
}

# GNU stat is used on Linux and BSD stat on macOS.
file_size() {
  if stat -c '%s' "$1" >/dev/null 2>&1; then
    stat -c '%s' "$1"
  else
    stat -f '%z' "$1"
  fi
}

# Build the codex command - use stdin to avoid escaping issues
# Use --dangerously-bypass-approvals-and-sandbox to avoid interactive prompts
# Escape single quotes in variables for safe shell embedding
CWD_SAFE=$(printf '%s' "$CWD" | sed "s/'/'\\\\\\\\''/g")
INST_SAFE=$(printf '%s' "$INSTRUCTION_FILE" | sed "s/'/'\\\\\\\\''/g")
CODEX_SAFE=$(printf '%s' "$CODEX_BIN" | sed "s/'/'\\\\\\\\''/g")
MODEL_SAFE=$(printf '%s' "$MODEL" | sed "s/'/'\\\\\\\\''/g")
CODEX_CMD="cd '$CWD_SAFE' && '$CODEX_SAFE' exec - -m '$MODEL_SAFE' --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check < '$INST_SAFE'; echo '$MARKER'"

# Start tmux session with Codex
tmux new-session -d -s "$SESSION" -x 200 -y 50 "$CODEX_CMD"
TMUX_EXIT=$?
if [ "$TMUX_EXIT" -ne 0 ]; then
  echo "IMAGE_FAILED:tmux new-session failed (exit=$TMUX_EXIT)"
  rm -f "$INSTRUCTION_FILE" 2>/dev/null || true
  exit 1
fi

# Function to search for generated images
find_newest_image() {
  local codex_dir="$HOME/.codex/generated_images"
  if [ ! -d "$codex_dir" ]; then
    return 1
  fi

  # Find all png files created after we started, sorted by modification time (newest first)
  # On macOS: use stat to compare timestamps since -newermt is GNU-only
  local newest=""
  local best_path=""
  local best_size=0
  while IFS= read -r line; do
    local ts="${line%% *}"
    local path="${line#* }"
    if [ "$ts" -gt "$BEFORE_TS" ]; then
      local size
      size=$(file_size "$path" 2>/dev/null || echo 0)
      if [ "$size" -gt 10000 ]; then
        best_path="$path"
        best_size="$size"
        break
      fi
    fi
  done < <(list_image_files_by_mtime "$codex_dir" | sort -rn)
  newest="$best_path"

  if [ -n "$newest" ] && [ -f "$newest" ]; then
    local size
    size=$(stat -f%z "$newest" 2>/dev/null || stat -c%s "$newest" 2>/dev/null || echo 0)
    if [ "$size" -gt 10000 ]; then
      echo "$newest"
      return 0
    fi
  fi
  return 1
}

# Wait for completion (max MAX_WAIT seconds)
for i in $(seq 1 "$MAX_WAIT"); do
  sleep 1

  # Check output.png in CWD
  if [ -f "$CWD/output.png" ]; then
    SIZE=$(stat -f%z "$CWD/output.png" 2>/dev/null || stat -c%s "$CWD/output.png" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 10000 ]; then
      echo "IMAGE_SUCCESS:output.png"
      IMAGE_FOUND=1
      break
    fi
  fi

  # Check Codex generated_images directory for new images
  NEWEST=$(find_newest_image) || true
  if [ -n "$NEWEST" ]; then
    cp "$NEWEST" "$CWD/output.png" 2>/dev/null || true
    if [ -f "$CWD/output.png" ]; then
      SIZE=$(stat -f%z "$CWD/output.png" 2>/dev/null || echo 0)
      if [ "$SIZE" -gt 10000 ]; then
        echo "IMAGE_SUCCESS:output.png"
        IMAGE_FOUND=1
        break
      fi
    fi
  fi

  # Check if codex process finished (look for our marker in tmux output)
  if [ "$i" -gt 10 ]; then
    TMUX_OUT=$(tmux capture-pane -t "$SESSION" -p 2>/dev/null || true)
    if echo "$TMUX_OUT" | grep -q "$MARKER"; then
      # Codex finished, give a few more seconds for file to appear
      sleep 3

      # Final check for output.png
      if [ -f "$CWD/output.png" ]; then
        SIZE=$(stat -f%z "$CWD/output.png" 2>/dev/null || stat -c%s "$CWD/output.png" 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 10000 ]; then
          echo "IMAGE_SUCCESS:output.png"
          IMAGE_FOUND=1
          break
        fi
      fi

      # Final check for images in codex generated_images
      NEWEST=$(find_newest_image) || true
      if [ -n "$NEWEST" ]; then
        cp "$NEWEST" "$CWD/output.png" 2>/dev/null || true
        if [ -f "$CWD/output.png" ]; then
          echo "IMAGE_SUCCESS:output.png"
          IMAGE_FOUND=1
          break
        fi
      fi

      # Codex finished but no image found — grab last few lines of tmux output for diagnostics
      TMUX_TAIL=$(echo "$TMUX_OUT" | tail -20 | tr '\n' ';' | sed 's/"/\\"/g')
      echo "IMAGE_FAILED:codex finished but no image found | tmux_tail=$TMUX_TAIL"
      break
    fi
  fi
done

# Cleanup
tmux kill-session -t "$SESSION" 2>/dev/null || true
rm -f "$INSTRUCTION_FILE" 2>/dev/null || true

if [ "$IMAGE_FOUND" -eq 0 ] && [ "$i" -ge "$MAX_WAIT" ]; then
  echo "IMAGE_FAILED:timeout after ${MAX_WAIT}s"
fi

exit 0
