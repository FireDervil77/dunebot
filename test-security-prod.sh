#!/bin/bash
# Security Test Script - PRODUCTION
# Testet .env Schutz auf firenetworks.de
# 
# Author: FireDervil
# Date: 2025-11-09

echo "🔒 Security Test: .env Protection (PRODUCTION)"
echo "==============================================="
echo ""

BASE_URL="https://firenetworks.de"

# Test-Szenarien (sollten ALLE 403 Forbidden zurückgeben)
TESTS=(
    "/.env"
    "/apps/dashboard/.env"
    "/.git/config"
    "/.vscode/settings.json"
    "/node_modules/package.json"
    "/logs/dashboard.log"
    "/package.json"
    "/ecosystem.config.js"
    "/migration.sql"
)

echo "🧪 Teste $(( ${#TESTS[@]} )) Endpoints..."
echo ""

PASSED=0
FAILED=0

for test in "${TESTS[@]}"; do
    URL="${BASE_URL}${test}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
    
    if [ "$HTTP_CODE" = "403" ]; then
        echo "✅ $test → $HTTP_CODE Forbidden"
        ((PASSED++))
    else
        echo "❌ $test → $HTTP_CODE (ERWARTET: 403)"
        ((FAILED++))
    fi
done

echo ""
echo "==============================================="
echo "Ergebnis: $PASSED passed, $FAILED failed"

if [ $FAILED -eq 0 ]; then
    echo "🎉 Alle Tests bestanden! Security aktiv (PRODUCTION)."
    exit 0
else
    echo "⚠️  $FAILED Tests fehlgeschlagen! Bitte prüfen."
    exit 1
fi
