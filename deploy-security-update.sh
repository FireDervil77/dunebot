#!/bin/bash
# Security Update Deployment Script
# Deployt neue Apache-Config mit .env Schutz
# 
# Author: FireDervil
# Date: 2025-11-09

set -e

echo "🔒 Security Update: Apache .env Protection"
echo "========================================="
echo ""

# Prüfe ob als root ausgeführt
if [ "$EUID" -ne 0 ]; then 
   echo "❌ Bitte als root ausführen: sudo bash deploy-security-update.sh"
   exit 1
fi

# Backup existiert bereits (siehe ls-Ausgabe oben)
echo "✅ Backup bereits erstellt: dev-firenetworks-dashboard.conf.bak_security_20251109_101044"
echo ""

# Neue Config kopieren
echo "📋 Kopiere neue Apache-Config..."
cp /home/firedervil/dunebot_dev/apache-security-update.conf /etc/apache2/sites-enabled/dev-firenetworks-dashboard.conf
echo "✅ Config kopiert"
echo ""

# Syntax-Check
echo "🔍 Apache Syntax-Check..."
if apachectl configtest 2>&1 | grep -q "Syntax OK"; then
    echo "✅ Syntax OK"
else
    echo "❌ Syntax-Fehler! Rollback wird durchgeführt..."
    cp /etc/apache2/sites-enabled/dev-firenetworks-dashboard.conf.bak_security_20251109_101044 /etc/apache2/sites-enabled/dev-firenetworks-dashboard.conf
    exit 1
fi
echo ""

# Apache reload
echo "🔄 Apache reload..."
systemctl reload apache2
echo "✅ Apache neu geladen"
echo ""

echo "🎉 Security Update erfolgreich deployed!"
echo ""
echo "Test jetzt mit:"
echo "  curl -I https://dev.firenetworks.de/.env"
echo "  → Sollte '403 Forbidden' zurückgeben"
echo ""
