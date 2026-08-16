#!/bin/bash
#
# Räumt die eigene Registry auf: entfernt Schichten, auf die kein Tag mehr zeigt.
#
# Warum das nötig ist: Beim Hochladen einer neuen Image-Fassung bleiben die alten
# Schichten auf der Platte liegen. Sie gehören zu keinem Namen mehr, gelöscht
# werden sie aber von niemandem. Ohne diesen Lauf wächst /var/lib/registry
# unbegrenzt — und zwar unbemerkt, weil nichts danach schaut.
#
# Warum die Registry dabei steht: `garbage-collect` entscheidet anhand des
# aktuellen Bestands, was verwaisen ist. Läuft parallel ein Upload, kann er
# dessen frisch geschriebene Schichten für verwaist halten und löschen. Die
# Auszeit dauert Sekunden; ein `docker pull` in diesem Moment scheitert und wird
# vom Aufrufer wiederholt.
#
# Einrichten (wöchentlich, im selben Fenster wie die übrige Docker-Aufräumung).
# Zwei Wege, je nachdem wem der Docker-Socket gehört:
#
#   Benutzer-Crontab, wenn der Benutzer in der Gruppe "docker" ist (seit 2026-08-16
#   der Fall — Cron liest die Gruppen beim Start des Auftrags aus /etc/group):
#     0 4 * * 0  /home/firedervil/dunebot_prod/scripts/registry-gc.sh >> /home/firedervil/registry-gc.log 2>&1
#
#   root-Crontab, wenn er es nicht ist:
#     0 4 * * 0  /home/firedervil/dunebot_prod/scripts/registry-gc.sh >> /var/log/registry-gc.log 2>&1
#
# Bis 2026-08-16 stand hier nur die zweite Zeile, während die erste eingerichtet
# war — der Lauf scheiterte deshalb monatelang wöchentlich.
#
# @author FireDervil

set -u

BEHAELTER="registry"
DATEN="/var/lib/registry"

echo "── $(date '+%Y-%m-%d %H:%M:%S') Registry-Aufräumung ──"

vorher=$(du -sb "$DATEN" 2>/dev/null | cut -f1)

# Erst prüfen, ob wir Docker überhaupt fragen dürfen. Ohne diese Unterscheidung
# meldet ein Rechtefehler dasselbe wie ein fehlender Container — am 2026-08-15
# genau so passiert: "Container existiert nicht", obwohl er lief und nur der
# Zugriff auf den Socket fehlte.
if ! fehler=$(docker info 2>&1 >/dev/null); then
    echo "FEHLER: Docker ist nicht erreichbar — $fehler"
    echo "Hinweis: Dieses Skript braucht Docker-Zugriff. Entweder als root laufen"
    echo "lassen (root-Crontab) oder den Benutzer in die Gruppe 'docker' aufnehmen."
    exit 1
fi

if ! docker inspect "$BEHAELTER" >/dev/null 2>&1; then
    echo "FEHLER: Container '$BEHAELTER' existiert nicht."
    echo "Vorhandene Container:"
    docker ps -a --format '  %-20s %s' --format '  {{.Names}}\t{{.Image}}' | head -20
    exit 1
fi

lief=$(docker inspect -f '{{.State.Running}}' "$BEHAELTER" 2>/dev/null)

if [ "$lief" = "true" ]; then
    echo "Registry wird angehalten …"
    docker stop "$BEHAELTER" >/dev/null || { echo "FEHLER: Anhalten fehlgeschlagen"; exit 1; }
fi

# --delete-untagged entfernt auch Manifeste ohne Tag. Das setzt voraus, dass der
# Dienst mit REGISTRY_STORAGE_DELETE_ENABLED=true läuft; sonst bleibt es folgenlos.
docker run --rm -v "$DATEN":/var/lib/registry registry:2 \
    bin/registry garbage-collect /etc/docker/registry/config.yml --delete-untagged
ergebnis=$?

# Die Registry MUSS wieder anlaufen, auch wenn das Aufräumen fehlschlug —
# ein kaputter Teil darf den Dienst nicht beenden.
if [ "$lief" = "true" ]; then
    echo "Registry wird gestartet …"
    docker start "$BEHAELTER" >/dev/null || echo "FEHLER: Start fehlgeschlagen — bitte von Hand prüfen!"
fi

nachher=$(du -sb "$DATEN" 2>/dev/null | cut -f1)

if [ -n "${vorher:-}" ] && [ -n "${nachher:-}" ]; then
    frei=$(( (vorher - nachher) / 1024 / 1024 ))
    echo "Belegt: $(( nachher / 1024 / 1024 )) MB (freigegeben: ${frei} MB)"
fi

if [ "$ergebnis" -ne 0 ]; then
    echo "Aufräumen meldete Fehler $ergebnis — Registry läuft weiter."
fi

exit "$ergebnis"
