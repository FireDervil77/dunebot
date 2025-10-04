Analyse: Theme-Management DuneBot vs. WordPress

1. WordPress Theme-System – Prinzipien

- themes sind Verzeichnisse mit PHP-Dateien, CSS, JS, Bildern
- Globale Funktionen: z.B. get_template_part(), get_header(), get_footer(), get_sidebar()
- Theme-Optionen: Über die Customizer-API, Theme-Option-Panels, und functions.php
- Hooks: add_action, add_filter für Theme und Plugins
- Template-Hierarchie: Automatische Auswahl der passenden Datei (z.B. single.php, page.php, archive.php)
- Globale Variablen: $wp_query, $post, $user, $theme_mods sind überall verfügbar
- Übersetzungen: Globale Funktionen wie __(), _e(), esc_html__()
- Theme-Overrides: Child-Themes können jede Datei überschreiben
- Einfache Einbindung von Partials: get_template_part('partials/footer') – Kontext wird automatisch übernommen



2. DuneBot Theme-System – Status

- Themes sind JS/EJS-Verzeichnisse mit layouts, partials, assets
- Globale Helper: theme.includePartial(), theme.asset()
- Theme-Kontext: themeContext + app.locals + (teilweise) res.locals
- Optionen: Nur als JSON/JS-Objekt im Theme, keine GUI/Customizer
- Hooks: Theme-spezifische und Plugin-Hooks, aber nicht so universell wie WP
- Template-Auswahl: Manuell per Controller/Route, keine automatische Hierarchie
- Globale Variablen: Müssen explizit gesetzt und weitergereicht werden (z.B. user, guild, coreConfig)
- Übersetzungen: tr()-Funktion, aber Kontext muss weitergereicht werden
- Theme-Overrides: Plugins können Partials überschreiben, aber kein echtes Child-Theme-System
- Partials: Müssen explizit mit Kontext (locals) eingebunden werden



3. Was fehlt / Was ist komplexer?

- Automatische Template-Hierarchie: WP wählt automatisch die passende Datei, DuneBot braucht explizite Controller-Logik
- Globale Variablen: WP gibt alles automatisch weiter, DuneBot muss locals explizit mergen
- Customizer/Optionen: WP bietet GUI für Theme-Optionen, DuneBot nur statisch im Code
- Child-Themes: WP erlaubt einfaches Überschreiben, DuneBot nur per Plugin/Override
- Hooks: WP-Hooks sind universell und überall verfügbar, DuneBot-Hooks sind teils nur im Theme/Plugin
- Partial-Rendering: WP übernimmt Kontext automatisch, DuneBot braucht locals explizit
- Übersetzungen: WP: globale Funktionen, DuneBot: tr() muss im Kontext sein
- Asset-Management: WP: wp_enqueue_script/style, DuneBot: theme.asset(), aber keine Prioritäten/Abhängigkeiten



4. Verbesserungsvorschläge für DuneBot

A) Globale Kontext-Weitergabe vereinfachen

- Automatisch alle res.locals beim Rendern von Partials mergen (wie WP)
- Helper: theme.renderPartial('footer') übernimmt immer den aktuellen Kontext

B) Template-Hierarchie einführen
- Automatische Auswahl von Templates je nach Route/Controller (z.B. guild-dashboard.ejs, - guild-settings.ejs)
- Fallback auf default.ejs wie WP

C) Theme-Optionen GUI
- Theme-Optionen als JSON/DB speichern, GUI im Dashboard anbieten (Customizer-Panel)
- Optionen per Helper theme.getOption('color') überall verfügbar machen

D) Child-Theme/Overrides
- hild-Theme-Konzept: Theme kann ein anderes als Parent setzen, Dateien werden überschrieben
- Plugins können Theme-Partials überschreiben, aber Child-Theme hat Vorrang

E) Hooks vereinheitlichen
- Einheitliches Hook-System für Theme und Plugins, überall verfügbar
- Helper: do_action('before_footer'), apply_filters('theme_option', ...)

F) Asset-Management vereinfachen
- Helper: theme.enqueueScript('main.js', { priority: 10 })
- Automatische Einbindung im Layout, Prioritäten und Abhängigkeiten wie WP

G) Übersetzungen vereinfachen
- Globale Übersetzungsfunktionen: __(), _e(), überall verfügbar, Kontext automatisch




5. Konkrete ToDos für DuneBot

1. Globale Kontext-Weitergabe:
- theme.includePartial immer mit allen res.locals mergen (siehe vorherige Antwort)

2. Theme-Optionen:
- Theme-Optionen als JSON/DB, GUI im Dashboard, Helper zum Zugriff

3. Template-Hierarchie:
- Automatische Auswahl/Fallbacks für Views und Partials

4. Child-Theme/Overrides:
- Parent/Child-Theme-Konzept, Priorität bei Datei-Auswahl

5. Hooks:
- Einheitliches, globales Hook-System für Theme und Plugins

6. Asset-Management:
- enqueueScript/enqueueStyle mit Priorität und Abhängigkeit

7. Übersetzungen:
- Globale Übersetzungsfunktionen, Kontext automatisch