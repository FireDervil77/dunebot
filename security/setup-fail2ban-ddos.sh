#!/bin/bash
###############################################################################
# DuneBot Fail2ban DDoS-Protection Setup
#
# Installiert Fail2ban DDoS-Filter für Apache2 Access-Logs
# Banns IPs die zu viele Requests in kurzer Zeit machen
#
# Autor: FireBot Team
# Version: 1.0
###############################################################################

set -e

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Pfade
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL2BAN_FILTER_DIR="/etc/fail2ban/filter.d"
FAIL2BAN_JAIL_DIR="/etc/fail2ban/jail.d"
APACHE_ACCESS_LOG="/var/log/apache2/access.log"

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  DuneBot Fail2ban DDoS-Protection Setup${NC}"
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

# Apache2 installiert?
if ! command -v apache2 &> /dev/null; then
    echo -e "${RED}✗ Fehler: Apache2 ist nicht installiert!${NC}"
    exit 1
fi

# Apache Access-Log existiert?
if [ ! -f "$APACHE_ACCESS_LOG" ]; then
    echo -e "${YELLOW}⚠ Warning: $APACHE_ACCESS_LOG nicht gefunden${NC}"
    echo "  Erstelle Dummy-Log..."
    touch "$APACHE_ACCESS_LOG"
    chown www-data:adm "$APACHE_ACCESS_LOG"
    chmod 640 "$APACHE_ACCESS_LOG"
fi

echo -e "${GREEN}[1/4]${NC} Installiere DDoS-Filter..."
cp "$SCRIPT_DIR/fail2ban-filter-ddos.conf" "$FAIL2BAN_FILTER_DIR/dunebot-ddos.conf"
echo -e "      ✓ $FAIL2BAN_FILTER_DIR/dunebot-ddos.conf"

echo -e "${GREEN}[2/4]${NC} Installiere DDoS-Jail..."
cp "$SCRIPT_DIR/fail2ban-jail-ddos.conf" "$FAIL2BAN_JAIL_DIR/dunebot-ddos.conf"
echo -e "      ✓ $FAIL2BAN_JAIL_DIR/dunebot-ddos.conf"

echo -e "${GREEN}[3/4]${NC} Teste Filter..."
echo -e "      Prüfe Regex gegen Apache-Logs..."

# Test-Zeile für Filter
TEST_LINE='192.168.1.100 - - [31/Oct/2025:10:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"'
echo "$TEST_LINE" | fail2ban-regex --print-all-matched - "$FAIL2BAN_FILTER_DIR/dunebot-ddos.conf" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "      ✓ Filter-Syntax OK"
else
    echo -e "${YELLOW}      ⚠ Filter-Test fehlgeschlagen (nicht kritisch)${NC}"
fi

echo -e "${GREEN}[4/4]${NC} Starte Fail2ban neu..."
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
if fail2ban-client status dunebot-ddos &> /dev/null; then
    echo -e "      ✓ Jail 'dunebot-ddos' aktiv"
else
    echo -e "${YELLOW}      ⚠ Jail 'dunebot-ddos' nicht aktiv${NC}"
    echo "      Aktivierung kann bis zu 1 Minute dauern..."
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ DDoS-Protection erfolgreich installiert!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Konfiguration:"
echo "  - Max. Requests:  100 / 60 Sekunden"
echo "  - Ban-Dauer:      1 Stunde (3600s)"
echo "  - Log-Quelle:     Apache2 Access-Logs"
echo ""
echo "Monitoring:"
echo ""
echo "  1. Jail-Status anzeigen:"
echo "     sudo fail2ban-client status dunebot-ddos"
echo ""
echo "  2. Gebannte IPs anzeigen:"
echo "     sudo fail2ban-client get dunebot-ddos banned"
echo ""
echo "  3. IP manuell entsperren:"
echo "     sudo fail2ban-client set dunebot-ddos unbanip 1.2.3.4"
echo ""
echo "  4. Live-Monitoring (Apache-Logs):"
echo "     sudo tail -f /var/log/apache2/access.log"
echo ""
echo "  5. Fail2ban-Logs:"
echo "     sudo tail -f /var/log/fail2ban.log"
echo ""
echo "Konfiguration anpassen:"
echo "  sudo nano $FAIL2BAN_JAIL_DIR/dunebot-ddos.conf"
echo "  Danach: sudo systemctl restart fail2ban"
echo ""
echo -e "${YELLOW}Tipp: Für strengeren Schutz setze maxretry=50, findtime=30${NC}"
echo ""
