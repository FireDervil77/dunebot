#!/usr/bin/env node
/**
 * Prueft die Verbindung zu Twitch — ohne etwas anzulegen oder zu aendern.
 *
 * Drei Fragen, die man sonst erst beim ersten Eintragen eines Kanals
 * beantwortet bekommt, und dann mit einer Fehlermeldung mitten in der
 * Oberflaeche:
 *
 *   1. Werden Client-ID und Secret akzeptiert?
 *   2. Duerfen wir lesen? (Kanal aufloesen)
 *   3. Wie steht es um das Abo-Kontingent?
 *
 * Es werden nur lesende Aufrufe gemacht. Das Secret wird nie ausgegeben.
 *
 *   node scripts/check-streaming-twitch.js [kanalname]
 *
 * Exitcode 1, wenn etwas nicht geht.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env') });

// Der Adapter holt seine Zugangsdaten ueber den ServiceManager (Datenbank
// zuerst, dann Umgebung). Hier gibt es keine Datenbank — deshalb ein
// schlanker Ersatz, der nur die Umgebung kennt.
// `ServiceManager.get()` wirft bei unbekanntem Namen, statt null zu liefern —
// also nicht erst fragen, sondern setzen.
const { ServiceManager } = require('dunebot-core');
ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, warn: () => {},
    error: (...a) => console.log('  !', ...a), success: () => {}
});
ServiceManager.register('dbService', { async getConfig() { return null; } });

const twitch = require('../plugins/streaming/dashboard/plattformen/twitch');

let fehler = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 */
function pruefe(gut, text, zusatz = '') {
    if (!gut) fehler++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? ' — ' + zusatz : ''}`);
}

(async () => {
    const kanalName = process.argv[2] || 'twitch';

    console.log('\nZugangsdaten');
    const id = process.env.TWITCH_CLIENT_ID || '';
    const secret = process.env.TWITCH_CLIENT_SECRET || '';
    pruefe(Boolean(id), 'TWITCH_CLIENT_ID gesetzt', id ? `${id.length} Zeichen` : 'fehlt');
    pruefe(Boolean(secret), 'TWITCH_CLIENT_SECRET gesetzt', secret ? `${secret.length} Zeichen` : 'fehlt');
    if (!id || !secret) {
        console.log('\nOhne beide Werte geht nichts weiter.\n');
        process.exit(1);
    }

    console.log('\nApp-Token');
    try {
        const token = await twitch.appToken();
        pruefe(Boolean(token), 'Token erhalten', `${String(token).length} Zeichen`);
    } catch (err) {
        pruefe(false, 'Token erhalten', err.message);
        console.log('\n  Haeufigste Ursache: Secret falsch kopiert, oder es wurde in der');
        console.log('  Twitch-Konsole ein neues erzeugt (das macht das alte ungueltig).\n');
        process.exit(1);
    }

    console.log('\nLesen');
    try {
        const kanal = await twitch.aufloesen(kanalName);
        pruefe(Boolean(kanal), `Kanal "${kanalName}" aufgeloest`,
            kanal ? `ID ${kanal.kanal_id}, ${kanal.anzeigename}` : 'nicht gefunden');
    } catch (err) {
        pruefe(false, `Kanal "${kanalName}" aufgeloest`, err.message);
    }

    console.log('\nAbonnements und Kontingent');
    try {
        const { abos, kosten, grenze } = await twitch.abosAuflisten();
        pruefe(true, 'Abo-Liste abgerufen', `${abos.length} Abo(s)`);
        console.log(`      Kosten: ${kosten} von ${grenze || '?'} (gemessen bei Twitch, nicht gerechnet)`);

        const nachZustand = abos.reduce((m, a) => { m[a.status] = (m[a.status] || 0) + 1; return m; }, {});
        if (abos.length) console.log('      Zustaende:', JSON.stringify(nachZustand));
    } catch (err) {
        pruefe(false, 'Abo-Liste abgerufen', err.message);
    }

    console.log(fehler === 0
        ? '\nErgebnis: Verbindung steht.\n'
        : `\nErgebnis: ${fehler} Problem(e).\n`);
    process.exit(fehler === 0 ? 0 : 1);
})();
