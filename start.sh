#!/bin/bash
# DuneBot Development Starter Script

cd /home/firedervil/dunebot_dev

echo "🔧 Starting DuneBot DEVELOPMENT..."
echo "===================================="

# PM2 mit Ecosystem starten
pm2 start ecosystem.config.js

echo ""
echo "✅ Development started!"
echo ""
echo "Commands:"
echo "  pm2 status              - Status anzeigen"
echo "  pm2 logs dunebot-dashboard-dev  - Dashboard Logs"
echo "  pm2 logs dunebot-bot-dev        - Bot Logs"
echo "  pm2 restart all         - Alles neu starten"
echo "  pm2 stop all            - Alles stoppen"
echo ""
