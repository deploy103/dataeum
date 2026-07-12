#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
make all
exec ./build/dataeum-server
