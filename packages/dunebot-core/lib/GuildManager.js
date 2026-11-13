const path = require("path");
const ServiceManager = require("./ServiceManager");
const defaultConfig = require("../config/guild-defaults.json");
const { spracheAusDiscord } = require("./Sprachwahl");

/**
 * GuildManager – Zentraler Service für Guild-Registrierung und -Verwaltung
 *
 * Kapselt den kompletten Lebenszyklus einer Guild:
 *  - Registrierung / Re-Join
 *  - Sync beim Bot-Start
 *  - Verlassen markieren (gelöscht wird im Dashboard, G-04d)
 *  - Default-Konfiguration initialisieren
 *  - Core-Plugin-Aktivierung pro Guild
 *
 * Wird im ServiceManager als 'guildManager' registriert.
 *
 * @author FireDervil
 */
class GuildManager {
    /**
     * @param {Object} options
     * @param {Function} [options.getPluginManager] - Callback der den PluginManager zurückgibt
     *        (lazy, da PluginManager erst nach GuildManager initialisiert wird)
     */
    constructor({ getPluginManager } = {}) {
        this._getPluginManager = getPluginManager || null;
    }

    // ─────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────

    /**
     * Registriert oder aktualisiert eine Guild (guildCreate-Event / Re-Join)
     * @param {import('discord.js').Guild} guild
     */
    async registerGuild(guild) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        Logger.info(`Guild beigetreten: ${guild.name} (${guild.id})`);

        // 1. Guild in DB speichern / Re-Join aktualisieren
        await dbService.query(`
            INSERT INTO guilds
                (_id, guild_name, owner_id, owner_name, joined_at, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, NOW(), NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                guild_name  = VALUES(guild_name),
                owner_id    = VALUES(owner_id),
                owner_name  = VALUES(owner_name),
                joined_at   = VALUES(joined_at),
                left_at     = NULL,
                updated_at  = NOW()
        `, [
            guild.id,
            guild.name,
            guild.ownerId,
            guild.owner?.user?.username || null,
        ]);

        // 2. Prüfen ob Guild bereits konfiguriert ist
        const existing = await dbService.query(
            "SELECT COUNT(*) AS count FROM guild_plugins WHERE guild_id = ?",
            [guild.id]
        );

        if (!existing || existing[0].count === 0) {
            Logger.info(`Neue Guild – initialisiere Config für ${guild.id}`);
            await this.initGuildConfigs(guild.id);
            await this.spracheAusDiscordUebernehmen(guild);
            await this._seedDefaultGroups(guild.id);
            await this.ensureGuildPlugins(guild.id, guild.client);
        } else {
            Logger.info(`Guild ${guild.id} war bereits konfiguriert (Re-Join) – prüfe Gruppen...`);
            await this._seedDefaultGroups(guild.id);
        }

        // 3. Sprache ans Guild-Objekt haengen
        //
        // Bei einer neuen Guild hat das `spracheAusDiscordUebernehmen()` schon
        // getan. Bei einem **Re-Join** steht die Sprache seit damals in der
        // Datenbank, das frische Guild-Objekt kennt sie aber nicht: `getT()`
        // liest `guild.locale`, und ohne diese Zeile faellt es auf
        // `client.defaultLanguage` zurueck — die Begruessung einer englischen
        // Guild kaeme auf Deutsch.
        if (!guild.locale) {
            const konfiguration = await dbService.getConfigs(guild.id);
            guild.locale = konfiguration?.LOCALE || guild.client?.defaultLanguage || "de-DE";
        }

        // 4. IPC-Event an Dashboard senden
        this._notifyDashboardJoined(guild);
    }

    /**
     * Synchronisiert eine bestehende Guild beim Bot-Start (ready-Event)
     * @param {import('discord.js').Guild} guild
     */
    async syncGuild(guild) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        const owner = guild.members.cache.get(guild.ownerId) ||
            await guild.members.fetch(guild.ownerId).catch(() => null);

        // Guild upserten
        await dbService.upsertGuild({
            _id: guild.id,
            name: guild.name,
            owner_id: guild.ownerId,
            owner_name: owner?.user?.username || null,
            joined_at: guild.joinedAt ? new Date(guild.joinedAt) : new Date(),
            left_at: null,
        });

        // Konfiguration prüfen / initial anlegen
        const existing = await dbService.query(
            "SELECT COUNT(*) AS count FROM guild_plugins WHERE guild_id = ?",
            [guild.id]
        );

        if (!existing || existing[0].count === 0) {
            Logger.info(`Initialisiere Config für Guild "${guild.name}" (${guild.id})`);
            await this.initGuildConfigs(guild.id);
            await this.spracheAusDiscordUebernehmen(guild);
            await dbService.enablePluginForGuild(guild.id, "core", null, null);
        } else {
            Logger.debug(`Guild "${guild.name}" (${guild.id}) bereits konfiguriert`);
        }

        // Gruppen immer sicherstellen (idempotent)
        await this._seedDefaultGroups(guild.id);
    }

    /**
     * Guild verlassen (guildDelete-Event): als verlassen markieren und das
     * Dashboard zum Löschen anstoßen (G-04d, K381, F-G3 C: sofort).
     *
     * Gelöscht wird nicht hier, sondern im Dashboard
     * (`apps/dashboard/helpers/VerlasseneGuilds.js`) über
     * `Datenauskunft.guildLoeschen`: Jedes Plugin schaltet über seinen eigenen
     * Weg ab, gameserver stoppt und löscht dabei seine Server, danach gehen die
     * Zeilen nach den Erklärungen (`guildInhalte`). Bis 2026-11-13 löschte
     * `_cleanupAllGuildData` hier über `SHOW TABLES` aus jeder Tabelle mit
     * `guild_id`, auch Gameserver-Zeilen ohne Stoppen, auch in der
     * Kontroll-Guild.
     *
     * `left_at` ist der Auftrag: Erreicht der Anstoß das Dashboard nicht, holt
     * es beim Start und stündlich nach. Fehlt die Zeile schon, hat „Server
     * löschen“ (G-04c) vorher gelöscht und den Bot dann gehen lassen.
     *
     * @param {import('discord.js').Guild} guild
     */
    async removeGuild(guild) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        // Ausfall bei Discord, kein Verlassen.
        if (!guild.available) return;

        const erg = await dbService.query(
            "UPDATE guilds SET left_at = NOW(), updated_at = NOW() WHERE _id = ?",
            [guild.id]
        );
        if (!erg?.affectedRows) {
            Logger.info(`Guild verlassen: ${guild.name} (${guild.id}) – schon gelöscht, nichts zu tun`);
            return;
        }

        if (String(guild.id) === String(process.env.CONTROL_GUILD_ID)) {
            Logger.error(`Der Bot ist nicht mehr in der Kontroll-Guild ${guild.name} (${guild.id}). ` +
                "Ihre Inhalte bleiben. Bot wieder einladen.");
            return;
        }

        const ipcClient = ServiceManager.has("ipcClient") ? ServiceManager.get("ipcClient") : null;
        const antwort = ipcClient
            ? await ipcClient.sendToDashboard("core:VERLASSEN_ANSTOSS", {}, 5000)
            : { success: false, error: "kein IPC" };
        if (antwort?.success) {
            Logger.info(`Guild verlassen: ${guild.name} (${guild.id}) – das Dashboard löscht jetzt, Rückmeldung je Plugin in seinem Log ([Verlassen])`);
        } else {
            Logger.warn(`Guild verlassen: ${guild.name} (${guild.id}) – Dashboard nicht angestoßen (${antwort?.error || "keine Antwort"}). ` +
                "Es löscht beim nächsten Start oder spätestens in einer Stunde.");
        }
    }

    /**
     * Initialisiert die Default-Konfiguration für eine neue Guild
     * @param {string} guildId
     */
    async initGuildConfigs(guildId) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        const flatConfig = this._flattenConfig(defaultConfig);

        const stats = await dbService.ensureConfigs("core", flatConfig, "shared", guildId);

        Logger.info(`Guild-Config für ${guildId}: ${stats.created} erstellt, ${stats.existing} vorhanden`);
    }

    /**
     * Uebernimmt die in Discord eingestellte Sprache der Guild als `LOCALE`.
     *
     * Laeuft **nur fuer neue Guilds**, direkt nach `initGuildConfigs()`. Der
     * Aufruf danach ist Absicht: `initGuildConfigs` schreibt die Vorgabe
     * `de-DE` aus `guild-defaults.json` und ueberschreibt nichts Vorhandenes —
     * hier wird sie einmalig durch die Einstellung des Servers ersetzt. Eine
     * spaeter von Hand gewaehlte Sprache ruehrt niemand mehr an, weil diese
     * Methode bei einem Re-Join nicht laeuft.
     *
     * Setzt zusaetzlich `guild.locale` am Objekt, damit die Begruessung im
     * selben Durchlauf schon in der richtigen Sprache herausgeht. Ohne diese
     * Zeile bliebe es bis zum naechsten Bot-Start bei `client.defaultLanguage`.
     *
     * @param {import('discord.js').Guild} guild
     */
    async spracheAusDiscordUebernehmen(guild) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        const sprache = spracheAusDiscord(guild.preferredLocale);

        await dbService.setConfig("core", "LOCALE", sprache, "shared", guild.id, false);
        guild.locale = sprache;

        Logger.info(
            `Sprache fuer neue Guild ${guild.id}: ${sprache} ` +
            `(Discord meldet "${guild.preferredLocale || "nichts"}")`
        );
    }

    /**
     * Aktiviert das Core-Plugin für eine neue Guild via PluginManager
     * @param {string} guildId
     * @param {import('discord.js').Client} client
     */
    async ensureGuildPlugins(guildId, client) {
        const Logger = ServiceManager.get("Logger");
        const pluginManager = client?.pluginManager || (this._getPluginManager ? this._getPluginManager() : null);

        if (pluginManager) {
            Logger.info(`Aktiviere Core-Plugin für neue Guild ${guildId} via PluginManager...`);
            await pluginManager.enableInGuild("core", guildId);
            Logger.success(`Core-Plugin für Guild ${guildId} vollständig initialisiert`);
        } else {
            // Fallback: Nur DB-Eintrag
            const dbService = ServiceManager.get("dbService");
            await dbService.enablePluginForGuild(guildId, "core", null, null);
            Logger.warn(`Core-Plugin für Guild ${guildId} nur in DB aktiviert (PluginManager nicht verfügbar)`);
        }
    }

    // ─────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────

    /**
     * Erstellt Standard-Gruppen für eine neue Guild (idempotent).
     *
     * Administrator-Gruppe bekommt dynamisch ALLE Einträge aus permission_definitions
     * (Kern-Permissions + aktivierte Plugin-Permissions). So hat jede neue Guild
     * sofort den vollen Satz — weitere Plugin-Permissions werden via
     * registerPluginPermissionsForGuild ergänzt wenn Plugins aktiviert werden.
     *
     * Moderator / Support / User starten leer. Ihre Rechte werden über das
     * default_groups-Feld in der permissions.json jedes Plugins gefüllt, sobald
     * ein Plugin für die Guild aktiviert wird.
     *
     * @param {string} guildId
     */
    async _seedDefaultGroups(guildId) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        // ── 1. Alle aktiven Permissions aus der globalen Tabelle laden ─────────
        let adminPermissions = {};
        try {
            const permDefs = await dbService.query(
                'SELECT permission_key, category FROM permission_definitions WHERE is_active = 1'
            );
            // SYSTEM & SUPERADMIN Permissions nur auf der Control-Guild vergeben
            const isControlGuild = guildId === process.env.CONTROL_GUILD_ID;
            for (const p of (permDefs || [])) {
                if (!isControlGuild && (p.category === 'system' || p.category === 'superadmin')) {
                    continue;
                }
                adminPermissions[p.permission_key] = true;
            }
        } catch (err) {
            Logger.warn(`_seedDefaultGroups: permission_definitions nicht lesbar – ${err.message}`);
        }

        // Fallback: minimales Set falls Tabelle noch leer ist (Fresh-Install)
        if (Object.keys(adminPermissions).length === 0) {
            Logger.warn(`_seedDefaultGroups Guild ${guildId}: permission_definitions leer, nutze Minimal-Fallback`);
            adminPermissions = {
                'DASHBOARD.ACCESS': true,
                'PERMISSIONS.VIEW': true,
                'PERMISSIONS.USERS.VIEW': true,
                'PERMISSIONS.GROUPS.VIEW': true,
            };
        }

        // ── 2. Struktur der Standard-Gruppen ─────────────────────────────────
        // Moderator/Support/User starten leer – Befüllung erfolgt durch
        // registerPluginPermissionsForGuild → default_groups in permissions.json
        const subGroups = [
            {
                name: 'Moderator', slug: 'moderator',
                description: 'Moderations-Berechtigungen (werden durch Plugins befüllt)',
                color: '#007bff', icon: 'fa-solid fa-user-shield',
                is_protected: false, is_default: false, priority: 50,
            },
            {
                name: 'Support', slug: 'support',
                description: 'Support-Berechtigungen (werden durch Plugins befüllt)',
                color: '#28a745', icon: 'fa-solid fa-headset',
                is_protected: false, is_default: false, priority: 25,
            },
            {
                name: 'User', slug: 'user',
                description: 'Basis-Zugriff auf Dashboard',
                color: '#6c757d', icon: 'fa-solid fa-user',
                is_protected: false, is_default: true, priority: 1,
            }
        ];

        // ── 3. Administrator: erstellen ODER bestehende Permissions mergen ────
        let created = 0;
        const [existingAdmin] = await dbService.query(
            'SELECT id, permissions FROM guild_groups WHERE guild_id = ? AND slug = ?',
            [guildId, 'administrator']
        ).catch(() => []);

        if (existingAdmin) {
            // Merge: neue Permissions aus permission_definitions ergänzen
            const currentPerms = existingAdmin.permissions
                ? JSON.parse(existingAdmin.permissions) : {};
            let merged = 0;
            for (const key of Object.keys(adminPermissions)) {
                if (!currentPerms[key]) { currentPerms[key] = true; merged++; }
            }
            if (merged > 0) {
                await dbService.query(
                    'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
                    [JSON.stringify(currentPerms), existingAdmin.id]
                );
                Logger.info(`Administrator-Gruppe Guild ${guildId}: ${merged} neue Permissions gemergt`);
            }
        } else {
            await dbService.query(`
                INSERT INTO guild_groups
                    (guild_id, name, slug, description, color, icon, is_protected, is_default, priority, permissions)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [guildId, 'Administrator', 'administrator',
                'Vollzugriff auf alle Dashboard-Funktionen',
                '#dc3545', 'fa-solid fa-shield-halved',
                1, 0, 100, JSON.stringify(adminPermissions)]);
            created++;
        }

        // ── 4. Untergruppen: nur erstellen wenn noch nicht vorhanden ──────────
        for (const g of subGroups) {
            const [existing] = await dbService.query(
                'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
                [guildId, g.slug]
            ).catch(() => []);
            if (existing) continue;

            await dbService.query(`
                INSERT INTO guild_groups
                    (guild_id, name, slug, description, color, icon, is_protected, is_default, priority, permissions)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [guildId, g.name, g.slug, g.description, g.color, g.icon,
                0, g.is_default ? 1 : 0, g.priority, '{}']);
            created++;
        }

        if (created > 0) {
            Logger.info(`Standard-Gruppen für Guild ${guildId}: ${created} erstellt`);
        } else {
            Logger.debug(`Standard-Gruppen für Guild ${guildId}: alle bereits vorhanden`);
        }
    }

    /**
     * Sendet ein IPC-Event an das Dashboard, wenn eine Guild beitritt
     * @param {import('discord.js').Guild} guild
     */
    _notifyDashboardJoined(guild) {
        try {
            const ipcClient = guild.client?.ipcClient;
            if (ipcClient) {
                ipcClient.send("dashboard:GUILD_JOINED", {
                    guildId: guild.id,
                    guildName: guild.name,
                });
            }
        } catch (err) {
            const Logger = ServiceManager.get("Logger");
            Logger.warn(`IPC GUILD_JOINED fehlgeschlagen: ${err.message}`);
        }
    }

    /**
     * Macht ein verschachteltes Config-Objekt flach (key_subKey)
     * @param {Object} obj
     * @returns {Object}
     */
    _flattenConfig(obj) {
        const result = {};
        for (const key in obj) {
            if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
                const nested = this._flattenConfig(obj[key]);
                for (const sub in nested) {
                    result[`${key}_${sub}`] = nested[sub];
                }
            } else {
                result[key] = obj[key];
            }
        }
        return result;
    }
}

module.exports = GuildManager;
