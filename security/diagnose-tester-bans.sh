#!/bin/bash
# ============================================================================
# Diagnose: Warum werden Tester beim Installieren des Spiel-Clients gebannt?
#
# NUR LESEND — ändert nichts. Ausführen mit:
#   sudo bash security/diagnose-tester-bans.sh
#
# Hintergrund (2026-07-28): Der Jail dunebot-ddos hatte
# logpath = /var/log/apache2/*access.log — der Glob zog auch
# spacecluster_downloads_access.log mit ein. Über diesen VHost lädt der
# Launcher 216 Einzeldateien. Bei maxretry=150/60s wird der Tester also
# mitten in der Installation gebannt.
# ============================================================================

LOG=/var/log/apache2/spacecluster_downloads_access.log

echo "==================== 1. AKTIVE JAILS ===================="
fail2ban-client status

echo
echo "==================== 2. BANS PRO JAIL ===================="
for jail in $(fail2ban-client status | sed -n 's/.*Jail list:\s*//p' | tr ',' ' '); do
    count=$(fail2ban-client get "$jail" banned 2>/dev/null | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | wc -l)
    bantime=$(fail2ban-client get "$jail" bantime 2>/dev/null)
    printf '  %-22s %4s Bans   bantime=%s%s\n' "$jail" "$count" "$bantime" \
        "$([ "$bantime" = "-1" ] && echo '   <-- PERMANENT!')"
done

echo
echo "==================== 3. TOP-IPs IM DOWNLOAD-LOG ===================="
echo "(Wer lädt den Client? Diese IPs sind Tester, keine Angreifer.)"
if [ -r "$LOG" ]; then
    awk '{print $1}' "$LOG" | sort | uniq -c | sort -rn | head -15 | while read -r cnt ip; do
        ptr=$(dig +short -x "$ip" +time=2 +tries=1 2>/dev/null | head -1)
        banned=""
        for jail in $(fail2ban-client status | sed -n 's/.*Jail list:\s*//p' | tr ',' ' '); do
            fail2ban-client get "$jail" banned 2>/dev/null | grep -q "'$ip'" && banned="$banned $jail"
        done
        printf '  %-16s %6s Requests  %-45s %s\n' "$ip" "$cnt" "${ptr:-kein PTR}" \
            "$([ -n "$banned" ] && echo "GEBANNT IN:$banned")"
    done
else
    echo "  Logdatei $LOG nicht lesbar/vorhanden"
fi

echo
echo "==================== 4. REQUESTS PRO MINUTE (Spitzen) ===================="
echo "(> 150/min bei einer IP = Ban durch dunebot-ddos)"
if [ -r "$LOG" ]; then
    awk '{split($4,t,":"); print $1" "t[2]":"t[3]}' "$LOG" | sort | uniq -c | sort -rn | head -10 |
        awk '{printf "  %-16s %s Uhr: %s Requests%s\n", $2, $3, $1, ($1>150 ? "   <-- ueber maxretry!" : "")}'
else
    echo "  Logdatei $LOG nicht lesbar/vorhanden"
fi

echo
echo "==================== 5. AUDIT (alle Jails, PTR-Klassifikation) ===================="
cd "$(dirname "$0")" || exit 1
NODE_BIN=$(sudo -u "${SUDO_USER:-$USER}" bash -lc 'which node' 2>/dev/null)
if [ -x "$NODE_BIN" ]; then
    "$NODE_BIN" manage-blocked-ips.js audit
else
    echo "  node nicht gefunden (nvm) — manuell:  sudo \"\$(which node)\" security/manage-blocked-ips.js audit"
fi
