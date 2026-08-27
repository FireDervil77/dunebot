#!/usr/bin/env node
/**
 * Prueft `abosSichern` — die Stelle, an der Ereignisse bestellt werden.
 *
 * **Warum es dieses Skript gibt.** Am 2026-08-27 lag in `twitch.js` ein halber
 * Umbau: `EREIGNISSE` und `EREIGNISSE_ABO` waren von Zeichenketten auf
 * Beschreibungen (`{typ, version, bedingung, scope, melder}`) umgestellt, die
 * Aufrufer nicht. Vier Waechter liefen daraufhin gruen — `abgleich`,
 * `abonnenten`, `stand`, `schichten` —, obwohl `abosSichern` beim ersten
 * Aufruf geworfen haette. Keiner von ihnen ruft die Funktion auf.
 *
 * Der teure Teil war nicht der Absturz, sondern der Weg dorthin:
 *
 *   - `schonDa.get(objekt)` liefert **immer** `undefined`. Ein vorhandenes,
 *     bestaetigtes Abo gilt damit als fehlend, und die Funktion bestellt
 *     nach — in die Grenze von drei gleichen Abos hinein.
 *   - Was danach in die Spalte `ereignis` gehen soll, ist ein Objekt.
 *     mysql2 macht daraus eine Zuweisungsliste: `Unknown column 'typ'`.
 *   - `abgleich.neuAnlegen` setzt die Zeile **vorher** auf `verloren` und
 *     loescht die Abo-Kennung. Der Wurf danach laesst sie so stehen.
 *
 * Nebenwirkungsfrei: Attrappen fuer Datenbank und Adapter, kein Twitch.
 *
 *   node scripts/check-streaming-abosichern.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const { ServiceManager } = require('dunebot-core');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

// Twitch verlangt HTTPS; `rueckrufAdresse()` wirft sonst, bevor irgendetwas
// geprueft ist.
process.env.DASHBOARD_BASE_URL = 'https://pruefung.example';

// --- Attrappen -----------------------------------------------------------
const daten = { abos: [], ziele: [], abonnenten: [], inhaber: null, scopes: '' };
const mitschrift = { insert: [], update: [], abonniert: [], abbestellt: [], geloescht: [] };
const unbekannteAbfragen = [];

ServiceManager.register('Logger', { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {} });
ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        if (s.startsWith('SELECT ereignis, zustand FROM streaming_subscriptions')) {
            return daten.abos.filter(a => a.streamer_id === w[0])
                .map(a => ({ ereignis: a.ereignis, zustand: a.zustand }));
        }
        if (s.startsWith('SELECT 1 FROM streaming_targets')) {
            return daten.ziele.filter(z => z.streamer_id === w[0] && z.aktiv && z.abo_rolle_id);
        }
        // Die Melder (12c) haengen am selben Weg: `abosSichern` fragt, welche
        // Arten eine Guild will. Hier will keine eine — geprueft werden die
        // Abo-Ereignisse, nicht die Melder. Die haben ihren eigenen Waechter.
        if (s.startsWith('SELECT melder_arten FROM streaming_targets')) {
            return daten.ziele.filter(z => z.streamer_id === w[0] && z.aktiv);
        }
        // `kanalInhaber` und die Zusage des Kanalinhabers. Beides steuerbar,
        // weil der Melder-Schutz beim Aufraeumen genau daran haengt.
        if (s.startsWith('SELECT user_id FROM user_connections')) {
            return daten.inhaber ? [{ user_id: daten.inhaber }] : [];
        }
        if (s.startsWith('SELECT g.*, v.id AS verbindung')) {
            return daten.inhaber ? [{ scopes: daten.scopes, konto_name: 'Inhaber' }] : [];
        }
        if (s.startsWith('INSERT INTO streaming_subscriptions')) {
            mitschrift.insert.push({ streamer_id: w[0], ereignis: w[1] });
            daten.abos.push({ id: daten.abos.length + 1, streamer_id: w[0], ereignis: w[1], zustand: 'angefragt' });
            return [];
        }
        if (s.startsWith('UPDATE streaming_subscriptions SET anbieter_abo_id')) {
            mitschrift.update.push({ ereignis: w[3] });
            return [];
        }
        if (s.startsWith('SELECT s.plattform, s.kanal_id, a.id, a.ereignis, a.anbieter_abo_id')) {
            return daten.abos.filter(a => a.streamer_id === w[0])
                .map(a => ({ plattform: 'twitch', kanal_id: '12345', id: a.id, ereignis: a.ereignis, anbieter_abo_id: a.anbieter_abo_id || 'twitch-' + a.id }));
        }
        if (s.startsWith('DELETE FROM streaming_subscriptions')) {
            mitschrift.geloescht.push(w[0]);
            daten.abos = daten.abos.filter(a => a.id !== w[0]);
            return [];
        }

        // Beim Abbestellen der Abo-Ereignisse geht die Abonnentenliste mit —
        // sie ohne Zusage weiterzufuehren waere ein Vorrat, den niemand mehr
        // pflegt. Hier nur zur Kenntnis genommen.
        if (s.startsWith('DELETE FROM streaming_subscribers')) {
            mitschrift.geloescht.push('subscribers');
            return [];
        }

        // **Eine unbekannte Abfrage ist ein Befund, keine leere Liste.**
        // Genau daran ist dieser Waechter am 2026-08-27 blind geworden: Der
        // Code bekam eine Spalte mehr in seinem SELECT, die Attrappe erkannte
        // ihn nicht wieder und lieferte `[]` — "nichts abzubestellen" sah aus
        // wie ein bestandener Fall. Wer eine Abfrage aendert, soll es hier
        // merken, nicht in drei Wochen im Betrieb.
        if (/^(SELECT|INSERT|UPDATE|DELETE)/i.test(s)) {
            unbekannteAbfragen.push(s.slice(0, 90));
        }
        return [];
    },
    async getConfig() { return null; }
});

const twitch = require('../plugins/streaming/dashboard/plattformen/twitch');

// Der Adapter wird an genau zwei Stellen ersetzt. Alles andere — die
// Ereignislisten selbst — bleibt echt; sie sind ja der Gegenstand.
twitch.abonnieren = async (kanalId, ereignisse) => {
    mitschrift.abonniert.push(...ereignisse.map(b => ({ kanalId, b })));
    return ereignisse.map(b => ({
        ereignis: b && b.typ, ok: true, status: 202,
        anbieter_abo_id: 'twitch-neu', zustand: 'webhook_callback_verification_pending', kosten: 0, fehler: null
    }));
};
twitch.abbestellen = async (id) => { mitschrift.abbestellt.push(id); return true; };

const abos = require('../plugins/streaming/dashboard/kern/abos');

/**
 * Setzt Daten und Mitschrift zurueck.
 *
 * @param {Array} [bestand] Abo-Zeilen
 * @param {boolean} [rolleGewuenscht] ob eine Guild eine Abo-Rolle vergibt
 * @returns {void}
 */
function neuAufsetzen(bestand = [], rolleGewuenscht = false, melderArten = null, scopes = '') {
    daten.abos = bestand.map((b, i) => ({ id: i + 1, streamer_id: 1, ...b }));
    daten.ziele = (rolleGewuenscht || melderArten)
        ? [{ streamer_id: 1, aktiv: 1, abo_rolle_id: rolleGewuenscht ? '999' : null, melder_arten: melderArten }]
        : [];
    daten.inhaber = scopes ? '4711' : null;
    daten.scopes = scopes;
    mitschrift.insert = []; mitschrift.update = []; mitschrift.abonniert = [];
    mitschrift.abbestellt = []; mitschrift.geloescht = [];
}

const NAMEN = twitch.typenVon(twitch.EREIGNISSE);
const ABO_NAMEN = twitch.typenVon(twitch.EREIGNISSE_ABO);

(async () => {

console.log('\nWas in die Tabelle geht, ist ein Name');
{
    neuAufsetzen();
    const ergebnis = await abos.abosSichern(1, 'twitch', '12345');

    pruefe(mitschrift.insert.length === NAMEN.length,
        `je Pflichtereignis ein Eintrag`, `${mitschrift.insert.length} von ${NAMEN.length}`);

    const nichtText = mitschrift.insert.filter(i => typeof i.ereignis !== 'string');
    pruefe(nichtText.length === 0,
        'jeder Wert fuer die Spalte `ereignis` ist eine Zeichenkette',
        nichtText.length ? JSON.stringify(nichtText[0].ereignis) : 'alle');

    pruefe(mitschrift.insert.every(i => NAMEN.includes(i.ereignis)),
        'und steht in der Ereignisliste des Adapters');

    pruefe(ergebnis.every(e => typeof e.ereignis === 'string'),
        'auch das Ergebnis nennt Namen, keine Objekte');
}

console.log('\nWas an den Adapter geht, ist eine Beschreibung');
{
    pruefe(mitschrift.abonniert.length === NAMEN.length,
        'der Adapter wurde je Ereignis einmal gerufen', `${mitschrift.abonniert.length}`);

    const b = mitschrift.abonniert[0] && mitschrift.abonniert[0].b;
    pruefe(Boolean(b) && typeof b === 'object', 'er bekommt ein Objekt, keine Zeichenkette');
    pruefe(Boolean(b) && typeof b.typ === 'string' && b.typ.length > 0, '`typ` ist gesetzt');
    pruefe(Boolean(b) && typeof b.version === 'string' && b.version.length > 0, '`version` ist gesetzt');
    pruefe(Boolean(b) && typeof b.bedingung === 'function', '`bedingung` ist eine Funktion');

    // Ohne diesen Fall koennte `bedingung` eine Funktion sein, die nichts
    // Brauchbares liefert — Twitch lehnte dann jedes Abo ab.
    const bed = b && typeof b.bedingung === 'function' ? b.bedingung('12345') : null;
    pruefe(Boolean(bed) && typeof bed === 'object' && Object.keys(bed).length > 0,
        'und liefert eine gefuellte Bedingung', JSON.stringify(bed));
}

console.log('\nEin vorhandenes Abo wird nicht noch einmal bestellt');
{
    // **Der Fall, der den halben Umbau haette auffliegen lassen.** Mit einem
    // Objekt als Schluessel findet `schonDa.get` nie etwas, und hier stuenden
    // drei neue Bestellungen.
    neuAufsetzen(NAMEN.map(e => ({ ereignis: e, zustand: 'bestaetigt' })));
    const ergebnis = await abos.abosSichern(1, 'twitch', '12345');

    pruefe(mitschrift.abonniert.length === 0,
        'bei drei bestaetigten Abos wird nichts nachbestellt', `${mitschrift.abonniert.length} Bestellung(en)`);
    pruefe(mitschrift.insert.length === 0, 'und nichts in die Tabelle geschrieben');
    pruefe(ergebnis.length === NAMEN.length && ergebnis.every(e => e.uebersprungen === true),
        'alle drei sind als uebersprungen gemeldet');
}

console.log('\n`angefragt` gilt als vorhanden, `fehler` nicht');
{
    neuAufsetzen([{ ereignis: NAMEN[0], zustand: 'angefragt' }]);
    await abos.abosSichern(1, 'twitch', '12345');
    pruefe(!mitschrift.abonniert.some(a => a.b.typ === NAMEN[0]),
        '`angefragt` wird uebersprungen — die Bestaetigung ist unterwegs');

    neuAufsetzen([{ ereignis: NAMEN[0], zustand: 'fehler' }]);
    await abos.abosSichern(1, 'twitch', '12345');
    pruefe(mitschrift.abonniert.some(a => a.b.typ === NAMEN[0]),
        '`fehler` wird neu bestellt — sonst bliebe es fuer immer kaputt');
}

console.log('\nDie Abo-Ereignisse kommen nur auf Wunsch');
{
    neuAufsetzen([], false);
    await abos.abosSichern(1, 'twitch', '12345');
    const ohne = mitschrift.abonniert.map(a => a.b.typ);
    pruefe(ohne.length === NAMEN.length && !ABO_NAMEN.some(n => ohne.includes(n)),
        'ohne Abo-Rolle nur die Pflichtereignisse', ohne.join(' '));

    neuAufsetzen([], true);
    await abos.abosSichern(1, 'twitch', '12345');
    const mit = mitschrift.abonniert.map(a => a.b.typ);
    pruefe(ABO_NAMEN.every(n => mit.includes(n)),
        'mit Abo-Rolle kommen sie dazu', `${mit.length} Ereignisse`);
    pruefe(mitschrift.insert.every(i => typeof i.ereignis === 'string'),
        'auch sie gehen als Name in die Tabelle');
}

console.log('\nAufraeumen erkennt seine Ereignisse am Namen');
{
    // Die Zeile aus der Datenbank traegt einen Namen, die Liste Objekte. Wer
    // `includes` benutzt, raeumt nie etwas ab — lautlos.
    neuAufsetzen([...NAMEN, ...ABO_NAMEN].map(e => ({ ereignis: e, zustand: 'bestaetigt' })), false);
    const ergebnis = await abos.aboEreignisseAufraeumen(1);

    pruefe(ergebnis.abbestellt === ABO_NAMEN.length,
        'genau die Abo-Ereignisse werden abbestellt', `${ergebnis.abbestellt} von ${ABO_NAMEN.length}`);
    pruefe(daten.abos.length === NAMEN.length && NAMEN.every(n => daten.abos.some(a => a.ereignis === n)),
        'die Pflichtereignisse bleiben stehen', daten.abos.map(a => a.ereignis).join(' '));

    neuAufsetzen([...NAMEN, ...ABO_NAMEN].map(e => ({ ereignis: e, zustand: 'bestaetigt' })), true);
    const behalten = await abos.aboEreignisseAufraeumen(1);
    pruefe(behalten.behalten === true && behalten.abbestellt === 0,
        'solange eine Guild die Rolle vergibt, bleibt alles stehen');
}

console.log('\nEin Melder haelt sein Ereignis fest');
{
    // **Der Fall, der beim Abschalten der Abonnenten-Rolle wehtut.**
    // `channel.subscribe` traegt zweierlei: die Rolle und die Meldung. Wer es
    // mit der Rolle abraeumt, nimmt der Meldung lautlos ihr Abo weg — und
    // niemand merkt es, weil das Haekchen "Neue Abonnements" stehen bleibt.
    neuAufsetzen([...NAMEN, ...ABO_NAMEN].map(e => ({ ereignis: e, zustand: 'bestaetigt' })),
        false, 'abonniert', 'channel:read:subscriptions');
    const ergebnis = await abos.aboEreignisseAufraeumen(1);

    pruefe(daten.abos.some(a => a.ereignis === 'channel.subscribe'),
        'channel.subscribe bleibt stehen, weil die Meldung es braucht',
        daten.abos.map(a => a.ereignis).join(' '));
    pruefe(!daten.abos.some(a => a.ereignis === 'channel.subscription.end'),
        'channel.subscription.end geht weg — kein Melder braucht es');
    pruefe(ergebnis.abbestellt === 2, 'genau zwei der drei werden abbestellt', String(ergebnis.abbestellt));

    // Die Gegenprobe im Fall selbst: ohne Melder faellt alles drei weg.
    neuAufsetzen([...NAMEN, ...ABO_NAMEN].map(e => ({ ereignis: e, zustand: 'bestaetigt' })), false);
    await abos.aboEreignisseAufraeumen(1);
    pruefe(!daten.abos.some(a => a.ereignis === 'channel.subscribe'),
        'ohne Melder faellt channel.subscribe wie die anderen weg');
}

console.log('\nDie Bauform jeder Beschreibung');
{
    // Fuer Kick und YouTube spaeter: Die Form ist der Vertrag zwischen Kern
    // und Adapter. Eine fehlende `version` faellt sonst erst bei Twitch auf.
    const alle = [
        ...twitch.EREIGNISSE.map(b => ['EREIGNISSE', b]),
        ...twitch.EREIGNISSE_ABO.map(b => ['EREIGNISSE_ABO', b]),
        ...twitch.EREIGNISSE_MELDER.map(b => ['EREIGNISSE_MELDER', b])
    ];

    const schlecht = alle.filter(([, b]) =>
        typeof b.typ !== 'string' || !b.typ ||
        typeof b.version !== 'string' || !b.version ||
        typeof b.bedingung !== 'function' ||
        !(b.scope === null || typeof b.scope === 'string') ||
        !(b.melder === null || typeof b.melder === 'string'));
    pruefe(schlecht.length === 0, `alle ${alle.length} Beschreibungen sind vollstaendig`,
        schlecht.length ? schlecht.map(([l, b]) => `${l}/${b.typ || '?'}`).join(' ') : '');

    const leereBedingung = alle.filter(([, b]) => {
        try { const c = b.bedingung('42'); return !c || Object.keys(c).length === 0; }
        catch { return true; }
    });
    pruefe(leereBedingung.length === 0, 'jede Bedingung liefert ein gefuelltes Objekt',
        leereBedingung.map(([, b]) => b.typ).join(' '));

    const namen = alle.map(([, b]) => b.typ);
    pruefe(new Set(namen).size === namen.length,
        'kein Ereignis steht in zwei Listen', `${namen.length} Namen`);

    // `melder: null` heisst "aendert Zustand oder Rolle"; ein Melder ohne
    // Namen waere ein Ereignis, das ankommt und nichts ausloest.
    const stummeMelder = twitch.EREIGNISSE_MELDER.filter(b => !b.melder);
    pruefe(stummeMelder.length === 0, 'jeder Melder hat einen Meldernamen',
        stummeMelder.map(b => b.typ).join(' '));
}

console.log('\nHat die Attrappe alles verstanden?');
{
    pruefe(unbekannteAbfragen.length === 0,
        'keine Abfrage lief an der Attrappe vorbei',
        unbekannteAbfragen.length ? unbekannteAbfragen[0] : 'alle erkannt');
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);

process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
