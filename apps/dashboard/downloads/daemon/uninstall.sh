#!/bin/bash
#
# FireBot Daemon - Uninstall Script
# ==================================
#
# Entfernt FireBot Daemon vollständig vom System
#
# Usage: sudo ./uninstall.sh

# Forward to install.sh with uninstall flag
exec "$(dirname "$0")/install.sh" --uninstall
