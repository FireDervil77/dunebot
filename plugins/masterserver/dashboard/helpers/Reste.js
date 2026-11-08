'use strict';

/**
 * Reste: Platte gegen Datenbank (K313, 2026-11-08).
 *
 * Der Daemon räumt beim Verbinden selbst weg, was keinem Server seiner Maschine
 * gehört, und meldet danach seinen Bestand (`reste.befund`). Hier wird dieser
 * Bestand mit der Datenbank verglichen — und die Ports, die nur die Datenbank
 * kennt. Ein Befund heißt: Platte und Panel erzählen verschiedene Dinge.
 *
 * Gebraucht von scripts/check-reste.js. Reine Funktionen bis auf `lade`.
 */

const ARTEN = new Set(['volume', 'laufordner', 'sicherungen', 'freigabe', 'container', 'unbekannt']);
const MAX_EINTRAEGE = 500;

/** Vorläufige Portbuchungen (`server_id = 0`) dürfen so lange stehen. */
const VORMERKUNG_MS = 60 * 60 * 1000;

const text = (v, n) => String(v ?? '').slice(0, n);
const zahl = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);

function reste(liste) {
    return (Array.isArray(liste) ? liste : []).slice(0, MAX_EINTRAEGE)
        .filter(r => r && ARTEN.has(r.art))
        .map(r => ({ art: r.art, name: text(r.name, 200), bytes: zahl(r.bytes), ...(r.grund ? { grund: text(r.grund, 300) } : {}) }));
}

/**
 * Was der Daemon meldet, in die Form, die gespeichert wird. Fremde Felder und
 * Übergrößen fallen weg — die Zeile wird später angezeigt.
 */
function bereinige(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const namen = (l) => (Array.isArray(l) ? l : []).slice(0, MAX_EINTRAEGE).map(n => text(n, 100));
    const sicherungen = {};
    for (const [id, archive] of Object.entries(p.sicherungen || {}).slice(0, MAX_EINTRAEGE)) {
        if (!/^\d+$/.test(id)) continue;
        sicherungen[id] = (Array.isArray(archive) ? archive : []).slice(0, MAX_EINTRAEGE)
            .map(a => ({ name: text(a?.name, 200), bytes: zahl(a?.bytes) }));
    }
    return {
        am: zahl(p.am),
        volumes: namen(p.volumes),
        sicherungen,
        werkbank: namen(p.werkbank),
        entfernt: reste(p.entfernt),
        geblieben: reste(p.geblieben),
    };
}

function gb(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1e9) return `${(n / 1e9).toFixed(2).replace('.', ',')} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} MB`;
    return `${n} Bytes`;
}

function portsAus(json) {
    let p = json;
    try { if (typeof p === 'string') p = JSON.parse(p); } catch (_) { p = {}; }
    const aus = [];
    for (const [zweck, w] of Object.entries(p || {})) {
        const n = Number(w && typeof w === 'object' ? (w.external ?? w.internal) : w);
        if (Number.isInteger(n) && n > 0) aus.push({ zweck, port: n });
    }
    return aus;
}

const ms = (d) => (d instanceof Date ? d.getTime() : (d ? new Date(d).getTime() : 0));

/**
 * Vergleicht eine Maschine.
 *
 * @param {object} d
 * @param {object|null} d.befund     bereinigter reste.befund, null = nie gemeldet
 * @param {Date|null}   d.befundAm   wann er kam
 * @param {Array} d.server      gameservers dieser Maschine {id, name, status, ports, created_at, loeschung_seit}
 * @param {Array} d.zugezogen   {server_id, completed_at} — Umzüge hierher
 * @param {Array} d.sicherungen gameserver_backups ihrer Server {server_id, name, status, pruned_at, completed_at}
 * @param {Array} d.buchungen   port_allocations dieser Maschine mit server_id IS NOT NULL {port, server_id, assigned_at}
 * @param {Array} d.sitzungen   offene werkbank_sitzungen dieser Maschine {kennung, created_at}
 * @param {number} [d.jetzt]
 * @returns {string[]} Befunde, leer = Platte und Panel stimmen überein
 */
function vergleiche(d) {
    const aus = [];
    const jetzt = d.jetzt ?? Date.now();
    const befund = d.befund;
    const befundMs = ms(d.befundAm);
    const server = d.server || [];
    const ids = new Map(server.map(s => [String(s.id), s]));

    // ── Ports: nur die Datenbank, gilt auch ohne Befund ─────────────────────
    // Je Nummer alle Buchungen: Eine Maschine mit zwei IPs hat jede Nummer zweimal.
    const buchung = new Map();
    for (const b of d.buchungen || []) {
        const n = Number(b.port);
        if (!buchung.has(n)) buchung.set(n, []);
        buchung.get(n).push(b);
    }
    for (const s of server) {
        for (const { zweck, port } of portsAus(s.ports)) {
            const fuer = buchung.get(port) || [];
            if (fuer.some(b => String(b.server_id) === String(s.id))) continue;
            aus.push(fuer.length
                ? `Port ${port} („${zweck}") nutzt Server ${s.id}, gebucht ist er für ${fuer.map(b => (Number(b.server_id) === 0 ? 'eine Vormerkung (0)' : `Server ${b.server_id}`)).join(' und ')}.`
                : `Port ${port} („${zweck}") von Server ${s.id} ist im Vorrat nicht gebucht — ein neuer Server kann ihn bekommen.`);
        }
    }
    const genutzt = new Set(server.flatMap(s => portsAus(s.ports).map(p => `${s.id}:${p.port}`)));
    for (const b of d.buchungen || []) {
        if (Number(b.server_id) === 0) {
            if (jetzt - ms(b.assigned_at) > VORMERKUNG_MS) aus.push(`Port ${b.port} ist seit ${new Date(ms(b.assigned_at)).toISOString()} vorgemerkt (server_id 0) — kein Anlegen oder Umzug läuft so lange.`);
            continue;
        }
        if (!ids.has(String(b.server_id))) aus.push(`Port ${b.port} ist für Server ${b.server_id} gebucht, den es auf dieser Maschine nicht gibt.`);
        else if (!genutzt.has(`${b.server_id}:${b.port}`)) aus.push(`Port ${b.port} ist für Server ${b.server_id} gebucht, der ihn nicht nutzt.`);
    }

    // ── Ab hier braucht es den Bestand des Daemons ──────────────────────────
    if (!befund) {
        aus.push('Der Daemon hat noch keinen Bestand gemeldet (reste.befund kommt ab Daemon 1.1.21 bei jeder Verbindung).');
        return aus;
    }

    // ── Was der Daemon nicht wegräumen konnte oder durfte ───────────────────
    for (const r of befund.geblieben) {
        aus.push(`Auf der Maschine liegt noch ${r.art} ${r.name || '(ohne Namen)'}${r.bytes ? ` (${gb(r.bytes)})` : ''}: ${r.grund || 'ohne Grund'}.`);
    }

    // Was erst nach dem Befund hierher kam, kann er nicht kennen.
    const spaeter = new Set([
        ...server.filter(s => ms(s.created_at) > befundMs).map(s => String(s.id)),
        ...(d.zugezogen || []).filter(z => ms(z.completed_at) > befundMs).map(z => String(z.server_id)),
    ]);

    const volumes = new Set(befund.volumes);
    for (const s of server) {
        const id = String(s.id);
        if (volumes.has(id) || spaeter.has(id) || s.loeschung_seit || s.status === 'installing') continue;
        aus.push(`Server ${id} („${s.name}") steht im Panel, auf der Maschine hat er keine Dateien.`);
    }
    for (const v of volumes) {
        if (!ids.has(v)) aus.push(`Auf der Maschine liegt das Volume ${v}, im Panel gibt es den Server hier nicht.`);
    }

    // ── Sicherungen: Zeile gegen Archiv ─────────────────────────────────────
    const zeilen = new Map();
    for (const z of d.sicherungen || []) {
        if (z.status !== 'completed' || z.pruned_at) continue;
        zeilen.set(`${z.server_id}/${z.name}.tar.gz`, z);
    }
    const archive = new Set();
    for (const [id, liste] of Object.entries(befund.sicherungen)) {
        for (const a of liste) {
            const schluessel = `${id}/${a.name}`;
            archive.add(schluessel);
            if (!zeilen.has(schluessel) && ids.has(id)) aus.push(`Archiv ${a.name} (${gb(a.bytes)}) von Server ${id} liegt auf der Maschine, im Panel steht es nicht.`);
        }
    }
    for (const [schluessel, z] of zeilen) {
        const id = String(z.server_id);
        if (archive.has(schluessel) || spaeter.has(id) || ms(z.completed_at) > befundMs) continue;
        aus.push(`Sicherung „${z.name}" von Server ${id} steht im Panel, das Archiv fehlt auf der Maschine.`);
    }

    // ── Werkbank ────────────────────────────────────────────────────────────
    const offen = new Set((d.sitzungen || []).map(s => s.kennung));
    for (const w of befund.werkbank) {
        if (!offen.has(w)) aus.push(`Werkbank-Ordner ${w} liegt auf der Maschine, eine offene Sitzung dazu gibt es nicht.`);
    }
    const ordner = new Set(befund.werkbank);
    for (const s of d.sitzungen || []) {
        if (!ordner.has(s.kennung) && ms(s.created_at) <= befundMs) aus.push(`Werkbank-Sitzung ${s.kennung} ist offen, ihr Ordner fehlt auf der Maschine.`);
    }
    return aus;
}

/**
 * Lädt eine Maschine aus der Datenbank und vergleicht sie.
 * @returns {Promise<{rootserver: object, befund: object|null, befunde: string[]}>}
 */
async function lade(dbService, rootserverId) {
    const [r] = await dbService.query('SELECT id, name, reste_befund, reste_am FROM rootserver WHERE id = ?', [rootserverId]);
    if (!r) return null;
    let befund = null;
    try { befund = r.reste_befund ? bereinige(JSON.parse(r.reste_befund)) : null; } catch (_) { befund = null; }
    const server = await dbService.query(
        'SELECT id, name, status, ports, created_at, loeschung_seit FROM gameservers WHERE rootserver_id = ?', [rootserverId]);
    const ids = server.map(s => s.id);
    const sicherungen = ids.length
        ? await dbService.query(
            `SELECT server_id, name, status, pruned_at, completed_at FROM gameserver_backups
              WHERE server_id IN (${ids.map(() => '?').join(',')})`, ids)
        : [];
    const zugezogen = await dbService.query(
        `SELECT server_id, completed_at FROM gameserver_migrations
          WHERE target_rootserver_id = ? AND status = 'completed'`, [rootserverId]);
    const buchungen = await dbService.query(
        'SELECT port, server_id, assigned_at FROM port_allocations WHERE rootserver_id = ? AND server_id IS NOT NULL', [rootserverId]);
    const sitzungen = await dbService.query(
        "SELECT kennung, created_at FROM werkbank_sitzungen WHERE rootserver_id = ? AND status = 'offen'", [rootserverId]);
    return {
        rootserver: r,
        befund,
        befunde: vergleiche({ befund, befundAm: r.reste_am, server, zugezogen, sicherungen, buchungen, sitzungen }),
    };
}

module.exports = { bereinige, vergleiche, lade, VORMERKUNG_MS };
