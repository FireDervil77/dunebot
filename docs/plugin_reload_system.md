# Plugin Reload System

## Übersicht

Das Plugin-Reload-System ermöglicht das dynamische Nachladen von Plugin-Komponenten ohne Server-Restart:

- 📊 **Schemas** → Neue Tabellen/Spalten hinzufügen
- 📦 **Models** → Datenbank-Models aktualisieren  
- 🧭 **Navigation** → Menüpunkte dynamisch laden
- 🔄 **Commands** → Bot-Commands neu registrieren
- 📡 **Events** → Event-Handler aktualisieren
- ⚙️ **Config** → Konfiguration refreshen

## API-Referenz

### Dashboard-Plugin: `onReload(options)`

```javascript
/**
 * @param {Object} options - Reload-Optionen
 * @param {boolean} [options.schemas=true] - Schemas neu laden
 * @param {boolean} [options.models=true] - Models neu registrieren
 * @param {boolean} [options.navigation=true] - Navigation aktualisieren
 * @param {boolean} [options.config=false] - Config refreshen
 * @param {string} [options.guildId=null] - Guild ID für Navigation
 * @returns {Promise<Object>} Reload-Status
 */
const result = await plugin.onReload({
    schemas: true,
    models: true,
    navigation: true,
    config: false,
    guildId: '1234567890'
});
```

### Bot-Plugin: `onReload(options)`

```javascript
/**
 * @param {Object} options - Reload-Optionen
 * @param {boolean} [options.schemas=true] - Schemas neu laden
 * @param {boolean} [options.models=true] - Models neu registrieren
 * @param {boolean} [options.commands=false] - Commands neu laden
 * @param {boolean} [options.events=false] - Events neu laden
 * @param {boolean} [options.config=false] - Config refreshen
 * @returns {Promise<Object>} Reload-Status
 */
const result = await plugin.onReload({
    schemas: true,
    models: true,
    commands: true,
    events: true,
    config: false
});
```

## Verwendungsbeispiele

### 1. Neue Tabelle nach Plugin-Installation hinzufügen

**Szenario:** Du hast eine neue `donations.sql` in `plugins/superadmin/dashboard/schemas/` erstellt und möchtest sie laden.

```javascript
// Im Dashboard-Plugin
const pluginManager = ServiceManager.get('pluginManager');
const plugin = pluginManager.getPlugin('superadmin');

const result = await plugin.onReload({
    schemas: true,  // SQL-Dateien ausführen
    models: false,  // Models nicht neu laden
    navigation: false,
    config: false
});

console.log(result);
// Output:
// {
//   success: true,
//   schemas: { loaded: 1, failed: 0, files: ['donations.sql'] },
//   models: { registered: 0, failed: 0, names: [] },
//   navigation: { updated: false, items: 0 },
//   config: { refreshed: false },
//   errors: []
// }
```

### 2. Navigation dynamisch aktualisieren

**Szenario:** Plugin hat neue Menüpunkte, die in der Guild sichtbar sein sollen.

```javascript
// Nach Plugin-Aktivierung in einer Guild
const result = await plugin.onReload({
    schemas: false,
    models: false,
    navigation: true,  // Navigation neu laden
    config: false,
    guildId: '1403034310172475416'
});

// Navigation wird automatisch in NavigationManager aktualisiert
```

### 3. Commands nach Update neu laden

**Szenario:** Bot-Plugin hat neue Commands, die ohne Neustart verfügbar sein sollen.

```javascript
// Im Bot-Plugin
const botPluginManager = ServiceManager.get('pluginManager');
const plugin = botPluginManager.getPlugin('core');

const result = await plugin.onReload({
    schemas: false,
    models: false,
    commands: true,  // Commands neu laden
    events: false,
    config: false
});

console.log(`Reloaded ${result.commands.loaded} commands:`, result.commands.names);
// Output: "Reloaded 15 commands: ['help', 'ping', 'info', ...]"
```

### 4. Kompletter Reload nach Major-Update

**Szenario:** Plugin-Update mit neuen Tabellen, Models, Commands und Navigation.

```javascript
// Dashboard
const dashboardResult = await dashboardPlugin.onReload({
    schemas: true,
    models: true,
    navigation: true,
    config: true,
    guildId: guildId
});

// Bot
const botResult = await botPlugin.onReload({
    schemas: true,
    models: true,
    commands: true,
    events: true,
    config: true
});

if (dashboardResult.success && botResult.success) {
    console.log('✅ Plugin erfolgreich aktualisiert!');
} else {
    console.error('❌ Fehler beim Reload:', [
        ...dashboardResult.errors,
        ...botResult.errors
    ]);
}
```

## Integration in Plugin-Enable

Du kannst `onReload()` direkt in `onEnable()` oder `onGuildEnable()` aufrufen:

### Dashboard-Plugin

```javascript
class MyDashboardPlugin extends DashboardPlugin {
    async onEnable(app) {
        await super.onEnable(app);
        
        // Schemas und Models automatisch laden
        const result = await this.onReload({
            schemas: true,
            models: true,
            navigation: false,
            config: false
        });
        
        if (!result.success) {
            throw new Error(`Plugin reload failed: ${result.errors.join(', ')}`);
        }
    }
    
    async onGuildEnable(guildId) {
        // Navigation für Guild laden
        await this.onReload({
            schemas: false,
            models: false,
            navigation: true,
            config: false,
            guildId
        });
    }
}
```

### Bot-Plugin

```javascript
class MyBotPlugin extends BotPlugin {
    async onEnable(client) {
        await super.onEnable(client);
        
        // Schemas nach Bot-Start laden
        const result = await this.onReload({
            schemas: true,
            models: true,
            commands: false,  // Commands werden bereits in enable() geladen
            events: false,    // Events werden bereits in enable() geladen
            config: false
        });
        
        if (result.schemas.failed > 0) {
            Logger.warn(`Some schemas failed to load:`, result.errors);
        }
    }
}
```

## Reload-Response-Struktur

```javascript
{
    success: true,  // Gesamtstatus
    schemas: {
        loaded: 2,              // Anzahl erfolgreich geladener Schemas
        failed: 0,              // Anzahl fehlgeschlagener Schemas
        files: ['donations.sql', 'badges.sql']  // Dateinamen
    },
    models: {
        registered: 3,          // Anzahl registrierter Models
        failed: 0,              // Anzahl fehlgeschlagener Models
        names: ['Donation', 'Badge', 'User']  // Model-Namen
    },
    commands: {  // Nur Bot-Plugin
        loaded: 10,
        failed: 0,
        names: ['help', 'ping', ...]
    },
    events: {  // Nur Bot-Plugin
        loaded: 5,
        failed: 0,
        names: ['ready', 'messageCreate', ...]
    },
    navigation: {  // Nur Dashboard-Plugin
        updated: true,
        items: 3
    },
    config: {
        refreshed: true
    },
    errors: []  // Fehlermeldungen (Array of Strings)
}
```

## Best Practices

### 1. Selektives Reload
```javascript
// ✅ Gut: Nur was benötigt wird
await plugin.onReload({ schemas: true });

// ❌ Schlecht: Alles neu laden
await plugin.onReload({ 
    schemas: true, 
    models: true, 
    commands: true, 
    events: true, 
    config: true 
});
```

### 2. Error Handling
```javascript
const result = await plugin.onReload({ schemas: true });

if (!result.success) {
    Logger.error('Reload failed:', result.errors);
    
    // Rollback oder Fallback-Logik
    if (result.schemas.failed > 0) {
        await restorePreviousSchema();
    }
}
```

### 3. Logging
```javascript
const result = await plugin.onReload({ models: true });

Logger.info(`Reload completed:`, {
    plugin: plugin.name,
    models: `${result.models.registered}/${result.models.registered + result.models.failed}`,
    errors: result.errors.length
});
```

## Fehlerbehandlung

Das Reload-System ist fail-safe:
- ✅ Einzelne Komponenten können fehlschlagen, ohne andere zu beeinflussen
- ✅ Detaillierte Fehlermeldungen in `result.errors[]`
- ✅ `result.success` ist `false`, wenn irgendein Fehler auftrat
- ✅ Keine Exceptions werfen (außer bei kritischen Fehlern)

```javascript
const result = await plugin.onReload({ schemas: true, models: true });

if (!result.success) {
    console.error('Reload had errors:');
    result.errors.forEach(err => console.error(`  - ${err}`));
    
    // Trotzdem wurden erfolgreich Komponenten geladen:
    console.log(`Successfully loaded: ${result.schemas.loaded} schemas, ${result.models.registered} models`);
}
```

## Config-Reload

Für nur Config-Refresh ohne Schema/Model-Reload:

```javascript
// Option 1: Via Plugin
await plugin.onReload({ 
    schemas: false, 
    models: false, 
    config: true 
});

// Option 2: Direkt via Config-Objekt
await plugin.config.reload();  // Nur Cache löschen und neu laden
await plugin.config.reload('guild:1234567890');  // Nur spezifischen Kontext
```

## Automatisches Reload bei Plugin-Updates

Kombiniere mit dem bestehenden Plugin-Update-System:

```javascript
// In PluginManager.updatePlugin()
if (action === 'install') {
    const plugin = await this.installPlugin(pluginName);
    
    // Automatisches Schema-Reload
    await plugin.onReload({ 
        schemas: true, 
        models: true 
    });
}
```

---

**Autor:** DuneBot Development Team  
**Version:** 1.0.0  
**Letzte Aktualisierung:** 2025-10-15
