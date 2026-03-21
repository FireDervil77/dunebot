# DuneMap

Das DuneMap-Plugin bringt die interaktive Karte von *Dune: Deep Desert* in deinen Discord-Server — mit Sektoren, Markierungen und Coriolis-Sturm-Timern.

## Funktionen

- Interaktive Karte mit Grid-System (9x9)
- Marker-System für Points of Interest
- Coriolis-Sturm-Timer mit einstellbarer Zeitzone
- Sektoren-Verwaltung
- Kanal-spezifische Kartendarstellung

## Bot-Commands

| Command | Beschreibung |
|---------|-------------|
| `/map show` | Aktuelle Karte anzeigen |
| `/map set <coords> <type>` | Marker auf der Karte setzen |
| `/map remove <coords>` | Marker entfernen |
| `/showmap` | Interaktive Karte anzeigen |
| `/timer` | Coriolis-Sturm-Timer anzeigen |
| `/storm` | Nächster Sturm-Zeitpunkt |
| `/tutorial` | DuneMap-Anleitung im Discord anzeigen |
| `/channels` | Kanal für Kartendarstellung konfigurieren |

## Marker-System

Du kannst verschiedene Marker auf der Karte platzieren:
- Ressourcen-Fundorte
- Gefahrenzonen
- Basen und Lager
- Eigene Marker-Typen

Jeder Marker hat Koordinaten im Grid-System (z.B. `A3`, `E5`, `H7`).

## Coriolis-Sturm-Timer

Der Sturm-Timer zeigt an, wann der nächste Coriolis-Sturm in *Dune: Deep Desert* erwartet wird. Die Zeitzone wird serverseitig konfiguriert.

## Dashboard-Einstellungen

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Grid-Breite | Kartenbreite in Sektoren | `9` |
| Grid-Höhe | Kartenhöhe in Sektoren | `9` |
| Tile-Größe | Pixel pro Sektor | `70` |
| Gleicher Kanal | Karte im gleichen Kanal ausgeben | Ja |
| Sturm-Zeitzone | Zeitzone für den Timer | `Europa/Berlin` |
| Timer-Format | Anzeigeformat des Timers | `HH:mm:ss` |
| Sturm-Dauer | Zyklus-Dauer | `5d` |
| Karten-Kanal | Fester Kanal für die Karte | — |

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `DUNEMAP.VIEW` | DuneMap-Bereich sehen |
| `DUNEMAP.SETTINGS_EDIT` | Einstellungen ändern |
| `DUNEMAP.SECTORS_CREATE/EDIT/DELETE` | Sektoren verwalten |
| `DUNEMAP.MARKERS_CREATE/EDIT/DELETE` | Marker verwalten |
| `DUNEMAP.ADMIN_MANAGE` | Vollzugriff auf alle Map-Funktionen |
