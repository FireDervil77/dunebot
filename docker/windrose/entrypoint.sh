#!/bin/bash
# ============================================================
# Windrose Dedicated Server – Entrypoint (Pelican/Firebot-kompatibel)
# Der Daemon setzt $STARTUP mit dem aufgeloesten Start-Command.
# ============================================================

# {{VAR}} → $VAR Substitution (Pelican-Pattern)
if [ -n "${STARTUP}" ]; then
    STARTUP=$(echo "${STARTUP}" | sed -e 's/{{/${/g' -e 's/}}/}/g')
fi

echo "[entrypoint] Starting: ${STARTUP}"
exec eval "${STARTUP}"


# ── Variablen mit Defaults ────────────────────────────────────────────────────
SERVER_NAME="${SERVER_NAME:-My Windrose Server}"
INVITE_CODE="${INVITE_CODE:-dunebotserver}"
MAX_PLAYERS="${MAX_PLAYERS:-4}"
IS_PASSWORD_PROTECTED="${IS_PASSWORD_PROTECTED:-false}"
SERVER_PASSWORD="${SERVER_PASSWORD:-}"
SERVER_IP="${SERVER_IP:-0.0.0.0}"
SERVER_PORT="${SERVER_PORT:-7777}"
QUERY_PORT="${QUERY_PORT:-7778}"
AUTO_UPDATE="${AUTO_UPDATE:-1}"

echo "=========================================="
echo " Windrose Dedicated Server"
echo "=========================================="
echo " Server Name : ${SERVER_NAME}"
echo " Invite Code : ${INVITE_CODE}"
echo " Max Players : ${MAX_PLAYERS}"
echo " Port        : ${SERVER_PORT}"
echo " Query Port  : ${QUERY_PORT}"
echo "=========================================="

# ── SteamCMD: Spiel installieren / updaten ────────────────────────────────────
if [ "${AUTO_UPDATE}" = "1" ] || [ ! -f "${SERVER_EXE}" ]; then
    echo "[SteamCMD] Downloading / updating Windrose Dedicated Server (App 4129620)..."
    "${STEAMCMD}" \
        +force_install_dir "${INSTALL_DIR}" \
        +login anonymous \
        +app_update 4129620 validate \
        +quit
    echo "[SteamCMD] Done."
fi

# ── Wine-Prefix initialisieren (nur beim ersten Start) ───────────────────────
if [ ! -d "${WINEPREFIX}/drive_c" ]; then
    echo "[Wine] Initializing Wine prefix (first run, this may take a moment)..."
    WINEPREFIX="${WINEPREFIX}" WINEDLLOVERRIDES="mscoree,mshtml=" \
        wineboot --init 2>/dev/null || true
    echo "[Wine] Prefix ready."
fi

# ── ServerDescription.json schreiben ─────────────────────────────────────────
SERVER_JSON="${INSTALL_DIR}/R5/ServerDescription.json"

# Sicherstellen, dass das Verzeichnis existiert (Server muss mindestens einmal
# kurz gestartet worden sein, oder wir legen es manuell an)
mkdir -p "$(dirname "${SERVER_JSON}")"

echo "[Config] Writing ServerDescription.json..."
cat > "${SERVER_JSON}" <<EOF
{
  "InviteCode": "${INVITE_CODE}",
  "IsPasswordProtected": ${IS_PASSWORD_PROTECTED},
  "Password": "${SERVER_PASSWORD}",
  "ServerName": "${SERVER_NAME}",
  "MaxPlayerCount": ${MAX_PLAYERS},
  "P2pProxyAddress": "${SERVER_IP}"
}
EOF

echo "[Config] ServerDescription.json written."

# ── Windrose Dedicated Server starten ────────────────────────────────────────
echo "[Server] Starting server via xvfb + Wine..."
echo "[Server] Invite code: ${INVITE_CODE}"

cd "${INSTALL_DIR}"
exec xvfb-run \
    --auto-servernum \
    --server-args="-screen 0 1024x768x24" \
    wine "${SERVER_EXE}" \
        -log \
        -PORT="${SERVER_PORT}" \
        -QUERYPORT="${QUERY_PORT}"
