'use strict';

/**
 * Streaming - aktive Meldungen an die Betroffenen.
 *
 * **Warum es das braucht:** Eine Seite hilft nur dem, der sie oeffnet. Der
 * schlimmste Zustand dieses Plugins ist der, in dem alles gruen aussieht und
 * trotzdem nichts ankommt - und den bemerkt niemand, weil es keinen Anlass
 * gibt, nachzusehen.
 *
 * Das Urteil faellt in `kern/stoerung.js`; hier wird nur gesendet.
 *
 * **Es wird sparsam gemeldet.** Eine Meldung, die taeglich kommt, ist nach
 * einer Woche eine Meldung, die niemand liest - und dann fehlt sie genau dann,
 * wenn sie zaehlt. Jede Stoerung wird deshalb **einmal** gemeldet und erst
 * wieder, wenn sie sich behoben hat und neu auftritt.
 *
 * @module streaming/dashboard/ausgabe/meldung
 */

const { ServiceManager } = require('dunebot-core');
const stoerung = require('../kern/stoerung');

/** Wie lange eine Stille-Meldung gilt, bevor sie erneut kommen darf. */
const STILLE_ABSTAND_MS = 24 * 60 * 60 * 1000;

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Logger */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Eine Meldung absetzen.
 *
 * Nutzt `SEND_NOTIFICATION` aus dem Kern statt eines eigenen Wegs - der kennt
 * die Kontroll-Guild, die Sprachen und die Zustellarten bereits.
 *
 * @param {Object} m Meldung
 * @param {string} m.titel Ueberschrift
 * @param {string} m.text Inhalt
 * @param {string} [m.art='warning'] info | warning | error
 * @param {Array<string>} m.guildIds Zielguilds
 * @param {string|null} [m.kanalId] bestimmter Kanal; sonst der Systemkanal
 * @returns {Promise<boolean>} ob der Bot geantwortet hat
 */
async function senden({ titel, text, art = 'warning', guildIds, kanalId = null }) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer || !guildIds?.length) return false;

    try {
        await ipcServer.broadcastOne('dashboard:SEND_NOTIFICATION', {
            id: 'streaming',
            title_translations:   { 'de-DE': titel },
            message_translations: { 'de-DE': text },
            action_text_translations: { 'de-DE': 'Zustand ansehen' },
            type: art,
            // Ein bestimmter Kanal, wenn wir einen kennen - sonst der
            // Systemkanal der Guild. Beides kann fehlen; dann meldet der
            // Kern-Handler das, und wir haben es wenigstens versucht.
            delivery_method: kanalId ? ['discord_channel'] : ['system_channel'],
            discord_channel_id: kanalId,
            target_guild_ids: guildIds
        }, true);
        return true;
    } catch (err) {
        log().warn(`[Streaming/Meldung] Konnte nicht gesendet werden: ${err.message}`);
        return false;
    }
}

/**
 * Ein Lauf: nachsehen, ob etwas zu melden ist.
 *
 * @param {Object} [optionen] Optionen
 * @param {boolean} [optionen.trocken=false] nur zeigen
 * @returns {Promise<Object>} Bericht
 */
async function lauf({ trocken = false } = {}) {
    const bericht = { gelaufen_am: new Date().toISOString(), trocken, stoerungen: 0, stille: null };

    // ---------------------------------------------------------------
    // 1. Widerrufene und fehlerhafte Abos
    // ---------------------------------------------------------------
    const abos = await db().query(`
        SELECT a.id, a.zustand, a.gemeldet_am, a.fehlertext, a.ereignis, s.login
          FROM streaming_subscriptions a
          JOIN streaming_streamers s ON s.id = a.streamer_id
    `);

    // Was wieder laeuft, wird vergessen - sonst bleibt eine behobene Stoerung
    // als "schon gemeldet" stehen und der naechste Ausfall bliebe still.
    if (!trocken) {
        await db().query(
            "UPDATE streaming_subscriptions SET gemeldet_am = NULL WHERE gemeldet_am IS NOT NULL AND zustand NOT IN ('widerrufen', 'fehler')");
    }

    const offen = stoerung.offeneStoerungen(abos);
    bericht.stoerungen = offen.length;

    for (const a of offen) {
        // Wer ist betroffen? Alle Guilds, die diesen Kanal beobachten - und
        // die Kontroll-Guild, weil ein Widerruf uns betrifft, nicht sie.
        const ziele = await db().query(`
            SELECT DISTINCT t.guild_id, t.channel_id
              FROM streaming_targets t
              JOIN streaming_subscriptions x ON x.streamer_id = t.streamer_id
             WHERE x.id = ? AND t.aktiv = 1
        `, [a.id]);

        const titel = `Streaming: Abo gestoert (${a.login})`;
        const text = `Das Abonnement **${a.ereignis}** fuer **${a.login}** steht auf `
            + `\`${a.zustand}\`${a.fehlertext ? ` — ${a.fehlertext}` : ''}.\n\n`
            + 'Solange das so bleibt, kommt fuer diesen Kanal **keine Ankuendigung** mehr. '
            + 'Der taegliche Abgleich versucht, es von selbst zu richten.';

        if (trocken) continue;

        for (const ziel of ziele) {
            await senden({ titel, text, art: 'error', guildIds: [ziel.guild_id], kanalId: ziel.channel_id });
        }

        const kontrolle = process.env.CONTROL_GUILD_ID;
        if (kontrolle) await senden({ titel, text, art: 'error', guildIds: [kontrolle] });

        await db().query('UPDATE streaming_subscriptions SET gemeldet_am = NOW() WHERE id = ?', [a.id]);
        log().warn(`[Streaming/Meldung] Stoerung gemeldet: ${a.login}/${a.ereignis} (${a.zustand})`);
    }

    // ---------------------------------------------------------------
    // 2. Stille, obwohl Abos stehen
    // ---------------------------------------------------------------
    const [lage] = await db().query(`
        SELECT SUM(CASE WHEN zustand = 'bestaetigt' THEN 1 ELSE 0 END) AS bestaetigt,
               MAX(letzte_meldung_am) AS zuletzt
          FROM streaming_subscriptions
    `);

    const urteil = stoerung.stilleVerdaechtig(
        { bestaetigteAbos: Number(lage?.bestaetigt || 0), letzteMeldungAm: lage?.zuletzt },
        Date.now());
    bericht.stille = urteil;

    if (urteil.melden && !trocken) {
        const zuletztGemeldet = await db().getConfig('streaming', 'STILLE_GEMELDET_AM', 'shared', null);
        const dann = zuletztGemeldet ? new Date(zuletztGemeldet).getTime() : 0;

        if (Date.now() - dann < STILLE_ABSTAND_MS) {
            bericht.stille = { ...urteil, melden: false, grund: urteil.grund + ' (schon gemeldet)' };
        } else {
            const kontrolle = process.env.CONTROL_GUILD_ID;
            if (kontrolle) {
                await senden({
                    titel: 'Streaming: seit Stunden keine Zustellung',
                    text: `Es stehen **${lage.bestaetigt}** bestaetigte Abonnements, aber ${urteil.grund}.\n\n`
                        + 'Das ist der Zustand, in dem alles in Ordnung **aussieht** und trotzdem nichts ankommt. '
                        + 'Zu pruefen: Ist der Eingang von aussen erreichbar? Steht in `streaming_events` etwas Neues?',
                    art: 'error',
                    guildIds: [kontrolle]
                });
                await db().setConfig('streaming', 'STILLE_GEMELDET_AM', new Date().toISOString(), 'shared', '', true);
                log().error(`[Streaming/Meldung] ${urteil.grund} — Kontroll-Guild benachrichtigt`);
            }
        }
    }

    return bericht;
}

module.exports = { STILLE_ABSTAND_MS, senden, lauf };
