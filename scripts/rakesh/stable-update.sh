#!/usr/bin/env bash
export RAKESH_UPDATE_CHANNEL=stable
exec /bin/bash "$(dirname "${BASH_SOURCE[0]}")/release-update.sh" "$@"
