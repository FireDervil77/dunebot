# Ressourcen-Verwaltung

Jeder Gameserver bekommt einen festen Anteil am Arbeitsspeicher, an der CPU und
am Speicherplatz seines Root-Servers. Das Dashboard führt Buch darüber, wie viel
schon vergeben ist, und der Daemon setzt die Grenzen im Betrieb durch.

Du findest die Übersicht im Dashboard unter **Masterserver → Ressourcen**.

## Woher die Kapazität kommt

Du musst nichts eintragen. Sobald ein Daemon einmal verbunden war, meldet er
seine Hardware, und das Dashboard rechnet damit:

```
1. Eigene Vorgabe     nur wenn du bewusst etwas anderes festlegst
2. Erkannte Hardware  was der Daemon meldet          ← der Normalfall
3. Profil             solange noch nie ein Daemon verbunden war
```

Auf der Ressourcen-Seite steht über jeder Maschine, welche der drei Stufen
gerade gilt — „automatisch vom Daemon erkannt" samt Zeitstempel, „teilweise von
Hand festgelegt" oder der Hinweis, dass noch kein Daemon verbunden war.

Der Vorteil: Rüstest du Arbeitsspeicher nach, meldet der Daemon das beim
nächsten Lebenszeichen, und die verfügbare Kapazität wächst von selbst mit. Es
gibt keinen Wert, der irgendwo veraltet stehenbleibt.

## Die vier Stellschrauben

### OS-Reservierung

Was du dem Betriebssystem des Root-Servers freihältst. Diese Menge wird nie an
Gameserver vergeben. Voreingestellt sind **1024 MB RAM** und **10 GB Disk** —
für eine Maschine, die nur Gameserver betreibt, ist das ein vernünftiger Anfang.

### Überallokation

Erlaubt, mehr zu vergeben als physisch vorhanden ist, angegeben in Prozent
(0–300). Bei 32 GB RAM und 50 % Überallokation lassen sich 48 GB verteilen.

Das ergibt Sinn, weil kaum ein Gameserver dauerhaft sein volles Limit ausschöpft
— und es ist riskant, weil im Ernstfall mehr angefordert wird, als die Maschine
hat. Fang bei 0 an und erhöhe nur, wenn du die tatsächliche Auslastung kennst.

### Limits je Gameserver

Beim Anlegen eines Gameservers gibst du drei Werte an. Sie sind Pflicht:

| Feld | Bedeutung | Vorschlag |
|------|-----------|-----------|
| Arbeitsspeicher | Obergrenze in MiB, mind. 512 | 2048 |
| CPU-Anteil | In Prozent, **100 % = ein Kern**, 200 % = zwei Kerne | 100 |
| Speicherplatz | Obergrenze in GiB, mind. 1 | 20 |

Reicht der freie Platz auf dem Root-Server nicht, lehnt das Dashboard das
Anlegen ab und nennt dabei, wie viel angefordert wurde und wie viel frei ist.

### Nachträglich ändern

Unter **Gameserver → Bearbeiten** lassen sich die drei Werte anpassen. Geprüft
wird nur die Erhöhung: Was der Server bereits gebucht hat, wird ihm nicht ein
zweites Mal angerechnet. Die neuen Grenzen greifen beim nächsten Start.

## Wie die Grenzen durchgesetzt werden

Das Dashboard schickt die Werte bei **jedem** Start an den Daemon, der daraus
Docker-Limits macht:

| Angabe | Wird zu | Wirkung |
|--------|---------|---------|
| Arbeitsspeicher | Container-Memory-Limit | Der Server kann nicht mehr belegen |
| CPU-Anteil | NanoCPUs | Anteil an der Rechenzeit |
| Speicherplatz | — | Wird gebucht und angezeigt, aber **noch nicht** erzwungen |

Beim Speicherplatz ist die Buchhaltung also bereits richtig, die Durchsetzung
fehlt: Docker kennt keine Volume-Quota. Ein Server kann mehr Platz belegen als
gebucht — in der Übersicht siehst du das nicht.

## Server ohne Limits

Gameserver, die vor Einführung der Pflichtfelder angelegt wurden, haben keine
Werte. In der Übersicht stehen sie mit **„kein Limit"**, laufen unverändert
weiter und zählen mit 0 zur Auslastung — belegen aber trotzdem Speicher.

Solange solche Server existieren, zeigt die Auslastung weniger an, als die
Maschine wirklich trägt. Über **Bearbeiten** lassen sich die Werte nachtragen;
danach stimmt die Rechnung.

## Was die Anzeige bedeutet

| Zeile | Bedeutung |
|-------|-----------|
| Gesamt | Kapazität inklusive Überallokation |
| Reserviert | Was dem Betriebssystem freigehalten wird |
| Balken | Vergeben im Verhältnis zum verfügbaren Rest |
| Server | Anzahl der Gameserver auf dieser Maschine |

Der Balken zeigt **gebuchte**, nicht **verbrauchte** Ressourcen. Ein Server mit
8 GB Limit, der gerade 2 GB nutzt, erscheint mit seinen vollen 8 GB — das ist
Absicht, denn die 8 GB stehen keinem anderen mehr zur Verfügung.

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `MASTERSERVER.RESOURCES.VIEW` | Ressourcen-Seite ansehen |
| `MASTERSERVER.RESOURCES.MANAGE` | Überallokation und Reserven ändern |

→ Weiter: [Server verwalten](server-verwalten.md)
