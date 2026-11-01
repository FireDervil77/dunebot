'use strict';

/**
 * Dateien, die das Paket dem Betreiber zum Bearbeiten nennt (Baustelle 215,
 * 2026-11-01).
 *
 * Eine Einstellung kennt einen Wert, eine feste Zeile legt einen Wert fest. Eine
 * Mapcycle, eine Voting-Cfg oder eine Admin-Liste ist aber ein ganzer Text, den
 * der Betreiber pflegt. Der Dateimanager konnte sie schon öffnen, nur musste man
 * sie dort kennen und zusammensuchen. Hier nennt das Paket sie
 * (`files.config_files`), und der Bereich „Konfiguration" zeigt sie geordnet.
 *
 * Das Panel versteht den Inhalt nicht und muss es auch nicht: Gelesen und
 * geschrieben wird über die Routen des Dateimanagers, samt Rechten und Sperrliste.
 *
 * Pfade zählen ab der Wurzel des Volumes wie `needed_by`, weil nicht alles unter
 * game/ liegt: ET Legacy legt `etconfig_server.cfg` unter data/.etlegacy/legacy/ ab.
 */

const { zerlegeMuster } = require('./Zusatzports');
const { gesperrt } = require('./Sperrliste');

const GRUPPEN = {
    server:  'Server',
    votes:   'Abstimmungen',
    maps:    'Karten',
    players: 'Spieler',
    mods:    'Mods',
    other:   'Sonstiges',
};

/** Pfad wie im Schema: unter game/ oder data/, ein `*` nur im letzten Teil. */
const RE_PFAD = /^(?!.*\.\.)(game|data)(\/[^/*\\]+)*\/[^/\\]+$/;

const text = (t) => (t && typeof t === 'object' ? (t.de || t.en || '') : '');

function eintraege(paket) {
    const liste = paket?.files?.config_files;
    return Array.isArray(liste) ? liste : [];
}

/**
 * Was das Panel in dieser Datei selbst setzt — Einstellungen und feste Zeilen.
 * `apply.file` und `config[].file` zählen ab game/. Der Betreiber soll das sehen,
 * sonst ändert er einen Wert, den der nächste Start zurückschreibt.
 */
function panelSchluessel(paket, pfad) {
    if (!String(pfad).startsWith('game/')) return [];
    const datei = String(pfad).slice('game/'.length);
    const aus = new Set();
    for (const e of paket?.settings || []) {
        for (const a of e.apply || []) {
            if (a.target === 'file' && a.file === datei) aus.add(a.path || e.key);
        }
    }
    for (const c of Array.isArray(paket?.config) ? paket.config : []) {
        if (c.file === datei) Object.keys(c.set || {}).forEach(k => aus.add(k));
    }
    return [...aus].sort();
}

/**
 * Der Stand je Gruppe. Ein Muster wird zu den Dateien, die es trifft; eine
 * genannte Datei, die fehlt, bleibt als „fehlt" stehen, damit man sieht, was
 * das Paket erwartet. Ein Ordner, den der Daemon nicht lesen konnte, ist etwas
 * anderes als ein leerer: Dort steht `fehler`.
 *
 * @param {{server: object, paket: object, ipmServer: object, sperrliste: string[]}} auftrag
 */
async function stand({ server, paket, ipmServer, sperrliste = [] }) {
    const listen = new Map();
    const liste = async (ordner) => {
        if (listen.has(ordner)) return listen.get(ordner);
        const antwort = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.list', {
            server_id: String(server.id),
            rootserver_id: String(server.rootserver_id),
            install_path: server.install_path,
            path: '/' + ordner,
        }, 15000).catch(fehler => ({ success: false, error: fehler.message }));

        let ergebnis;
        if (antwort?.success) ergebnis = { dateien: (antwort.data?.files || []).filter(f => !f.is_dir) };
        else if (/verzeichnis nicht gefunden/i.test(String(antwort?.error || ''))) ergebnis = { dateien: [] };
        else ergebnis = { fehler: antwort?.error || 'keine Antwort vom Daemon' };
        listen.set(ordner, ergebnis);
        return ergebnis;
    };

    const gruppen = new Map(Object.keys(GRUPPEN).map(k => [k, []]));
    for (const e of eintraege(paket)) {
        const { ordner, muster } = zerlegeMuster(e.path);
        const istMuster = String(e.path).includes('*');
        const { dateien, fehler } = await liste(ordner);
        const zeile = (name, datei) => {
            const pfad = `${ordner}/${name}`;
            return {
                pfad: '/' + pfad, datei: name,
                name: (istMuster ? '' : text(e.name)) || name,
                beschreibung: text(e.description),
                vorhanden: Boolean(datei),
                gesperrt: gesperrt('/' + pfad, sperrliste),
                panelSchluessel: panelSchluessel(paket, pfad),
            };
        };

        const ziel = gruppen.get(GRUPPEN[e.group] ? e.group : 'other');
        if (fehler) {
            ziel.push({ ...zeile(e.path.slice(ordner.length + 1), null), name: text(e.name) || e.path, fehler });
            continue;
        }
        const treffer = dateien.filter(f => muster.test(f.name));
        if (treffer.length) treffer.forEach(f => ziel.push(zeile(f.name, f)));
        else ziel.push({ ...zeile(e.path.slice(ordner.length + 1), null), name: text(e.name) || e.path });
    }
    return [...gruppen.entries()].filter(([, z]) => z.length)
        .map(([key, dateien]) => ({ key, name: GRUPPEN[key], dateien }));
}

module.exports = { GRUPPEN, RE_PFAD, eintraege, panelSchluessel, stand };
