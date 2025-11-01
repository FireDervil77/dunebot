#!/bin/bash

###############################################################################
# DuneBot Fail2ban Database Integration - Setup Script
#
# Installiert Fail2ban-Integration für MySQL blocked_ips Tabelle
# IPs aus der Datenbank werden automatisch via iptables gesperrt
#
# Autor: FireBot Team
# Version: 1.0
###############################################################################

set -e  # Exit on error

# Farben für Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Pfade
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FAIL2BAN_FILTER_DIR="/etc/fail2ban/filter.d"
FAIL2BAN_JAIL_DIR="/etc/fail2ban/jail.d"
BIN_DIR="/usr/local/bin"
LOG_FILE="/var/log/dunebot-db.log"
ENV_FILE="$PROJECT_ROOT/apps/dashboard/.env"

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  DuneBot Fail2ban Database Integration Setup${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Root-Check
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}✗ Fehler: Dieses Script muss als root ausgeführt werden${NC}"
    echo "  sudo $0"
    exit 1
fi

# Fail2ban installiert?
if ! command -v fail2ban-client &> /dev/null; then
    echo -e "${RED}✗ Fehler: Fail2ban ist nicht installiert!${NC}"
    echo "  sudo apt install fail2ban"
    exit 1
fi

# Python3-pymysql installiert?
if ! python3 -c "import pymysql" &> /dev/null; then
    echo -e "${YELLOW}⚠ Warning: python3-pymysql nicht installiert${NC}"
    echo "  Installiere python3-pymysql..."
    apt install -y python3-pymysql
fi

# 1. DB-Reader installieren
echo -e "${GREEN}[1/6]${NC} Installiere fail2ban-db-reader..."
cp "$SCRIPT_DIR/fail2ban-db-reader.py" "$BIN_DIR/fail2ban-db-reader"
chmod +x "$BIN_DIR/fail2ban-db-reader"
echo -e "      ✓ $BIN_DIR/fail2ban-db-reader"

# 2. Fail2ban Filter installieren
echo -e "${GREEN}[2/6]${NC} Installiere Fail2ban Filter..."
cp "$SCRIPT_DIR/fail2ban-filter-dunebot-db.conf" "$FAIL2BAN_FILTER_DIR/dunebot-db.conf"
echo -e "      ✓ $FAIL2BAN_FILTER_DIR/dunebot-db.conf"

# 3. Fail2ban Jail installieren
echo -e "${GREEN}[3/6]${NC} Installiere Fail2ban Jail..."
cp "$SCRIPT_DIR/fail2ban-jail-dunebot-db.conf" "$FAIL2BAN_JAIL_DIR/dunebot-db.conf"
echo -e "      ✓ $FAIL2BAN_JAIL_DIR/dunebot-db.conf"

# 4. Log-Datei erstellen
echo -e "${GREEN}[4/6]${NC} Erstelle Log-Datei..."
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"
echo -e "      ✓ $LOG_FILE"

# 5. Environment-Variablen für Cronjob
echo -e "${GREEN}[5/6]${NC} Konfiguriere Environment-Variablen..."
if [ -f "$ENV_FILE" ]; then
    # .env laden und für Cron-Format konvertieren
    ENV_VARS=$(grep -E '^(MYSQL_HOST|MYSQL_PORT|MYSQL_USER|MYSQL_PASSWORD|MYSQL_DATABASE)=' "$ENV_FILE" | sed 's/^/export /')
    
    # Cron-Job erstellen
    CRON_CMD="*/5 * * * * $ENV_VARS && /usr/local/bin/fail2ban-db-reader >> $LOG_FILE 2>&1"
    
    # In root-Crontab einfügen (wenn noch nicht vorhanden)
    if ! crontab -l 2>/dev/null | grep -q "fail2ban-db-reader"; then
        (crontab -l 2>/dev/null; echo ""; echo "# DuneBot Fail2ban DB-Reader (alle 5 Minuten)"; echo "$CRON_CMD") | crontab -
        echo -e "      ✓ Cronjob hinzugefügt (alle 5 Minuten)"
    else
        echo -e "      ⚠ Cronjob existiert bereits"
    fi
else
    echo -e "${YELLOW}      ⚠ .env-Datei nicht gefunden: $ENV_FILE${NC}"
    echo "      Bitte MySQL-Credentials manuell in Cronjob setzen!"
fi

# 6. Fail2ban neustarten
echo -e "${GREEN}[6/6]${NC} Starte Fail2ban neu..."
systemctl restart fail2ban
sleep 2

# Status prüfen
if systemctl is-active --quiet fail2ban; then
    echo -e "      ✓ Fail2ban läuft"
else
    echo -e "${RED}      ✗ Fail2ban konnte nicht gestartet werden${NC}"
    echo "      Siehe: sudo journalctl -xeu fail2ban"
    exit 1
fi

# Jail-Status prüfen
if fail2ban-client status dunebot-db &> /dev/null; then
    echo -e "      ✓ Jail 'dunebot-db' aktiv"
else
    echo -e "${YELLOW}      ⚠ Jail 'dunebot-db' nicht aktiv${NC}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ Installation erfolgreich!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Nächste Schritte:"
echo ""
echo "1. Cronjob testen:"
echo "   sudo /usr/local/bin/fail2ban-db-reader"
echo ""
echo "2. Log prüfen:"
echo "   sudo tail -f $LOG_FILE"
echo ""
echo "3. Jail-Status prüfen:"
echo "   sudo fail2ban-client status dunebot-db"
echo ""
echo "4. Gebannte IPs anzeigen:"
echo "   sudo fail2ban-client get dunebot-db banned"
echo ""
echo "5. IP manuell entsperren:"
echo "   sudo fail2ban-client set dunebot-db unbanip 1.2.3.4"
echo ""
echo "6. Fail2ban-Log überwachen:"
echo "   sudo tail -f /var/log/fail2ban.log"
echo ""
echo -e "${YELLOW}Hinweis: Der Cronjob läuft alle 5 Minuten automatisch.${NC}"
echo -e "${YELLOW}Neue IPs aus der DB werden innerhalb von 5 Minuten gesperrt.${NC}"
echo ""
