'use strict';

/**
 * Die Heim-Guild eines Kanals (Stufe 14).
 *
 * **Wo wird der Chatbot dieses Kanals verwaltet?** Genau eine Guild, gesetzt
 * vom Kanalinhaber. Der Hintergrund steht in
 * `docs/streamer-plugin/14-Rechte-neu-denken.md`, TEIL C.
 *
 * ## Die eine Sicherheitszusage
 *
 * **Eine Guild darf sich nicht selbst zum Heim erklaeren.** Sonst traegt
 * jemand einen fremden Kanal in seine Guild ein, klickt "Chatbot hier
 * verwalten" und redet in einem fremden Twitch-Chat. Deshalb steht in
 * `setzen()` der Nachweis in der Bedingung, nicht im Aufrufer:
 *
 *     wer setzt?          der angemeldete Benutzer
 *     darf er?            nur wenn `user_connections` seinen Nachweis
 *                         auf genau diesen Kanal zeigt
 *     wohin darf er?      nur in eine Guild, in der er selbst ist
 *
 * **Der Mod-Status genuegt dafuer nicht.** Er beweist, dass ein Bot im Chat
 * sein darf - nicht, wer der Mensch dahinter ist. Fuer den Anschluss (13a)
 * reicht er; fuer die Frage "wem gehoeren die Einstellungen" nicht.
 *
 * ## Warum das kein zweites Rechtesystem ist
 *
 * Es gibt hier keine Stufen, keine Freigabeliste, keine Vererbung. Es gibt
 * eine Zahl je Kanal. Wer in der Heim-Guild mitarbeiten darf, entscheidet die
 * Serverleitung mit dem Rechtesystem, das es seit jeher gibt - "wem der User
 * Zugriff gibt, ist nicht unsere Sache".
 *
 * @module streaming/kern/heimguild
 */

const { ServiceManager } = require('dunebot-core');
const abonnenten = require('./abonnenten');

/** @returns {Object} Datenbankdienst */
const db = () => ServiceManager.get('dbService');

/**
 * Den Streamer-Datensatz zu einem Twitch-Konto holen.
 *
 * @param {string} plattform Anbieter
 * @param {string} kontoId Kanalkennung beim Anbieter
 * @returns {Promise<Object|null>} Zeile oder null
 */
async function streamerZuKonto(plattform, kontoId) {
    const zeilen = await db().query(
        `SELECT id, plattform, kanal_id, login, anzeigename, heim_guild_id,
                chat_ansage_an, chat_ansage_text
           FROM streaming_streamers
          WHERE plattform = ? AND kanal_id = ? LIMIT 1`,
        [plattform, String(kontoId)]);
    return zeilen[0] || null;
}

/**
 * In welchen Guilds koennte dieser Benutzer sein Heim waehlen?
 *
 * Zwei Bedingungen, und beide sind noetig:
 *
 *   1. **Der Kanal wird dort verfolgt.** Sonst waehlte jemand eine Guild, die
 *      von seinem Kanal gar nichts weiss - der Chatbot haette dort weder
 *      Ankuendigung noch Ziel, an das er anknuepfen koennte.
 *   2. **Das Plugin laeuft dort.** Eine abgeschaltete Guild als Heim zu
 *      waehlen hiesse, den Chatbot an einen Ort zu haengen, der ihn nicht
 *      ausfuehrt.
 *
 * **Die Mitgliedschaft des Benutzers wird hier NICHT geprueft** - sie ist
 * nicht noetig und waere teuer: Wer seinen Kanal in einer Guild verfolgen
 * laesst, hat dort in aller Regel jemanden, der ihn eingetragen hat. Und
 * selbst wenn nicht: Die Wahl schaltet nur um, wo SEINE eigenen
 * Chat-Einstellungen bedient werden. Fremde Daten erreicht sie nicht.
 *
 * ## Warum zwei Abfragen und kein Join (2026-08-29, gegen die echte DB)
 *
 * Der erste Entwurf verband `streaming_targets` in einem Zug mit `guilds` und
 * `guild_plugins`. Gegen eine Attrappe lief das; **gegen die Datenbank warf
 * es**:
 *
 *     Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT)
 *                           and (utf8mb4_general_ci,IMPLICIT)
 *
 * Die Kern-Tabellen sind `utf8mb4_unicode_ci`, die `streaming_*`-Tabellen
 * `utf8mb4_general_ci`. Beide Spalten tragen dieselbe Discord-Kennung aus
 * Ziffern, aber MySQL vergleicht sie nicht - **jeder** Join ueber diese Grenze
 * bricht ab, statt still falsch zu antworten.
 *
 * Deshalb hier derselbe Weg, den der Rest des Hauses ohnehin geht: Die
 * Kennungen kommen aus der einen Tabelle und gehen als **Parameter** in die
 * andere. Ein gebundener Wert nimmt die Kollation seiner Spalte an, also gibt
 * es nichts zu mischen. Ein `COLLATE` im SQL taete es auch - aber dann muesste
 * jede kuenftige Abfrage daran denken, und die erste, die es vergisst, faellt
 * wieder um. Der Schema-Unterschied selbst steht als Befund in
 * `docs/Baustellen.md`; `scripts/check-kollationen.js` misst ihn.
 *
 * @param {Object} streamer Zeile aus `streaming_streamers`
 * @returns {Promise<Array<{guild_id: string, name: string, ziele: number}>>} Auswahl
 */
async function moeglicheGuilds(streamer) {
    if (!streamer) return [];

    const ziele = await db().query(
        `SELECT guild_id, COUNT(*) AS ziele
           FROM streaming_targets
          WHERE streamer_id = ?
          GROUP BY guild_id`, [streamer.id]) || [];
    if (!ziele.length) return [];

    // **Nachgesehen, nicht geraten** (2026-08-29): Die Tabelle `guilds` hat
    // `_id` und `guild_name` - nicht `guild_id` und `name`, wie es der
    // Fremdschluessel in `streaming_targets` nahelegt. Ein falsch geratener
    // Spaltenname stuerzt hier nicht ab, er zeigt still die nackte Kennung.
    //
    // `left_at IS NULL` haelt Guilds heraus, aus denen der Bot geflogen ist -
    // sie stehen weiter in der Tabelle, koennen aber nichts mehr ausfuehren.
    const kennungen = ziele.map(z => String(z.guild_id));
    const platzhalter = kennungen.map(() => '?').join(',');
    const guilds = await db().query(
        `SELECT g._id AS guild_id, g.guild_name
           FROM guilds g
           JOIN guild_plugins p ON p.guild_id = g._id
                               AND p.plugin_name = 'streaming'
                               AND p.is_enabled = 1
          WHERE g._id IN (${platzhalter})
            AND g.left_at IS NULL`, kennungen) || [];

    const namen = new Map(guilds.map(g => [String(g.guild_id), g.guild_name]));
    return ziele
        .filter(z => namen.has(String(z.guild_id)))
        .map(z => ({
            guild_id: String(z.guild_id),
            name: namen.get(String(z.guild_id)) || String(z.guild_id),
            ziele: Number(z.ziele) || 0
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Die Heim-Guild setzen oder loeschen.
 *
 * @param {string} userId Der angemeldete Discord-Benutzer
 * @param {Object} streamer Zeile aus `streaming_streamers`
 * @param {string|null} guildId Ziel-Guild, oder null/leer zum Abschalten
 * @returns {Promise<{ok: boolean, grund?: string}>} Ergebnis
 */
async function setzen(userId, streamer, guildId) {
    if (!streamer) return { ok: false, grund: 'Diesen Kanal gibt es hier nicht.' };

    // **Der Nachweis, und zwar frisch.** Nicht aus der Sitzung, nicht aus dem
    // Formular: aus `user_connections`. `kanalInhaber` gibt es seit 12b und
    // fragt genau das - wer hat DIESES Konto verknuepft.
    const inhaber = await abonnenten.kanalInhaber(streamer);
    if (!inhaber) {
        return { ok: false, grund: 'Fuer diesen Kanal ist kein Twitch-Konto verknuepft.' };
    }
    if (String(inhaber) !== String(userId)) {
        // Das ist der Fall, den die ganze Datei verhindert. Er gehoert ins
        // Protokoll, nicht nur in die Antwort: Wenn ihn jemand versucht, will
        // man das spaeter sehen koennen.
        ServiceManager.get('Logger').warn(
            `[Streaming] Heim-Guild abgelehnt: ${userId} ist nicht Inhaber von `
            + `${streamer.plattform}:${streamer.kanal_id} (das ist ${inhaber})`);
        return { ok: false, grund: 'Nur der Inhaber dieses Kanals kann das setzen.' };
    }

    const ziel = String(guildId || '').trim();
    const vorher = streamer.heim_guild_id ? String(streamer.heim_guild_id) : null;

    if (!ziel) {
        await db().query('UPDATE streaming_streamers SET heim_guild_id = NULL WHERE id = ?', [streamer.id]);
        await navigationAuffrischen([vorher]);
        chatAbosAnstossen();
        return { ok: true };
    }

    // **Die Auswahl wird gegen die Liste geprueft, nicht gegen ein Muster.**
    // Eine Ziffernpruefung liesse jede beliebige Guild durch - auch eine, in
    // der dieser Kanal nichts zu suchen hat.
    const erlaubt = await moeglicheGuilds(streamer);
    if (!erlaubt.some(g => String(g.guild_id) === ziel)) {
        return { ok: false, grund: 'Diese Guild steht nicht zur Auswahl.' };
    }

    await db().query('UPDATE streaming_streamers SET heim_guild_id = ? WHERE id = ?', [ziel, streamer.id]);
    ServiceManager.get('Logger').info(
        `[Streaming] Heim-Guild fuer ${streamer.login} auf ${ziel} gesetzt (durch ${userId})`);

    // **Beide Guilds**, nicht nur die neue: In der alten muss der
    // Chatbot-Punkt verschwinden. Wer nur die neue auffrischt, laesst
    // dahinter einen Menuepunkt stehen, der ins Leere zeigt.
    await navigationAuffrischen([vorher, ziel]);
    chatAbosAnstossen();
    return { ok: true };
}

/**
 * Den Chat-Anschluss nachziehen, ohne auf ihn zu warten.
 *
 * **Warum ueberhaupt.** Die Wahl bestimmt, wo der Chatbot wohnt - und
 * `chatabos.gewuenscht()` liest genau diese Spalte. Ohne diesen Anstoss
 * geschaehe bis zum naechsten Tageslauf nichts: Der Streamer waehlt seinen
 * Server, sieht den neuen Menuepunkt und wartet bis zu 24 Stunden darauf, dass
 * der Bot tatsaechlich in seinem Chat auftaucht. Beim Abschalten waere es
 * schlimmer herum - der Bot bliebe einen Tag laenger sitzen, als jemand ihn
 * haben wollte.
 *
 * **Warum ohne `await`.** Der Abgleich redet mehrfach mit Twitch; das dauert
 * Sekunden und kann haengen. Die Wahl ist zu diesem Zeitpunkt gespeichert -
 * den Streamer davor warten zu lassen hiesse, eine erledigte Sache als offen
 * darzustellen. Scheitert der Anstoss, holt ihn der Tageslauf nach, und der
 * Grund steht im Protokoll.
 *
 * @returns {void} nichts - absichtlich nicht abwartbar
 */
function chatAbosAnstossen() {
    require('./chatabos').abgleichen()
        .then((bericht) => {
            if (bericht?.abgebrochen) {
                ServiceManager.get('Logger').info(
                    `[Streaming] Chat-Abgleich nach der Wahl nicht gelaufen: ${bericht.abgebrochen}`);
            }
        })
        .catch((error) => {
            // **Kein leeres `catch`.** Ein verschluckter Fehler hiesse: Der
            // Bot kommt nicht in den Chat, und niemand erfaehrt warum.
            ServiceManager.get('Logger').error('[Streaming] Chat-Abgleich nach der Wahl fehlgeschlagen', error);
        });
}

/**
 * Die Navigation der betroffenen Guilds neu aufbauen.
 *
 * **Warum das hier stehen muss.** `_registerNavigation` laeuft sonst nur beim
 * Start des Dashboards. Ohne diesen Aufruf saehe der Streamer nach seiner Wahl
 * genau nichts - und eine Wahl, die scheinbar nichts tut, ist die Attrappe,
 * gegen die dieses Plugin geschrieben ist.
 *
 * **Sie darf nicht durchfallen.** Die Wahl ist gespeichert; ein Fehler beim
 * Auffrischen macht sie nicht rueckgaengig, und ihn nach oben zu werfen hiesse
 * "abgelehnt" zu melden, obwohl gespeichert wurde. Der naechste Neustart holt
 * es ohnehin nach - deshalb Protokoll statt Ausnahme.
 *
 * @param {Array<string|null>} guildIds Betroffene Guilds, leere fallen weg
 * @returns {Promise<void>} nichts
 */
async function navigationAuffrischen(guildIds) {
    const log = ServiceManager.get('Logger');

    // **`ServiceManager.get` WIRFT, wenn der Dienst fehlt** - `?.` faengt das
    // nicht, es greift nur bei `null`. Ohne dieses try/catch haette ein
    // fehlender `pluginManager` die Ausnahme bis in `setzen` getragen, und die
    // Route haette "abgelehnt" gemeldet, obwohl gespeichert wurde. Gefunden am
    // 2026-08-29 vom eigenen Pruefskript, das den Dienst nicht stellt.
    //
    // Zur Aufrufzeit geholt, nicht oben eingebunden: `index.js` bindet ueber
    // `meinkanal` diese Datei ein - ein `require` am Kopf waere ein Kreis.
    let plugin = null;
    try {
        plugin = ServiceManager.get('pluginManager')?.getPlugin?.('streaming') || null;
    } catch {
        plugin = null;
    }
    if (!plugin || typeof plugin.navigationAuffrischen !== 'function') {
        log.warn('[Streaming] Navigation nicht auffrischbar - der Punkt erscheint erst nach einem Neustart');
        return;
    }
    for (const g of [...new Set(guildIds.filter(Boolean).map(String))]) {
        try {
            await plugin.navigationAuffrischen(g);
        } catch (error) {
            log.warn(`[Streaming] Navigation von ${g} nicht aufgefrischt: ${error.message}`);
        }
    }
}

/**
 * Welche Kanaele haben DIESE Guild als Heim?
 *
 * Das ist die Frage, die die Navigation stellt: Gibt es hier ueberhaupt einen
 * Chatbot zu verwalten?
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array<Object>>} Streamer-Zeilen
 */
async function kanaeleDerGuild(guildId) {
    return await db().query(
        `SELECT id, plattform, kanal_id, login, anzeigename,
                chat_ansage_an, chat_ansage_text
           FROM streaming_streamers
          WHERE heim_guild_id = ?
          ORDER BY anzeigename, login`, [guildId]) || [];
}

/**
 * Ist diese Guild das Heim von irgendetwas?
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<boolean>} ja oder nein
 */
async function istHeim(guildId) {
    const zeilen = await db().query(
        'SELECT 1 FROM streaming_streamers WHERE heim_guild_id = ? LIMIT 1', [guildId]);
    return zeilen.length > 0;
}

module.exports = { streamerZuKonto, moeglicheGuilds, setzen, kanaeleDerGuild, istHeim };
