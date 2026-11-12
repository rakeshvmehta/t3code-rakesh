#!/usr/bin/env bash
export RAKESH_UPDATE_CHANNEL=nightly
exec /bin/bash "$(dirname "${BASH_SOURCE[0]}")/release-update.sh" "$@"
