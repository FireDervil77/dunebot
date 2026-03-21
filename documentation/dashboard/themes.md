# Themes & Anpassung

DuneBot bietet ein umfangreiches Theme-System, mit dem du das Aussehen deines Dashboards individuell anpassen kannst.

## Theme-Galerie

Unter **Themes** in der Sidebar findest du die Theme-Galerie mit allen verfügbaren Themes. Hier kannst du:

- Vorhandene Themes ansehen und aktivieren
- Theme-Details und Screenshots betrachten
- Child-Themes erstellen (Klone mit eigenen Anpassungen)

### Theme aktivieren

1. Gehe zu **Themes**
2. Klicke auf das gewünschte Theme
3. Klicke auf **Aktivieren**
4. Das Dashboard wird sofort im neuen Look angezeigt

## Theme-Editor

Der Theme-Editor ist das Herzstück der Anpassung. Du erreichst ihn unter **Themes** → **Editor**.

### Aufbau

Der Editor hat zwei Bereiche:
- **Links:** Konfiguration (zwei Tabs)
- **Rechts:** Live-Vorschau — Änderungen werden sofort angezeigt

### Tab 1: Farben & Variablen

Hier kannst du die wichtigsten Farben per Farbwähler anpassen:

**Hauptfarben:**
| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| Primärfarbe | Buttons, Badges, Akzente | `#3498db` |
| Akzentfarbe | Warnungen, Hervorhebungen | `#f39c12` |
| Link-Farbe | Farbe von Textlinks | `#3498db` |

**Sidebar:**
| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| Hintergrund | Sidebar-Hintergrundfarbe | `#343a40` |
| Text | Farbe der Menüeinträge | `#c2c7d0` |
| Hover-Hintergrund | Farbe beim Überfahren/Aktiv | `#495057` |

**Layout:**
| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| Header-Hintergrund | Farbe der oberen Leiste | `#3f6791` |
| Seiten-Hintergrund | Hauptbereich-Hintergrund | `#f4f6f9` |
| Card-Hintergrund | Hintergrund der Karten | `#ffffff` |
| Textfarbe | Allgemeine Schriftfarbe | `#212529` |

Neben jeder Farbe gibt es einen **Reset-Button** (↺), der die einzelne Variable auf den Standard zurücksetzt.

### Tab 2: Custom CSS

Für fortgeschrittene Anpassungen kannst du eigenes CSS schreiben. Das CSS wird **zusätzlich** zu den Farbvariablen angewendet, ohne das Theme selbst zu verändern.

**Tipps:**
- Nutze `var(--primary-color)` etc. um auf die Variablen von Tab 1 zuzugreifen
- Das CSS-Limit liegt bei 50 KB
- Die Live-Vorschau zeigt Änderungen sofort

**Buttons im CSS-Tab:**
- **Letzte Sicherung** — Stellt den zuletzt gespeicherten Stand wieder her
- **CSS zurücksetzen** — Leert das CSS-Feld (Variablen bleiben erhalten)

### Speichern & Zurücksetzen

- **Speichern** (oder `Ctrl+S`) — Übernimmt alle Änderungen
- **Zurücksetzen** (oben rechts) — Setzt *alle* Anpassungen zurück (CSS + Variablen). Löscht die Customization aus der Datenbank.

> **Wichtig:** Der "Zurücksetzen"-Button entfernt alle individuellen Anpassungen. Die Grundfarben des aktiven Themes werden dann wieder verwendet.

## Child-Themes

Du kannst ein bestehendes Theme als **Child-Theme** klonen, um auf dessen Basis eigene Anpassungen vorzunehmen, ohne das Original zu verändern.

1. Gehe zur **Theme-Galerie**
2. Klicke auf das Theme, das du als Basis nutzen möchtest
3. Wähle **Als Child-Theme klonen**
4. Vergib einen Namen
5. Das neue Theme erscheint in der Galerie und kann aktiviert werden

## Widget-Bereiche

Unter **Themes** → **Widgets** kannst du die Anordnung und Sichtbarkeit von Dashboard-Widgets konfigurieren:

- Widgets in verschiedene Bereiche verschieben
- Reihenfolge per Drag & Drop anpassen
- Einzelne Widgets ein- oder ausblenden
