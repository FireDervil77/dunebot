const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { registerKernNavigation } = require('../../../apps/dashboard/helpers/KernNavigation');


class CoreDashboardPlugin extends DashboardPlugin {
  constructor(app) {
        super({
            name: 'core',
            displayName: 'Kern-Plugin',
            description: 'Grundlegende Funktionen für FireBot Dashboard',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-cog',
            baseDir: __dirname,
            publicAssets: true
        });
        
        this.app = app;
    }

  /**
   * Plugin aktivieren (Stub - Widgets/Hooks werden vom Kern direkt registriert)
   */
  async enable() {
      const Logger = ServiceManager.get('Logger');
      Logger.debug('[Core] CoreDashboardPlugin.enable() aufgerufen (Stub)');
      return true;
  }

  /**
   * Shortcode für Guild-Namen registrieren
   */
  _registerShortcodes() {
      this.app.shortcodeParser.register(this.name, 'guild-name', (attrs, content, context) => {
          const guildId = context.guildId || attrs.id;
          if (!guildId) return '[Keine Guild-ID]';
          const guild = this.app.client?.guilds.cache.get(guildId);
          return guild ? guild.name : '[Unbekannte Guild]';
      });
  }
  
    // `onUpdate` ist am 2026-11-09 entfallen (K028): Niemand rief den Haken auf.
    // Was er tat (Standardgruppen, Navigation), erledigen der Wiederbeitritt
    // (GuildManager) und onGuildEnable bei jedem Start.

    /**
     * Registriert guild-spezifische Navigation
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.info(`[Core] Aktiviere Core-Plugin für Guild ${guildId}`);

        try {
            await registerKernNavigation(guildId);
            Logger.info(`[Core] Navigation für Guild ${guildId} registriert`);
        } catch (error) {
            Logger.error(`[Core] Fehler bei Guild-Aktivierung für ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Datenauskunft (G-04b): Löscht ein Mitglied seine Daten überall, gehen
     * seine Stimmen (`user_feedback_votes`, übergreifend). `upvotes` ist
     * mitgezählt (feedback.router.js zählt ±1) und stimmte danach nicht mehr.
     * Hier merken, welche Rückmeldungen betroffen sind, …
     *
     * @param {{userId: string, guildId: string|null, merk: Object}} ctx
     */
    async vorMitgliedLoeschen(ctx) {
        if (ctx.guildId) return;
        const zeilen = await ServiceManager.get('dbService').query(
            'SELECT DISTINCT feedback_id FROM user_feedback_votes WHERE user_id = ?', [ctx.userId]);
        ctx.merk.rueckmeldungen = zeilen.map(z => z.feedback_id);
    }

    /**
     * … und nach dem Löschen, in derselben Transaktion, nachzählen.
     *
     * @param {{merk: Object}} ctx
     * @param {Object} verbindung offene Verbindung der Transaktion
     */
    async nachMitgliedLoeschen(ctx, verbindung) {
        const ids = ctx.merk.rueckmeldungen || [];
        if (!ids.length) return;
        await verbindung.query(`
            UPDATE user_feedback uf
               SET upvotes = (SELECT COUNT(*) FROM user_feedback_votes v WHERE v.feedback_id = uf.id)
             WHERE uf.id IN (?)`, [ids]);
    }

}
module.exports = CoreDashboardPlugin;