#!/bin/bash
# Reset Migration 6.7.0 und 6.7.1 für erneuten Versuch

cd /home/firedervil/dunebot_dev

# Load ENV
source apps/dashboard/.env

echo "🔄 Lösche fehlgeschlagene Migration-Einträge..."

# Migration 6.7.0 zurücksetzen
mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} -h${MYSQL_HOST} ${MYSQL_DATABASE} <<EOF
-- Lösche Migration-Einträge
DELETE FROM plugin_migrations 
WHERE plugin_name = 'core' 
AND migration_file IN (
    'dashboard/migrations/6.7.0-dynamic-permissions.js',
    'dashboard/migrations/6.7.1-add-requiresOwner-to-nav.js'
);

-- Setze Plugin-Version zurück auf 6.6.6
UPDATE plugin_versions 
SET current_version = '6.6.6' 
WHERE plugin_name = 'core';

-- Prüfe Status
SELECT * FROM plugin_migrations WHERE plugin_name = 'core' ORDER BY executed_at DESC LIMIT 5;
SELECT plugin_name, current_version FROM plugin_versions WHERE plugin_name = 'core';
EOF

echo "✅ Migration-Einträge gelöscht!"
echo "🚀 Starte Dashboard neu mit: pm2 restart dashboard-dev"
