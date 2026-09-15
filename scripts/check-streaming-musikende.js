#!/usr/bin/env node
/**
 * Prueft „Musik am Streamende beenden" (Baustelle 128).
 *
 * Zwei Teile:
 *   1. Die Entscheidungen (`kern/musikendeEntscheidung.js`) - jeder Grund einzeln.
 *   2. Der Ablauf (`kern/musikende.js`) gegen eine Attrappe: vormerken,
 *      abbrechen bei neuem Live, ausfuehren. **Unbekannte Abfragen sind ein
 *      Befund** - eine Attrappe, die sie mit `[]` beantwortet, wird lautlos
 *      blind, sobald sich eine Abfrage aendert.
 *
 * Keine Datenbank, kein Discord, keine Musik.
 *
 *   node scripts/check-streaming-musikende.js
 *
 * Exitcode 1, wenn ein Fall scheitert.
 */
'use strict';

const path = require('path');
const { ServiceManager } = require('dunebot-core');

let geprueft = 0, gescheitert = 0;

function pruefe(was, ist, soll) {
    geprueft++;
    const gut = JSON.stringify(ist) === JSON.stringify(soll);
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}: ${JSON.stringify(ist)}${gut ? '' : ` (soll: ${JSON.stringify(soll)})`}`);
}

const e = require('../plugins/streaming/dashboard/kern/musikendeEntscheidung');

console.log('\nEinstellung lesen');
pruefe('nie gespeichert heisst an, Vorgabe-Nachlauf', e.einstellungLesen(null, null), { an: true, nachlaufMin: e.NACHLAUF_VORGABE });
pruefe('"0" heisst aus', e.einstellungLesen('0', '10').an, false);
pruefe('"1" heisst an', e.einstellungLesen('1', '10'), { an: true, nachlaufMin: 10 });
pruefe('Nachlauf unter der Karenz faellt auf die Vorgabe', e.einstellungLesen('1', '1').nachlaufMin, e.NACHLAUF_VORGABE);
pruefe('Nachlauf kein Wert faellt auf die Vorgabe', e.einstellungLesen('1', 'bald').nachlaufMin, e.NACHLAUF_VORGABE);

console.log('\nBeim Streamende — wird vorgemerkt?');
const AN = { an: true, nachlaufMin: 5 };
const ende = (ueber = {}) => e.beimStreamende({ heimGuild: 'G', einstellung: AN, liveInHeim: 0, musikAktiv: true, ...ueber });
pruefe('letzter offline, Musik laeuft', ende(), { vormerken: true, grund: 'letzter_offline' });
pruefe('Kanal ohne Heim-Guild', ende({ heimGuild: null }).grund, 'ohne_heim');
pruefe('ausgeschaltet', ende({ einstellung: { an: false } }).grund, 'aus');
pruefe('ohne Einstellung nichts', ende({ einstellung: null }).vormerken, false);
pruefe('anderer Kanal dieser Heim-Guild noch live', ende({ liveInHeim: 1 }).grund, 'noch_live');
pruefe('keine Musik beim Streamende — nichts vorzumerken', ende({ musikAktiv: false }).grund, 'musik_aus');
pruefe('ohne Angaben stuerzt nichts', e.beimStreamende().vormerken, false);

console.log('\nBeim Faelligwerden');
const faellig = (ueber = {}) => e.beimFaelligwerden({ einstellung: AN, liveInHeim: 0, musikAktiv: true, ...ueber });
pruefe('niemand live, Musik laeuft — beenden', faellig(), { handlung: 'beenden', grund: 'niemand_live' });
pruefe('inzwischen ausgeschaltet', faellig({ einstellung: { an: false } }).grund, 'aus');
pruefe('wieder jemand live', faellig({ liveInHeim: 1 }).grund, 'wieder_live');
pruefe('Musik schon aus', faellig({ musikAktiv: false }).grund, 'musik_aus');
pruefe('ohne Angaben wird nichts beendet', e.beimFaelligwerden().handlung, 'abbrechen');

console.log('\nFormular');
pruefe('an mit 10 Minuten', e.eingabePruefen({ an: '1', nachlauf_min: '10' }), { ok: true, werte: { an: true, nachlaufMin: 10 } });
pruefe('fehlender Schalter heisst aus', e.eingabePruefen({ nachlauf_min: '10' }).werte.an, false);
pruefe('Nachlauf unter der Karenz abgelehnt', e.eingabePruefen({ an: '1', nachlauf_min: '2' }).fehler, 'nachlauf');
pruefe('Nachlauf zu lang abgelehnt', e.eingabePruefen({ an: '1', nachlauf_min: '241' }).fehler, 'nachlauf');
pruefe('Nachlauf mit Komma abgelehnt', e.eingabePruefen({ an: '1', nachlauf_min: '7.5' }).fehler, 'nachlauf');
pruefe('Nachlauf leer abgelehnt', e.eingabePruefen({ an: '1', nachlauf_min: '' }).fehler, 'nachlauf');

// ---------------------------------------------------------------------------
// Der Ablauf gegen eine Attrappe
// ---------------------------------------------------------------------------

const d = {
    streamer: { 1: { id: 1, login: 'firedervil', heim_guild_id: 'G' }, 2: { id: 2, login: 'nitrinax', heim_guild_id: null } },
    live: new Set(), aktiv: { G: 1 }, config: {}, outbox: [], unbekannt: [], beendet: []
};
const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {}, success() {} });
ServiceManager.register('dbService', {
    async getConfig(plugin, schluessel, bereich, guildId) { return d.config[`${guildId}|${schluessel}`] ?? null; },
    async setConfig(plugin, schluessel, wert, bereich, guildId) { d.config[`${guildId}|${schluessel}`] = wert; },
    async query(sql, w = []) {
        const s = norm(sql);
        if (s === 'SELECT id, login, heim_guild_id FROM streaming_streamers WHERE id = ?') {
            return d.streamer[w[0]] ? [d.streamer[w[0]]] : [];
        }
        if (s.startsWith('SELECT COUNT(*) AS anzahl FROM streaming_streamers s JOIN streaming_state z ON z.streamer_id = s.id WHERE s.heim_guild_id = ? AND z.ist_live = 1')) {
            return [{ anzahl: Object.values(d.streamer).filter(x => x.heim_guild_id === w[0] && d.live.has(x.id)).length }];
        }
        if (s === 'SELECT aktiv FROM streaming_music_state WHERE guild_id = ? LIMIT 1') {
            return d.aktiv[w[0]] === undefined ? [] : [{ aktiv: d.aktiv[w[0]] }];
        }
        if (s === "SELECT id FROM streaming_outbox WHERE aktion = 'musikende' AND zustand = 'offen' AND guild_id = ? LIMIT 1") {
            return d.outbox.filter(o => o.zustand === 'offen' && o.guild_id === w[0]).slice(0, 1);
        }
        if (s === "INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast, faellig_ab) VALUES (NULL, ?, 'musikende', ?, DATE_ADD(NOW(3), INTERVAL ? MINUTE))") {
            d.outbox.push({ id: d.outbox.length + 1, guild_id: w[0], nutzlast: JSON.parse(w[1]), minuten: w[2], zustand: 'offen' });
            return { affectedRows: 1 };
        }
        if (s === "UPDATE streaming_outbox SET zustand = 'fertig', erledigt_am = NOW(3), fehlertext = ? WHERE aktion = 'musikende' AND zustand = 'offen' AND guild_id = ?") {
            let n = 0;
            for (const o of d.outbox) if (o.zustand === 'offen' && o.guild_id === w[1]) { o.zustand = 'fertig'; o.fehlertext = w[0]; n++; }
            return { affectedRows: n };
        }
        d.unbekannt.push(s.slice(0, 100));
        return [];
    }
});

// Die Musik selbst ersetzen: geprueft wird, OB beendet wird, nicht wie.
const musikPfad = require.resolve('../plugins/streaming/shared/musikwunsch');
require.cache[musikPfad] = { id: musikPfad, filename: musikPfad, loaded: true,
    exports: { async beenden(g) { d.beendet.push(g); } } };

const ablauf = require('../plugins/streaming/dashboard/kern/musikende');

(async () => {
    console.log('\nAblauf');

    pruefe('Streamende firedervil merkt vor', await ablauf.vormerken(1), 1);
    pruefe('mit Vorgabe-Nachlauf und fuer seine Heim-Guild', [d.outbox[0]?.guild_id, d.outbox[0]?.minuten], ['G', e.NACHLAUF_VORGABE]);
    pruefe('zweiter Weg fuer dasselbe Ende legt nichts doppelt an', [await ablauf.vormerken(1), d.outbox.length], [0, 1]);
    pruefe('Kanal ohne Heim-Guild merkt nichts vor', await ablauf.vormerken(2), 0);

    d.live.add(1);
    pruefe('wieder live bricht ab', await ablauf.beiStreambeginn(1), 1);
    pruefe('mit Begruendung', d.outbox[0].fehlertext, 'Abgebrochen: firedervil ist wieder live');
    d.live.delete(1);

    d.config['G|MUSIK_NACHLAUF_MIN'] = '12';
    await ablauf.vormerken(1);
    pruefe('eingestellter Nachlauf gilt', d.outbox[1]?.minuten, 12);

    pruefe('faellig, niemand live — beendet', (await ablauf.ausfuehren({ guild_id: 'G' })).hinweis, 'Beendet: niemand ist mehr live');
    pruefe('und zwar in der richtigen Guild', d.beendet, ['G']);

    d.live.add(1);
    pruefe('faellig, aber live — nicht beendet', (await ablauf.ausfuehren({ guild_id: 'G' })).hinweis, 'Abgebrochen: es ist wieder jemand live');
    d.live.delete(1);

    d.aktiv.G = 0;
    pruefe('Musik lief beim Streamende nicht — nichts vorgemerkt', [await ablauf.vormerken(1), d.outbox.filter(o => o.zustand === 'offen').length], [0, 1]);
    d.aktiv.G = 1;

    d.config['G|MUSIK_STREAMENDE'] = '0';
    pruefe('ausgeschaltet — faellig wird nicht beendet', (await ablauf.ausfuehren({ guild_id: 'G' })).hinweis, 'Abgebrochen: Beenden nach dem Stream ist ausgeschaltet');
    pruefe('ausgeschaltet — nichts vorgemerkt', await ablauf.vormerken(1), 0);

    await ablauf.speichern('G', { an: true, nachlaufMin: 7 });
    pruefe('speichern schreibt beide Schluessel', [d.config['G|MUSIK_STREAMENDE'], d.config['G|MUSIK_NACHLAUF_MIN']], ['1', '7']);
    pruefe('und liest sich zurueck', await ablauf.einstellung('G'), { an: true, nachlaufMin: 7 });

    pruefe('keine unbekannte Abfrage', d.unbekannt, []);

    console.log(gescheitert === 0
        ? `\nErgebnis: ${geprueft} Faelle, 0 Abweichungen.\n`
        : `\nErgebnis: ${geprueft} Faelle, ${gescheitert} Abweichung(en).\n`);
    process.exit(gescheitert === 0 ? 0 : 1);
})().catch((err) => { console.error('\nFEHLER:', err); process.exit(1); });
