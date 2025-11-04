# DuneBot Security - Fail2Ban Integration

Dieses Verzeichnis enthält alle Fail2Ban-Konfigurationsdateien und Setup-Scripts für DuneBot.

## 📁 Dateien

### Setup-Scripts
- `setup-fail2ban.sh` - Standard Fail2Ban Setup (Log-basiert)
- `setup-fail2ban-db.sh` - Erweitertes Setup mit MySQL-Integration

### Fail2Ban Konfiguration
- `fail2ban-dunebot-exploits.conf` - Filter für Exploit-Versuche
- `fail2ban-jail-dunebot.conf` - Jail-Konfiguration (Standard)
- `fail2ban-filter-dunebot-db.conf` - Filter für DB-Integration
- `fail2ban-jail-dunebot-db.conf` - Jail-Konfiguration (DB-basiert)

### Helper-Scripts
- `fail2ban-db-reader.py` - Python-Script zum Auslesen blockierter IPs aus MySQL
- `manage-blocked-ips.js` - Node.js-Tool zur Verwaltung der blocked_ips Tabelle
- `sync-blocked-ips-to-firewall.js` - Script zum Synchronisieren von DB-IPs zu iptables

### DDoS-Protection
- `fail2ban-filter-ddos.conf` - Filter für DDoS-Erkennung (Apache2 Access-Logs)
- `fail2ban-jail-ddos.conf` - Jail für automatisches DDoS-Bannen
- `setup-fail2ban-ddos.sh` - Setup-Script für DDoS-Protection

---

## 🛠️ IP-Management Tools

### Blocked IPs verwalten

```bash
# Alle geblockte IPs anzeigen
cd /home/firedervil/dunebot_dev/security
node manage-blocked-ips.js list

# Statistiken anzeigen
node manage-blocked-ips.js stats

# IP entblocken (aus DB löschen)
node manage-blocked-ips.js unblock 192.168.1.100

# IP whitelisten (False Positive markieren)
node manage-blocked-ips.js whitelist 192.168.1.100 "Interner Server"

# Blocked IPs von PROD importieren
node manage-blocked-ips.js import-from-prod
```

### IPs zu Firewall synchronisieren

```bash
# Manuelle Synchronisation (alle DB-IPs → iptables)
sudo node sync-blocked-ips-to-firewall.js

# Als Cronjob (empfohlen):
# */5 * * * * sudo /usr/bin/node /home/firedervil/dunebot_dev/security/sync-blocked-ips-to-firewall.js
```

**Was passiert:**
1. Liest alle `blocked_ips` mit `is_whitelisted = FALSE` aus DB
2. Erstellt/leert iptables Chain `DUNEBOT_BLOCKED`
3. Fügt DROP-Regel für jede IP hinzu
4. Blockiert IPs auf Firewall-Ebene (zusätzlich zu Fail2Ban)

**Vorteil:** Persistente IP-Blocks auch ohne Fail2Ban, zentrale DB-Verwaltung

---

## 🚀 Installation

### Standard Setup (Log-basiert)

```bash
cd /home/firedervil/dunebot_dev/security
sudo ./setup-fail2ban.sh
```

**Was wird installiert:**
- Fail2Ban Filter für DuneBot-Exploits
- Jail-Konfiguration für automatisches Bannen
- Log-Datei `/var/log/dunebot-exploits.log`

**Überwachung:**
```bash
# Logs anzeigen
sudo tail -f /var/log/dunebot-exploits.log

# Status prüfen
sudo fail2ban-client status dunebot-exploits

# IP manuell entsperren
sudo fail2ban-client set dunebot-exploits unbanip 1.2.3.4
```

---

### DDoS-Protection Setup

```bash
cd /home/firedervil/dunebot_dev/security
sudo ./setup-fail2ban-ddos.sh
```

**Was wird installiert:**
- DDoS-Filter für Apache2 Access-Logs
- Rate-Limiting: Max. 100 Requests / 60 Sekunden pro IP
- Automatisches Bannen für 1 Stunde

**Konfiguration anpassen:**
```bash
sudo nano /etc/fail2ban/jail.d/dunebot-ddos.conf

# Für strengeren Schutz:
maxretry = 50    # 50 Requests statt 100
findtime = 30    # 30 Sekunden statt 60
bantime  = 7200  # 2 Stunden statt 1

sudo systemctl restart fail2ban
```

**Überwachung:**
```bash
# Jail-Status
sudo fail2ban-client status dunebot-ddos

# Gebannte IPs anzeigen
sudo fail2ban-client get dunebot-ddos banned

# IP manuell entsperren
sudo fail2ban-client set dunebot-ddos unbanip 1.2.3.4

# Apache-Logs live
sudo tail -f /var/log/apache2/access.log
```

---

### Erweiterte Installation (DB-Integration)

```bash
cd /home/firedervil/dunebot_dev/security
sudo ./setup-fail2ban-db.sh
```

**Was wird installiert:**
- DB-Reader-Script (`/usr/local/bin/fail2ban-db-reader`)
- Fail2Ban Filter für DB-Integration
- Jail-Konfiguration für MySQL-basiertes Bannen
- Cronjob (alle 5 Minuten)

**Funktionsweise:**
1. Dashboard schreibt blockierte IPs in MySQL-Tabelle `blocked_ips`
2. Cronjob liest alle 5 Minuten neue IPs aus der DB
3. Fail2Ban sperrt IPs via iptables
4. Garantiert: **Keine doppelten Bans**, IPs bleiben konsistent in DB + Firewall

**Überwachung:**
```bash
# DB-Reader manuell testen
sudo /usr/local/bin/fail2ban-db-reader

# Jail-Status prüfen
sudo fail2ban-client status dunebot-db

# Gebannte IPs anzeigen
sudo fail2ban-client get dunebot-db banned

# IP manuell entsperren
sudo fail2ban-client set dunebot-db unbanip 1.2.3.4

# Fail2Ban-Logs
sudo tail -f /var/log/fail2ban.log
```

---

## 🔧 Troubleshooting

### Setup-Script schlägt fehl

```bash
# Fail2Ban installiert?
sudo apt install fail2ban

# Python-Abhängigkeiten (für DB-Integration)
sudo apt install python3-pymysql
```

### Jail wird nicht geladen

```bash
# Fail2Ban neustarten
sudo systemctl restart fail2ban

# Konfiguration testen
sudo fail2ban-client -t

# Logs prüfen
sudo journalctl -xeu fail2ban
```

### IPs werden nicht gesperrt

```bash
# Filter testen (Standard)
sudo fail2ban-regex /var/log/dunebot-exploits.log /etc/fail2ban/filter.d/dunebot-exploits.conf

# Filter testen (DB)
sudo fail2ban-regex /var/log/dunebot-db.log /etc/fail2ban/filter.d/dunebot-db.conf

# Cronjob prüfen (DB-Integration)
sudo crontab -l | grep fail2ban-db-reader
```

---

## 📊 Systemvoraussetzungen

- **OS:** Ubuntu/Debian
- **Fail2Ban:** >= 0.11
- **Python:** >= 3.6 (für DB-Integration)
- **MySQL:** DuneBot-Datenbank mit `blocked_ips` Tabelle

---

## 🔐 Sicherheitshinweise

1. **Log-Rotation:** `/var/log/dunebot-exploits.log` und `/var/log/dunebot-db.log` wachsen unbegrenzt!
   ```bash
   sudo nano /etc/logrotate.d/dunebot-fail2ban
   ```

2. **Cronjob-Intervall:** Standardmäßig alle 5 Minuten. Bei hohem Traffic anpassen.

3. **Firewall-Persistenz:** iptables-Regeln gehen bei Reboot verloren!
   ```bash
   sudo apt install iptables-persistent
   sudo netfilter-persistent save
   ```

4. **MySQL-Credentials:** In `.env` gespeichert, werden via Cronjob geladen.

---

## 📝 Changelog

- **v1.0** - Initiale Version mit Log-basiertem Setup
- **v2.0** - Erweitert um MySQL-Integration und DB-Reader
- **v2.1** - Verschoben in `security/` Ordner, Pfade automatisch aufgelöst

---

## 👤 Support

Bei Problemen siehe:
- `/var/log/fail2ban.log` - Fail2Ban-Logs
- `/var/log/dunebot-exploits.log` - Exploit-Versuche
- `/var/log/dunebot-db.log` - DB-Reader-Output
- `sudo systemctl status fail2ban` - Service-Status
