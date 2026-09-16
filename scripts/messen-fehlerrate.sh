#!/bin/bash
# Misst, was die fail2ban-Sperre „dunebot-ddos" wirklich zaehlt.
#
# Der Filter zaehlt seit dem 2026-09-15 NUR Fehlerantworten (400/403/404/405)
# auf Nicht-Asset-Pfaden. `maxretry` ist die Zahl solcher Antworten je Minute
# und Adresse, ab der gesperrt wird (Stand 2026-09-16: 40).
#
# Dieses Skript bildet dieselbe Bedingung auf dem Apache-Log nach und zeigt,
# WER wie viele Fehler in seiner staerksten Minute erzeugt hat — und auf
# welchen Pfaden. Damit laesst sich die Zahl begruenden statt raten.
#
#   sudo bash scripts/messen-fehlerrate.sh            # ganzes Log
#   sudo bash scripts/messen-fehlerrate.sh 94.31.110  # nur diese Adressen
#
# Aendert nichts. Liest nur.
set -u

# Ueber die Umgebungsvariable LOG auf eine andere Datei richtbar — so laesst
# sich das Skript gegen ein nachgebautes Log pruefen, ohne sudo.
LOG="${LOG:-/var/log/apache2/firenetworks_prod_access.log}"
FILTER="${1:-}"

if [ ! -r "$LOG" ]; then
    echo "Kann $LOG nicht lesen — mit sudo starten." >&2
    exit 1
fi

echo "Log: $LOG"
[ -n "$FILTER" ] && echo "Nur Adressen mit: $FILTER"
echo

awk -v filter="$FILTER" '
    # Dieselben Ausnahmen wie im Filter (fail2ban-filter-ddos.conf).
    function istAusnahme(pfad) {
        if (pfad ~ /^\/(public|themes|uploads|downloads|client|client-alpha|client-beta|launcher)\//) return 1
        if (pfad ~ /^\/(favicon\.ico|robots\.txt)/) return 1
        if (pfad ~ /\.(js|css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|map|dll|exe|resource|bundle|nupkg|zip|pak|dat|bin|assets|sig|so|dylib)(\?|$)/) return 1
        return 0
    }
    {
        ip = $1
        if (filter != "" && index(ip, filter) == 0) next
        if ($0 ~ /(Googlebot|GoogleOther|Google-InspectionTool|bingbot|Slackbot|facebookexternalhit|Discordbot|Applebot|DuckDuckBot|YandexBot)/) next

        # "[16/Sep/2026:09:07:01 +0200]" -> Minute
        zeit = $4; sub(/^\[/, "", zeit); sub(/:[0-9][0-9]$/, "", zeit)

        # Status steht hinter dem abschliessenden Anfuehrungszeichen der Anfrage.
        status = ""; pfad = ""
        if (match($0, /"(GET|POST|HEAD|PUT|DELETE|PATCH|OPTIONS) [^"]*" [0-9]+/)) {
            teil = substr($0, RSTART, RLENGTH)
            split(teil, s, " ")
            pfad = s[2]
            status = s[length(s)]
        }
        if (status != "400" && status != "403" && status != "404" && status != "405") next
        if (istAusnahme(pfad)) next

        proMinute[ip "\t" zeit]++
        pfade[ip "\t" pfad]++
        gesamt[ip]++
    }
    END {
        for (k in proMinute) {
            split(k, t, "\t")
            if (proMinute[k] > spitze[t[1]]) { spitze[t[1]] = proMinute[k]; minute[t[1]] = t[2] }
        }
        printf "%-18s %8s %8s   %s\n", "Adresse", "Spitze", "gesamt", "staerkste Minute"
        printf "%-18s %8s %8s   %s\n", "------------------", "------", "------", "----------------"
        n = 0
        for (ip in spitze) sortier[sprintf("%08d|%s", spitze[ip], ip)] = ip
        m = asorti(sortier, reihe, "@ind_str_desc")
        for (i = 1; i <= m && n < 20; i++) {
            ip = sortier[reihe[i]]
            printf "%-18s %8d %8d   %s\n", ip, spitze[ip], gesamt[ip], minute[ip]
            n++
            aus = 0
            for (k in pfade) {
                split(k, t, "\t")
                if (t[1] == ip && aus < 3) { printf "%-18s %8s   %s (%dx)\n", "", "", t[2], pfade[k]; aus++ }
            }
        }
        printf "\nGrenze der Sperre: 40 Fehler je Minute. Wer in der Spalte \"Spitze\"\n"
        printf "darueber liegt, wurde gesperrt (sofern nicht in ignoreip).\n"
    }
' "$LOG"
