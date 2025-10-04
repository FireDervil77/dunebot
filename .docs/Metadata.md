DuneBot Plugin-Metadaten (package.json) – Dokumentation

Pflichtfelder (Root-Ebene)
Feld	Typ	Pflicht	Beschreibung
name	string	ja	Eindeutiger Plugin-Name (z.B. "core", "myPlugin")
version	string	ja	Version des Plugins (SemVer, z.B. "1.0.0")
displayName	string	ja	Anzeigename für UI
description	string	ja	Kurzbeschreibung des Plugins
author	string	ja	Autor/Entwickler
main	string	nein	Einstiegspunkt (z.B. "dashboard/index.js")
bot	string	nein	Einstiegspunkt für Bot-Komponente
dashboard	string	nein	Einstiegspunkt für Dashboard-Komponente
repository	string	nein	Link zum Quellcode/Repo
dependencies	object	nein	NPM-Abhängigkeiten des Plugins

2. DuneBot-spezifischer Block (dunebot)
Feld	Typ	Pflicht	Beschreibung
type	array	ja	["bot"], ["dashboard"] oder ["bot", "dashboard"]
navigation	object	nein	Navigationspunkte für Dashboard/Bot
options	object	nein	Konfigurationsoptionen für das Plugin
widgets	array	nein	Dashboard-Widgets, die das Plugin bereitstellt
locales	object	nein	Lokalisierungsdaten/Sprachen
models	object	nein	Datenbank-Models, die das Plugin bereitstellt
hooks	object	nein	Eigene Hooks, die das Plugin registriert
guildSections	array	nein	Guild-Bereiche für das Dashboard (Adminbereiche)
publicAssets	array/bool	nein	Öffentliche Assets (CSS, JS, Bilder) für das Dashboard
shortcodes	object	nein	Shortcodes für Templates
permissions	object	nein	Berechtigungen/Rollen, die das Plugin benötigt
requires	object	nein	Mindestanforderungen (z.B. DuneBot-Version, Node-Version)
tags	array	nein	Schlagworte/Kategorien für das Plugin
category	string	nein	Kategorie des Plugins (z.B. "utility", "game")

{
  "info": {
    "name": "myplugin",
    "displayName": "DuneBot Beispiel",
    "version": "1.0.0",
    "description": "Ein Beispiel-Plugin für DuneBot.",
    "author": "FireDervil",
    "repository": "https://github.com/firedervil77/dunebot-plugins",
    "tags": ["utility", "demo"],
    "category": "utility",
    "requires": {
      "dunebot": ">=0.1.0",
      "node": ">=16.0.0"
    },
    "dependencies": {
      "dunebot-sdk": "*"
    }
  },
  "dashboard": {
    "main": "dashboard/index.js",
    "navigation": {
      "title": "Beispiel",
      "icon": "icon.png",
      "order": 2,
      "path": "/dashboard/beispiel"
    },
    "options": {
      "configurable": true,
      "defaultConfig": {
        "prefix": "!",
        "enabled": true
      }
    },
    "widgets": [
      {
        "name": "BeispielWidget",
        "component": "widgets/BeispielWidget.ejs"
      }
    ],
    "locales": {
      "de-DE": "locales/de-DE.json",
      "en-US": "locales/en-US.json"
    },
    "models": {
      "settings": "models/settings.sql"
    },
    "hooks": {
      "after_enable_plugin": "dashboard/hooks/afterEnable.js"
    },
    "guildSections": [
      {
        "id": "general",
        "title": "Allgemein",
        "component": "views/guild/general.ejs"
      }
    ],
    "publicAssets": [
      "public/css/beispiel.css",
      "public/js/beispiel.js"
    ],
    "shortcodes": {
      "beispiel": "dashboard/shortcodes/beispiel.js"
    },
    "permissions": ["ADMIN", "MODERATOR"]
  },
  "bot": {
    "main": "bot/index.js",
    "commands": [
        {
            "name": "beispiel",
            "description": "Beispiel-Bot-Befehl",
            "types": ["prefix", "slash"], // Immer beide Typen!
            "handler": "bot/commands/beispiel.js"
        }
    ],
    "events": [
      {
        "name": "guildMemberAdd",
        "handler": "bot/events/onGuildMemberAdd.js"
      }
    ],
    "locales": {
      "de-DE": "bot/locales/de-DE.json",
      "en-US": "bot/locales/en-US.json"
    },
    "models": {
      "settings": "bot/models/settings.sql"
    },
    "hooks": {
      "after_enable_plugin": "bot/hooks/afterEnable.js"
    },
    "permissions": ["MANAGE_GUILD"]
  }
}

Pflichtfelder müssen immer vorhanden sein.
Optionale Felder können fehlen, sollten aber bei Bedarf validiert werden.
type gibt an, ob das Plugin Bot, Dashboard oder beide Komponenten bereitstellt.
Navigation, Widgets, AdminSections sind nur für Dashboard relevant.
Permissions, Commands, Events sind nur für Bot relevant.
publicAssets kann ein Array oder true sein (wenn alle Assets im Ordner bereitgestellt werden).
requires prüft Mindestversionen von DuneBot und Node.js.
category/tags helfen bei der Plugin-Suche und Kategorisierung.
Wenn ein Bereich fehlt (z.B. keine Dashboard-Komponente), können die entsprechenden Felder einfach weggelassen werden.
