#!/usr/bin/env bash
# Compatibility entrypoint for existing scheduled jobs and external callers.
exec /bin/bash "$(dirname "${BASH_SOURCE[0]}")/stable-update.sh" "$@"
