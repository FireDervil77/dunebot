#!/bin/bash

echo "======================================================================"
echo "   DUNEBOT DEV vs PROD VERGLEICH"
echo "======================================================================"
echo ""

echo "📊 GIT STATUS VERGLEICH:"
echo "----------------------------------------------------------------------"
echo ""

echo "🔧 DEV (dunebot_dev):"
cd /home/firedervil/dunebot_dev
echo "  Branch: $(git branch --show-current)"
echo "  Letzter Commit: $(git log -1 --oneline)"
echo "  Status: $(git status --short | wc -l) uncommitted files"
echo ""

echo "🚀 PROD (dunebot_prod):"
cd /home/firedervil/dunebot_prod
echo "  Branch: $(git branch --show-current)"
echo "  Letzter Commit: $(git log -1 --oneline)"
echo "  Status: $(git status --short | wc -l) uncommitted files"
echo ""

echo "======================================================================"
echo "📋 COMMIT-UNTERSCHIEDE:"
echo "----------------------------------------------------------------------"
echo ""

echo "DEV Commits (nicht in PROD):"
cd /home/firedervil/dunebot_dev
git log --oneline 2a4875e..HEAD

echo ""
echo "PROD Commits (nicht in DEV):"
cd /home/firedervil/dunebot_prod
git log --oneline 2a4875e..HEAD

echo ""
echo "======================================================================"
echo "⚠️  UNCOMMITTED CHANGES IN PROD:"
echo "----------------------------------------------------------------------"
cd /home/firedervil/dunebot_prod
git status --short

echo ""
echo "======================================================================"
echo "🔍 DATEIEN DIE IN BEIDEN VERÄNDERT WURDEN:"
echo "----------------------------------------------------------------------"
echo ""

# Sammle uncommitted Files in PROD
cd /home/firedervil/dunebot_prod
PROD_CHANGED=$(git status --short | awk '{print $2}')

cd /home/firedervil/dunebot_dev

echo "Checking conflicts..."
for file in $PROD_CHANGED; do
    if git diff --name-only 2a4875e..HEAD | grep -q "^$file$"; then
        echo "  ⚠️  $file (in DEV committed, in PROD uncommitted)"
    fi
done

echo ""
echo "======================================================================"
echo "💡 EMPFEHLUNG:"
echo "----------------------------------------------------------------------"
echo ""
echo "1. PROD uncommitted changes committen"
echo "2. DEV Commits zu PROD mergen oder cherry-picken"
echo "3. Oder: PROD komplett mit DEV synchronisieren"
echo ""
echo "======================================================================"
