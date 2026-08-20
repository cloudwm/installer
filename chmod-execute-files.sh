#!/bin/bash
#
# Reads a config file with lines like:  execute+=(tweaks/cwm-description-autoconfig)
# and runs `chmod +x` on every file referenced inside execute+=(...).
#
# Usage: ./chmod-execute-files.sh <config-file> [base-dir]
#   base-dir - directory the paths are relative to (default: dir of the config file)

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <config-file> [base-dir]" >&2
    exit 1
fi

conf="$1"
base="${2:-$(dirname "$conf")}"

if [ ! -f "$conf" ]; then
    echo "Error: config file not found: $conf" >&2
    exit 1
fi

# Pull out the path between execute+=( and )
grep -oE 'execute\+=\([^)]+\)' "$conf" \
    | sed -E 's/execute\+=\(//; s/\)$//' \
    | while IFS= read -r path; do
        [ -z "$path" ] && continue
        target="$base/$path"
        if [ -f "$target" ]; then
            chmod +x "$target"
            echo "chmod +x  $target"
        else
            echo "skip (not found): $target" >&2
        fi
    done
