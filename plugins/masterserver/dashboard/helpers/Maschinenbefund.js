'use strict';

const dns = require('dns').promises;

/**
 * Absicht, Messung, Fähigkeit — die drei getrennt zu halten ist der ganze Zweck
 * dieser Datei.
 *
 * Bis zum 2026-08-20 lagen sie in denselben Spalten. Ein Häkchen „FastDL" hiess
 * gleichzeitig „gewünscht" und „vorhanden", ein `hostname` gleichzeitig „so soll
 * die Maschine heissen" und „so lautet die Adresse". Das Ergebnis war ein
 * Formular, dessen Felder etwas versprachen, was niemand eingelöst hat.
 *
 * Hier wird aus **Absicht** (was der Betreiber ankreuzt) und **Messung** (was
 * der Daemon auf seiner Maschine vorfindet) die **Fähigkeit** abgeleitet — und
 * zwar immer mit Grund. Ein blosses „nein" schickt den Betreiber ins Dunkle.
 */

/** Adressen, bei denen die Gegenstelle nichts über die Maschine verrät. */
function istRueckschleife(ip) {
    if (!ip) return true;
    const nackt = String(ip).replace(/^::ffff:/, '');
    return nackt === '127.0.0.1' || nackt === '::1' || nackt === '0.0.0.0';
}

/** `::ffff:1.2.3.4` und `1.2.3.4` sind dieselbe Maschine. */
function nackteIp(ip) {
    return ip ? String(ip).replace(/^::ffff:/, '') : null;
}

/**
 * Prüft, ob ein Name auf DIESE Maschine zeigt.
 *
 * ── Warum nicht „löst der Name auf" ─────────────────────────────────────────
 *
 * Am 2026-08-19 zeigte `node1.firenetworks.de` brav eine Adresse — nur eben die
 * des Webhosts, wegen eines Platzhalter-Eintrags `*.firenetworks.de`. Eine
 * Existenzprüfung hätte „ja" gesagt und eine Adresse durchgewinkt, an der kein
 * Spieler ankommt. Gefragt ist deshalb: **zeigt er hierher.**
 *
 * @param {string|null} fqdn            der gewünschte Name (Absicht)
 * @param {string|null} gesehenIp       die IP, von der der Daemon verbindet
 * @param {string|null} eingetrageneIp  `rootserver.host` — nur als Notnagel
 */
async function pruefeNamen(fqdn, gesehenIp, eingetrageneIp) {
    if (!fqdn) {
        return { gilt: 0, zeigtAuf: null, grund: 'Kein Name hinterlegt — es gilt die IP-Adresse.' };
    }

    // Welche Adresse ist die Wahrheit über diese Maschine?
    //
    // Die gesehene IP ist die einzige, die niemand tippt. Hinter dem
    // Apache-Proxy ist sie aber die Rückschleife, wenn kein X-Forwarded-For
    // gesetzt war — dann bleibt nur die eingetragene, und das gehört gesagt.
    let vergleichIp = nackteIp(gesehenIp);
    let einschraenkung = '';
    if (istRueckschleife(vergleichIp)) {
        vergleichIp = nackteIp(eingetrageneIp);
        einschraenkung = ' (verglichen mit der eingetragenen IP — die Verbindung kam über den lokalen Proxy)';
    }
    if (!vergleichIp) {
        return {
            gilt: 0, zeigtAuf: null,
            grund: 'Die Maschine hat noch keine erkennbare Adresse gemeldet — Name ungeprüft.',
        };
    }

    let adressen;
    try {
        adressen = await dns.resolve4(fqdn);
    } catch (err) {
        const code = err && err.code ? err.code : 'unbekannt';
        return {
            gilt: 0, zeigtAuf: null,
            grund: `Der Name "${fqdn}" löst nicht auf (${code}). Ein DNS-Eintrag fehlt.`,
        };
    }

    if (adressen.includes(vergleichIp)) {
        return {
            gilt: 1,
            zeigtAuf: adressen.join(', '),
            grund: `Der Name zeigt auf ${vergleichIp}${einschraenkung}.`,
        };
    }

    return {
        gilt: 0,
        zeigtAuf: adressen.join(', '),
        grund: `Der Name zeigt auf ${adressen.join(', ')}, die Maschine ist aber ${vergleichIp}` +
               `${einschraenkung}. Häufigste Ursache: ein Platzhalter-Eintrag (*.domain), ` +
               'der jeden Namen auf den Webserver lenkt.',
    };
}

/**
 * FastDL: Wunsch trifft Messung.
 *
 * Eine Domain ist NICHT nötig — geprüft am 2026-08-20: FastDL ist ein
 * HTTP-Ort, den der Client über `sv_downloadurl` bekommt, und eine IP ist dort
 * genauso gültig wie ein Name. Was nötig ist, ist ein laufender Webserver.
 */
function leiteFastdlAb(gewuenscht, webserver) {
    if (!gewuenscht) {
        return { moeglich: 0, grund: 'Nicht angefordert.' };
    }
    if (!webserver) {
        return { moeglich: 0, grund: 'Die Maschine hat noch nichts gemeldet.' };
    }
    if (webserver.art === 'fremd') {
        return {
            moeglich: 0,
            grund: 'Port 80 ist von einem fremden Dienst belegt. Solange der dort hört, ' +
                   'kann kein FastDL eingerichtet werden.',
        };
    }
    if (webserver.laeuft && (webserver.art === 'nginx' || webserver.art === 'apache')) {
        return { moeglich: 1, grund: `${webserver.art} läuft — FastDL kann eingerichtet werden.` };
    }
    if (webserver.installiert) {
        return {
            moeglich: 0,
            grund: `${webserver.art} ist installiert, läuft aber nicht. Dienst starten, dann erneut verbinden.`,
        };
    }
    return { moeglich: 0, grund: 'Kein Webserver auf dieser Maschine. FastDL braucht nginx oder apache.' };
}

/**
 * Datenbanken: gleiche Bauart wie FastDL.
 *
 * Ein vorhandenes, aber uns unbekanntes MySQL ist ausdrücklich KEIN Hindernis —
 * es wird nur nicht angefasst. Ein eigenes Konto entsteht daneben, wenn es
 * gebraucht wird (M-5).
 */
function leiteDatenbankAb(gewuenscht, datenbank) {
    if (!gewuenscht) {
        return { moeglich: 0, grund: 'Nicht angefordert.' };
    }
    if (!datenbank) {
        return { moeglich: 0, grund: 'Die Maschine hat noch nichts gemeldet.' };
    }
    if (datenbank.laeuft) {
        return {
            moeglich: 1,
            grund: datenbank.bekannt
                ? 'MySQL läuft, Zugangsdaten sind hinterlegt.'
                : 'MySQL läuft. Ein eigenes Konto wird angelegt, das vorhandene bleibt unberührt.',
        };
    }
    if (datenbank.vorhanden) {
        return { moeglich: 0, grund: 'MySQL ist installiert, läuft aber nicht.' };
    }
    return { moeglich: 0, grund: 'Kein MySQL/MariaDB auf dieser Maschine.' };
}

/**
 * Warnt, wenn die Hardwarewerte nicht belastbar sind.
 *
 * Auf einer containervirtualisierten Maschine zeigen `/proc/cpuinfo` und
 * `/proc/meminfo` den WIRT: Eine 4-GB-Maschine meldet 128 GB. Da die gemessenen
 * Werte seit M-6 die Quoten bestimmen, ist das kein Schönheitsfehler — es wäre
 * eine Buchungsgrundlage, die um das Dreissigfache danebenliegt.
 */
function hardwareIstBelastbar(virtualisierung) {
    const container = ['lxc', 'lxc-libvirt', 'openvz', 'docker', 'podman', 'systemd-nspawn'];
    return !container.includes(String(virtualisierung || '').toLowerCase());
}

module.exports = {
    pruefeNamen,
    leiteFastdlAb,
    leiteDatenbankAb,
    hardwareIstBelastbar,
    istRueckschleife,
    nackteIp,
};
