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
 *
 * ── exec (2026-11-01) ───────────────────────────────────────────────────────
 *
 * Quake- und Source-Spiele laden aus einer .cfg weitere mit `exec datei.cfg`.
 * Das Panel folgt diesen Zeilen: Die geladene Datei erscheint unter der, die sie
 * lädt, auch wenn das Paket sie nicht nennt. Das ist mehr als Bequemlichkeit,
 * denn eine geladene Datei kann einen Wert überschreiben, den das Panel gerade
 * gesetzt hat, und der Betreiber suchte den Fehler in den Einstellungen. Deshalb
 * steht an ihr, welche Panel-Werte sie auch setzt.
 *
 * Gesucht wird neben der ladenden Datei. Das trifft etmain/ und cfg/, aber nicht
 * das Innere von .pk3-Archiven oder den Ordner eines Mods; eine solche Datei steht
 * als nicht vorhanden da, obwohl das Spiel sie finden kann.
 */

const path = require('path');
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

/** Bis hierher wird `exec` verfolgt: Tiefe je Kette, gelesene Dateien je Abruf. */
const EXEC_MAX = { tiefe: 4, dateien: 40 };

const text = (t) => (t && typeof t === 'object' ? (t.de || t.en || '') : '');

/** Die Dateien, die eine .cfg mit `exec` lädt. Ohne Endung meint das Spiel `.cfg`. */
function execVerweise(inhalt) {
    const aus = [];
    for (const zeile of String(inhalt || '').split(/\r?\n/)) {
        const m = /^\s*exec\s+"?([^\s";]+)"?/i.exec(zeile);
        if (!m) continue;
        aus.push(path.posix.extname(m[1]) ? m[1] : `${m[1]}.cfg`);
    }
    return [...new Set(aus)];
}

/** Die Variablen, die eine .cfg setzt: `set name wert` oder `name wert`, klein geschrieben. */
function cfgSchluessel(inhalt) {
    const aus = new Set();
    for (const zeile of String(inhalt || '').split(/\r?\n/)) {
        const m = /^\s*(?:set[asu]?\s+)?([A-Za-z_][\w.]*)\s+\S/i.exec(zeile);
        if (m) aus.add(m[1].toLowerCase());
    }
    return aus;
}

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
    const nutzlast = (pfad) => ({
        server_id: String(server.id),
        rootserver_id: String(server.rootserver_id),
        install_path: server.install_path,
        path: pfad,
    });
    const listen = new Map();
    const liste = async (ordner) => {
        if (listen.has(ordner)) return listen.get(ordner);
        const antwort = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.list', nutzlast('/' + ordner), 15000)
            .catch(fehler => ({ success: false, error: fehler.message }));

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

    // ── exec folgen ──────────────────────────────────────────────────────────
    const lies = async (pfad) => {
        const antwort = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.read', nutzlast(pfad), 15000)
            .catch(fehler => ({ success: false, error: fehler.message }));
        return antwort?.success ? Buffer.from(antwort.data?.content || '', 'base64').toString('utf8') : null;
    };
    const bekannt = new Set([...gruppen.values()].flat().map(z => z.pfad));
    let gelesen = 0;
    for (const zeilen of gruppen.values()) {
        const offen = zeilen.map(z => ({ z, tiefe: 0, wurzel: z }));
        while (offen.length) {
            const { z, tiefe, wurzel } = offen.shift();
            if (!z.vorhanden || z.gesperrt || !z.pfad.toLowerCase().endsWith('.cfg')) continue;
            if (tiefe >= EXEC_MAX.tiefe || gelesen >= EXEC_MAX.dateien) { z.execOffen = true; continue; }
            gelesen++;
            const inhalt = await lies(z.pfad);
            if (inhalt === null) { z.execOffen = true; continue; }

            // Lädt die Wurzel diese Datei, gilt: Was sie setzt, kann das Panel überschreiben.
            if (z !== wurzel) {
                const hier = cfgSchluessel(inhalt);
                z.ueberschreibt = wurzel.panelSchluessel.filter(k => k.toLowerCase() !== 'exec' && hier.has(k.toLowerCase()));
            }

            const ordnerHier = path.posix.dirname(z.pfad);
            for (const verweis of execVerweise(inhalt)) {
                const ziel = path.posix.normalize(path.posix.join(ordnerHier, verweis));
                // Bleibt im selben Ordnerbaum; `exec ../x` führt nicht aus dem Spiel heraus.
                if (!ziel.startsWith(ordnerHier.split('/').slice(0, 2).join('/') + '/')) continue;
                if (bekannt.has(ziel)) {
                    const vorhandene = zeilen.find(x => x.pfad === ziel);
                    if (vorhandene && !vorhandene.geladenVon && vorhandene !== z) vorhandene.geladenVon = z.datei;
                    continue;
                }
                bekannt.add(ziel);
                const { ordner, muster } = zerlegeMuster(ziel);
                const { dateien, fehler } = await liste(ordner);
                const datei = (dateien || []).find(f => muster.test(f.name)) || null;
                const kind = {
                    pfad: ziel, datei: path.posix.basename(ziel), name: path.posix.basename(ziel), beschreibung: '',
                    vorhanden: Boolean(datei), gesperrt: gesperrt(ziel, sperrliste),
                    panelSchluessel: panelSchluessel(paket, ziel.slice(1)), geladenVon: z.datei,
                    ...(fehler ? { fehler } : {}),
                };
                zeilen.splice(zeilen.indexOf(z) + 1, 0, kind);
                offen.push({ z: kind, tiefe: tiefe + 1, wurzel });
            }
        }
    }

    return [...gruppen.entries()].filter(([, z]) => z.length)
        .map(([key, dateien]) => ({ key, name: GRUPPEN[key], dateien }));
}

module.exports = { GRUPPEN, RE_PFAD, EXEC_MAX, eintraege, panelSchluessel, execVerweise, cfgSchluessel, stand };
