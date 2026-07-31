# Berechtigungen

FireBot hat ein feingranulares Berechtigungssystem, mit dem du genau festlegst, wer im Dashboard und im Bot welche Aktionen ausführen darf.

## Wer hat überhaupt Zugang?

Das zuerst, weil es oft anders erwartet wird: **Discord-Mitglieder haben keinen automatischen Dashboard-Zugang.**

- Wer den Bot einlädt, ist **Administrator** dieser Guild und hat immer vollen Zugriff.
- Alle anderen müssen ausdrücklich **eingeladen** werden: Dashboard → **Benutzer & Gruppen** → **Mitglied hinzufügen**.
- Nach der Einladung landen sie in der Gruppe **User** und haben damit die Basisrechte des Dashboards.

Wer nicht eingeladen wurde, taucht in der Benutzerverwaltung gar nicht erst auf — auch wenn er auf dem Discord-Server ist.

## Konzept: Eine Gruppe ist eine Sammlung von Häkchen

Eine Gruppe enthält genau die Berechtigungen, die in ihr angehakt sind. Mehr nicht. Wer in mehreren Gruppen ist, bekommt die Summe aller Häkchen.

Es gibt **keine Vererbung** zwischen Gruppen. Eine eigene Gruppe „Gameserver" wirkt ausschließlich auf ihre Mitglieder und hat keinen Einfluss auf „User", „Moderator" oder sonst jemanden.

> **Zum Rang:** Jede Gruppe hat eine Zahl namens *Rang*. Sie dient nur der Sortierung und hat **keinen** Einfluss darauf, wer welche Rechte bekommt.

## Standard-Gruppen

Beim Server-Setup werden vier Gruppen angelegt:

| Gruppe | Beschreibung |
|--------|-------------|
| **Administrator** | Vollzugriff. Bekommt neue Plugin-Berechtigungen automatisch. |
| **Moderator** | Moderation, Tickets, grundlegende Verwaltung |
| **Support** | Eingeschränkter Zugriff, z.B. Ticket-Ansicht |
| **User** | Basiszugriff. Hier landen neu eingeladene Nutzer. |

> **Tipp:** Der Server-Besitzer hat immer Zugriff auf alles, unabhängig von Gruppen. Das ist der Weg zurück, falls sich jemand aussperrt.

## Benutzer einer Gruppe zuordnen

1. Dashboard → **Benutzer & Gruppen**
2. Benutzer auswählen und auf **Bearbeiten** klicken
3. Gruppen anhaken
4. Speichern

Ein Benutzer kann in mehreren Gruppen gleichzeitig sein — die Berechtigungen werden addiert.

## Persönliche Rechte (Direct Permissions)

Manchmal soll genau eine Person etwas dürfen, ohne dass dafür eine eigene Gruppe nötig wäre. Dafür gibt es im Bearbeiten-Dialog des Benutzers den Bereich **Direct Permissions**.

- Sie gelten **zusätzlich** zu den Gruppen des Benutzers.
- Ein abgewähltes Kästchen bedeutet „kein persönliches Extrarecht" — die Rechte aus den Gruppen bleiben davon unberührt.
- Wählst du alle ab, ist der persönliche Zusatz leer.

Für eine wiederkehrende Rollenverteilung ist eine eigene Gruppe die bessere Wahl. Direct Permissions eignen sich für Ausnahmen.

## Eigene Gruppen erstellen

1. Dashboard → **Benutzer & Gruppen** → **Gruppen**
2. **Neue Gruppe** anklicken
3. Namen vergeben und Berechtigungen anhaken
4. Speichern

Eine eigene Gruppe betrifft ausschließlich ihre Mitglieder. Du kannst beliebig viele anlegen.

## Berechtigungen verstehen

Berechtigungen haben die Form `BEREICH.AKTION`. Beispiele:

| Berechtigung | Bedeutung |
|-------------|-----------|
| `GAMESERVER.VIEW` | Gameserver-Liste und Details sehen |
| `GAMESERVER.START` | Gameserver starten |
| `GAMESERVER.DELETE` | Gameserver löschen (kritisch) |
| `MODERATION.BAN` | Benutzer bannen |
| `CORE.SETTINGS.EDIT` | Server-Grundeinstellungen ändern |

### Ganze Bereiche auf einmal: der Kategorie-Schalter

Über jeder Kategorie steht ein Schalter wie **`GAMESERVER.*`**. Er deckt alle Berechtigungen dieser Kategorie ab — **auch solche, die ein späteres Update hinzufügt**.

Das ist der bequeme Weg für Gruppen, die „alles rund um Gameserver" dürfen sollen. Ohne den Schalter müsstest du nach jedem Plugin-Update jede Gruppe nachpflegen.

### Voraussetzungen werden automatisch ergänzt

Viele Berechtigungen bauen aufeinander auf. Hakst du `GAMESERVER.CREATE` an, wird `GAMESERVER.VIEW` automatisch mitgespeichert — sonst dürfte jemand Server anlegen, aber die Liste nicht öffnen.

Das gilt über mehrere Stufen: `GAMESERVER.CONSOLE.EXECUTE` zieht `GAMESERVER.CONSOLE.VIEW` **und** `GAMESERVER.VIEW` nach. Nach dem Speichern nennt die Meldung, was ergänzt wurde.

### Gefährliche Berechtigungen

Einige Berechtigungen tragen die rote Marke **Kritisch**. Sie erlauben tiefgreifende Aktionen:

- Gameserver löschen
- Konsolen-Zugriff auf Gameserver
- Benutzer entfernen oder bannen
- Server-Grundeinstellungen ändern
- Berechtigungen anderer ändern

> **Achtung:** Der Kategorie-Schalter `GAMESERVER.*` schließt die kritischen Rechte dieser Kategorie mit ein. Wenn du das nicht willst, hake die Berechtigungen einzeln an.

## Niemand vergibt mehr, als er selbst hat

Wer Gruppen bearbeiten darf, kann **nur Berechtigungen weitergeben, die er selbst besitzt**.

Ein Moderator ohne `GAMESERVER.DELETE` kann dieses Recht also keiner Gruppe zuweisen und sich damit nicht selbst hochstufen. Versucht er es, wird die Berechtigung beim Speichern verworfen, und die Meldung nennt sie beim Namen.

Wegnehmen darf jeder, der die Gruppe bearbeiten darf. Der Server-Besitzer ist von dieser Regel ausgenommen.

## Plugin-Berechtigungen

Jedes Plugin bringt eigene Berechtigungen mit. Wird ein Plugin aktiviert, werden sie registriert und **einmalig** in die vorgesehenen Standard-Gruppen eingetragen: Administrator in jedem Fall, weitere Gruppen je nach Plugin.

**Einmalig** ist wörtlich gemeint. Entfernst du danach eine Berechtigung aus einer Gruppe, bleibt sie entfernt — sie kommt beim nächsten Neustart nicht zurück.

## Häufige Fragen

**Ich habe jemandem eine Gruppe gegeben, die Änderung greift aber nicht.**
Berechtigungen werden einige Minuten zwischengespeichert. Nach Ablauf oder einem erneuten Login greift die Änderung.

**Warum sieht jemand einen Bereich nicht, obwohl er die Berechtigung hat?**
Meist fehlt die zugehörige `…VIEW`-Berechtigung. Seit der automatischen Ergänzung passiert das bei neuen Änderungen nicht mehr; ältere Gruppen können noch unvollständig sein. Gruppe einmal öffnen und speichern genügt, dann werden die Voraussetzungen ergänzt.

**Ich habe mich selbst ausgesperrt.**
Der Server-Besitzer hat immer vollen Zugriff und kann die Rechte wiederherstellen.

## Nächster Schritt

→ [Dashboard-Übersicht](../dashboard/uebersicht.md) — Lerne das Dashboard im Detail kennen.
