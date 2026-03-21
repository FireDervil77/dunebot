# Plugins verwalten

DuneBot ist modular aufgebaut — Funktionen werden über Plugins bereitgestellt, die du einzeln aktivieren und konfigurieren kannst.

## Plugin-Übersicht

Gehe im Dashboard zu **Plugins**, um alle verfügbaren Plugins zu sehen. Jedes Plugin zeigt:

- Name und Beschreibung
- Version
- Status (Aktiviert/Deaktiviert)

## Plugin aktivieren

1. Gehe zu **Plugins**
2. Finde das gewünschte Plugin
3. Klicke auf **Aktivieren**

Das Plugin wird sofort aktiv. Seine Menüpunkte erscheinen in der Sidebar, und die dazugehörigen Bot-Commands werden registriert.

## Plugin deaktivieren

1. Gehe zu **Plugins**
2. Klicke beim aktiven Plugin auf **Deaktivieren**

> **Hinweis:** Das Core-Plugin kann nicht deaktiviert werden, da es die Grundfunktionen des Dashboards bereitstellt.

## Plugin konfigurieren

Jedes Plugin hat eigene Einstellungsseiten, die nach der Aktivierung in der Sidebar erscheinen. Die Konfiguration ist plugin-spezifisch — Details findest du in der jeweiligen [Plugin-Dokumentation](../plugins/).

## Verfügbare Plugins

| Plugin | Beschreibung |
|--------|-------------|
| [Moderation](../plugins/moderation.md) | Ban, Kick, Warn, Timeout, Fallverwaltung |
| [AutoMod](../plugins/automod.md) | Automatische Spam- und Inhaltsfilter |
| [Greeting](../plugins/greeting.md) | Willkommens- und Abschiedsnachrichten |
| [Tickets](../plugins/tickets.md) | Support-Ticketsystem |
| [Giveaway](../plugins/giveaway.md) | Gewinnspiele mit Anforderungen |
| [Economy](../plugins/economy.md) | Währungs- und Wirtschaftssystem |
| [Leveling](../plugins/leveling.md) | XP und Level-System |
| [Information](../plugins/information.md) | Server- und User-Infos |
| [Statistik](../plugins/statistik.md) | Server-Statistiken und Tracking |
| [Social Alerts](../plugins/social-alerts.md) | Twitch/YouTube Benachrichtigungen |
| [DuneMap](../plugins/dunemap.md) | Dune: Deep Desert Karte |
| [Clan Manager](../plugins/clan-manager.md) | Clan-/Gildenverwaltung |
| [Gameserver](../plugins/gameserver.md) | Gameserver erstellen und verwalten |
| [Masterserver](../plugins/masterserver.md) | Daemon- und RootServer-Verwaltung |
| [Voice Server](../plugins/voiceserver.md) | Voice-Server Management |

## Plugin-Berechtigungen

Jedes Plugin bringt eigene Berechtigungen mit. Beim Aktivieren werden die Standard-Berechtigungen automatisch den existierenden Gruppen zugewiesen. Du kannst diese unter **Benutzer & Gruppen** → **Gruppen** anpassen.

Mehr dazu: [Berechtigungen](../getting-started/berechtigungen.md)
