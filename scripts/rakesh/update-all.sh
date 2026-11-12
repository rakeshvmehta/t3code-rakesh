#!/usr/bin/env bash
set -uo pipefail
scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
/bin/bash "$scripts/stable-update.sh" || status=1
/bin/bash "$scripts/t3rn-update.sh" || status=1
exit "$status"
