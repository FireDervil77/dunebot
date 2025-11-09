#!/bin/bash
# Security Update Deployment Script - PRODUCTION
# Deployt neue Apache-Config mit .env Schutz für firenetworks.de
# 
# Author: FireDervil
# Date: 2025-11-09

set -e

echo "🔒 Security Update: Apache .env Protection (PRODUCTION)"
echo "======================================================="
echo ""

# Prüfe ob als root ausgeführt
if [ "$EUID" -ne 0 ]; then 
   echo "❌ Bitte als root ausführen: sudo bash deploy-security-update-prod.sh"
   exit 1
fi

# Backup erstellen
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/etc/apache2/sites-available/firenetworks-dashboard.conf.bak_security_${TIMESTAMP}"

echo "📦 Erstelle Backup..."
cp /etc/apache2/sites-available/firenetworks-dashboard.conf "$BACKUP_FILE"
echo "✅ Backup erstellt: $BACKUP_FILE"
echo ""

# Neue Config kopieren
echo "📋 Kopiere neue Apache-Config..."
cp /home/firedervil/dunebot_dev/apache-security-update-prod.conf /etc/apache2/sites-available/firenetworks-dashboard.conf
echo "✅ Config kopiert"
echo ""

# Syntax-Check
echo "🔍 Apache Syntax-Check..."
if apachectl configtest 2>&1 | grep -q "Syntax OK"; then
    echo "✅ Syntax OK"
else
    echo "❌ Syntax-Fehler! Rollback wird durchgeführt..."
    cp "$BACKUP_FILE" /etc/apache2/sites-available/firenetworks-dashboard.conf
    exit 1
fi
echo ""

# Apache reload
echo "🔄 Apache reload..."
systemctl reload apache2
echo "✅ Apache neu geladen"
echo ""

echo "🎉 Security Update erfolgreich deployed (PRODUCTION)!"
echo ""
echo "Test jetzt mit:"
echo "  curl -I https://firenetworks.de/.env"
echo "  → Sollte '403 Forbidden' zurückgeben"
echo ""
