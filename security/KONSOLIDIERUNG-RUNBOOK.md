# Runbook: IP-Block-Mechanismen konsolidieren

Stand: 2026-07-27 (Audit-Befund 4.4, docs/audit/01-dashboard-core-raw.md)

**Ziel:** Die DB (`blocked_ips`) bleibt einzige Quelle der Wahrheit. Pro Ebene
genau ein Enforcement-Pfad:

| Ebene     | Bleibt aktiv                          | Wird stillgelegt                         |
|-----------|---------------------------------------|------------------------------------------|
| App       | Express-Exploit-Blocker               | —                                        |
| Netzwerk  | fail2ban-Jail `dunebot-exploits`      | Jail `dunebot-db` + DB-Reader-Cron       |
| Netzwerk  | (fail2ban übernimmt)                  | `sync-blocked-ips-to-firewall.js` + `DUNEBOT_BLOCKED`-Chain |
| DDoS      | fail2ban-Jail `dunebot-ddos`          | — (eigener Zweck, kein Duplikat)         |

Alle Schritte brauchen Root. Reihenfolge einhalten — dann gibt es keinen
Zeitpunkt ohne Schutz (Express-Blocker + `dunebot-exploits` laufen durchgehend).

---

## Schritt 1: dunebot-db-Jail + DB-Reader-Cron stilllegen

```bash
# Cronjob des DB-Readers entfernen (in root-crontab suchen und Zeile löschen)
sudo crontab -l | grep -n "fail2ban-db-reader\|dunebot-db"
sudo crontab -e   # entsprechende Zeile(n) löschen

# Jail deaktivieren
sudo rm /etc/fail2ban/jail.d/dunebot-db.conf
sudo systemctl reload fail2ban

# Prüfen: dunebot-db darf nicht mehr auftauchen, dunebot-exploits + dunebot-ddos schon
sudo fail2ban-client status
```

## Schritt 2: Firewall-Sync-Cron + DUNEBOT_BLOCKED-Chain entfernen

```bash
# Cronjob entfernen (in root-crontab)
sudo crontab -l | grep -n "sync-blocked-ips-to-firewall"
sudo crontab -e   # entsprechende Zeile löschen

# Chain aus INPUT aushängen und löschen
sudo iptables -D INPUT -j DUNEBOT_BLOCKED
sudo iptables -F DUNEBOT_BLOCKED
sudo iptables -X DUNEBOT_BLOCKED

# Persistieren (sonst kommt die Chain zwar nicht wieder, aber sauber ist sauber)
sudo netfilter-persistent save 2>/dev/null || true

# Prüfen
sudo iptables -L INPUT -n | head -5   # DUNEBOT_BLOCKED darf nicht mehr erscheinen
```

> **Hinweis:** Damit verlieren die bisher per Chain komplett gedroppten IPs ihren
> Full-Drop. Das ist gewollt: fail2ban bannt sie weiterhin (zeitlich begrenzt),
> und der Express-Blocker blockt sie auf App-Ebene über die DB. Wer eine
> Handvoll IPs wirklich dauerhaft auf Firewall-Ebene halten will, trägt sie
> manuell in ein normales iptables-/ufw-Regelwerk ein.

## Schritt 3: 4,8-GB-Log entsorgen + Logrotation einrichten

```bash
# Das DB-Reader-Log wird nicht mehr beschrieben (Schritt 1) → truncaten
sudo truncate -s 0 /var/log/dunebot-db.log
# (oder ganz löschen: sudo rm /var/log/dunebot-db.log)

# Logrotation für das verbleibende Exploit-Log
sudo tee /etc/logrotate.d/dunebot-fail2ban > /dev/null <<'EOF'
/var/log/dunebot-exploits.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF

# Testlauf
sudo logrotate -d /etc/logrotate.d/dunebot-fail2ban
```

> `copytruncate` ist wichtig: Der Dashboard-Prozess hält kein File-Handle offen
> (appendFileSync), aber fail2ban liest die Datei — copytruncate vermeidet
> Inode-Wechsel-Probleme ohne fail2ban-Neustart.

## Schritt 4: Verifikation

```bash
# 1. Nur noch zwei Dunebot-Jails aktiv
sudo fail2ban-client status

# 2. Keine DUNEBOT_BLOCKED-Chain mehr
sudo iptables -L -n | grep -c DUNEBOT_BLOCKED   # → 0

# 3. Zentrales Entsperren testen (beliebige geblockte IP)
cd /home/firedervil/dunebot_prod/security
node manage-blocked-ips.js list
sudo "$(which node)" manage-blocked-ips.js whitelist <ip> "Test Konsolidierung"
# → muss DB-Whitelist + fail2ban-unban in einem Rutsch melden
```

---

## Schritt 5: DDoS-Jail entschärfen (bannt aktuell echte Nutzer!)

Befund vom 2026-07-27: 8 Vodafone-DE-DSL-Anschlüsse (`188.98.x`, PTR verifiziert)
und 3 Doku-Leser-IPs waren NUR im `dunebot-ddos`-Jail gebannt — ohne jeden
Exploit-Verdacht. **Verifizierte Ursache** (Live-Config geprüft):
1. `bantime = -1` → jeder Ban ist PERMANENT (Bans von Okt. 2025 noch aktiv)
2. Die `failregex` zählt JEDE Log-Zeile — auch alle Asset-Requests (JS/CSS/
   Bilder). Eine Dashboard-Seite lädt Dutzende Assets → 2-3 schnelle
   Seitenwechsel überschreiten 100 Requests/60 s → lebenslanger Firewall-Ban
   für normales Klicken. DSL-Pool-IPs sind zudem dynamisch — der Ban trifft
   später den nächsten unschuldigen Kunden, der die IP erbt.

Die korrigierten Configs liegen im Repo (Filter zählt keine Assets mehr,
maxretry 150, bantime 3600, ignoreip für Googlebot; Regex getestet):

```bash
cd /home/firedervil/dunebot_prod/security
sudo cp fail2ban-filter-ddos.conf /etc/fail2ban/filter.d/dunebot-ddos.conf
sudo cp fail2ban-jail-ddos.conf   /etc/fail2ban/jail.d/dunebot-ddos.conf

# Config-Test, dann Neustart
sudo fail2ban-client -t
sudo systemctl restart fail2ban
```

Danach die Altlasten (permanente Fehl-Bans) automatisch aufräumen:

```bash
# Klassifiziert ALLE Bans (Crawler / Endkunden-Anschluss / Angreifer) und
# entbannt die gefundenen False Positives in einem Rutsch:
sudo "$(which node)" manage-blocked-ips.js audit --fix
```

## Entsperren nach der Konsolidierung (der neue Normalfall)

Ein einziger Befehl reicht:

```bash
sudo "$(which node)" /home/firedervil/dunebot_prod/security/manage-blocked-ips.js whitelist <ip> "Grund"
```

> **Warum `"$(which node)"`?** Node ist per nvm installiert und liegt nur im
> User-PATH — sudos `secure_path` kennt ihn nicht (`sudo node` → "command not
> found"). `$(which node)` löst den absoluten Pfad in der User-Shell auf,
> bevor sudo übernimmt.

Das erledigt: DB-Whitelist (Express-Blocker übernimmt sie live, ohne Neustart,
max. 30 s Verzögerung) + fail2ban-Unban in allen Jails + iptables-Regel
(solange die Alt-Chain noch existiert).

## Was NICHT mehr benutzt werden soll

- `security/sync-blocked-ips-to-firewall.js` — stillgelegt (Schritt 2)
- `security/sync-blocked-ips-to-fail2ban.js` / `fail2ban-db-reader.py` — stillgelegt (Schritt 1)
- `security/setup-fail2ban-db.sh` — nicht erneut ausführen

Die Dateien bleiben vorerst im Repo (Referenz/Rollback). Nach ein paar Wochen
störungsfreiem Betrieb können sie gelöscht werden.
