#!/bin/bash
# ============================================================================
# Stellt SSH-Bans wieder her, die 'audit --fix' fälschlich entbannt hat.
#
#   sudo bash security/restore-ssh-bans.sh          # nur anzeigen (Dry-Run)
#   sudo bash security/restore-ssh-bans.sh --apply  # wirklich neu bannen
#
# Hintergrund (2026-07-28): Das Audit ermittelt die Jails seit heute dynamisch
# und hat dadurch erstmals auch den sshd-Jail (21.480 Bans) einbezogen. Seine
# Klassifikation stützt sich aber auf HTTP-Evidenz — für SSH-Bruteforce gibt es
# die nicht. IPs mit Endkunden-PTR (Botnetze auf gekaperten Heimroutern) wurden
# deshalb als "False Positive" eingestuft und entbannt.
#
# Quelle der Wahrheit ist /var/log/fail2ban.log: dort steht jede Unban-Aktion
# mit Zeitstempel. Die fail2ban-SQLite reicht nicht, weil dbpurgeage=30d alte
# Ban-Datensaetze bereits geloescht hat.
# ============================================================================

APPLY=0
[ "$1" = "--apply" ] && APPLY=1

TODAY=$(date +%Y-%m-%d)
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

echo "Suche sshd-Unbans vom $TODAY in /var/log/fail2ban.log*"

# Aktuelle + rotierte Logs (auch .gz) durchsuchen
{
    cat /var/log/fail2ban.log 2>/dev/null
    cat /var/log/fail2ban.log.1 2>/dev/null
    zcat /var/log/fail2ban.log.*.gz 2>/dev/null
} | grep "^$TODAY" | grep -E '\[sshd\].*Unban' |
    grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | sort -u > "$TMP"

COUNT=$(wc -l < "$TMP")
echo "Gefunden: $COUNT heute entbannte SSH-IPs"

if [ "$COUNT" -eq 0 ]; then
    echo "Nichts wiederherzustellen."
    exit 0
fi

# Bereits wieder gebannte herausfiltern (Angreifer triggern von selbst neu)
STILL_FREE=0
while read -r ip; do
    if fail2ban-client get sshd banned 2>/dev/null | grep -q "'$ip'"; then
        continue
    fi
    STILL_FREE=$((STILL_FREE + 1))
    if [ "$APPLY" -eq 1 ]; then
        if fail2ban-client set sshd banip "$ip" >/dev/null 2>&1; then
            echo "  neu gebannt: $ip"
        else
            echo "  FEHLER bei:  $ip"
        fi
    else
        echo "  wuerde bannen: $ip"
    fi
done < "$TMP"

echo
echo "Noch frei gewesen: $STILL_FREE von $COUNT"
if [ "$APPLY" -eq 0 ]; then
    echo "Dry-Run — zum Ausfuehren:  sudo bash security/restore-ssh-bans.sh --apply"
fi
