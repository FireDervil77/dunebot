#!/bin/bash
# DuneBot Fail2ban Setup Script
# Installiert fail2ban Filter und Jail für Exploit-Blocking

set -e

echo "=== DuneBot Fail2ban Setup ==="
echo ""

# 1. Prüfe ob fail2ban installiert ist
if ! command -v fail2ban-client &> /dev/null; then
    echo "❌ fail2ban ist nicht installiert!"
    echo "   Installation: sudo apt install fail2ban"
    exit 1
fi

echo "✅ fail2ban gefunden"

# Pfade
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 2. Kopiere Filter
echo "📄 Kopiere Filter nach /etc/fail2ban/filter.d/..."
sudo cp "$SCRIPT_DIR/fail2ban-dunebot-exploits.conf" /etc/fail2ban/filter.d/dunebot-exploits.conf
echo "✅ Filter installiert"

# 3. Kopiere Jail
echo "📄 Kopiere Jail nach /etc/fail2ban/jail.d/..."
sudo cp "$SCRIPT_DIR/fail2ban-jail-dunebot.conf" /etc/fail2ban/jail.d/dunebot.local
echo "✅ Jail installiert"

# 4. Erstelle Log-Datei
echo "📄 Erstelle Log-Datei..."
sudo touch /var/log/dunebot-exploits.log
sudo chown www-data:www-data /var/log/dunebot-exploits.log
sudo chmod 644 /var/log/dunebot-exploits.log
echo "✅ Log-Datei erstellt"

# 5. Teste Filter
echo ""
echo "🧪 Teste Filter..."
sudo fail2ban-regex /var/log/dunebot-exploits.log /etc/fail2ban/filter.d/dunebot-exploits.conf
echo ""

# 6. Restart fail2ban
echo "🔄 Starte fail2ban neu..."
sudo systemctl restart fail2ban
echo "✅ fail2ban neugestartet"

# 7. Prüfe Status
echo ""
echo "📊 Status:"
sudo fail2ban-client status dunebot-exploits

echo ""
echo "✅ Setup abgeschlossen!"
echo ""
echo "Monitoring:"
echo "  - Logs:   sudo tail -f /var/log/dunebot-exploits.log"
echo "  - Status: sudo fail2ban-client status dunebot-exploits"
echo "  - Unban:  sudo fail2ban-client set dunebot-exploits unbanip <IP>"
