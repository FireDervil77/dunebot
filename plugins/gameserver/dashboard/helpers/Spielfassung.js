'use strict';

/**
 * Die Spielfassung eines Servers — EIN Weg für alle Spiele (Stufe 10 S3, 2026-10-27).
 *
 * ── Zwei Fragen, eine Antwort ───────────────────────────────────────────────
 *
 * Die Mod-Suche braucht die Fassung des LAUFENDEN Spiels: Modrinth filtert nach
 * „1.21.1", ficsit.app nach der Changelist (`game_version: >=491125`). Bis
 * hierher konnte das nur Minecraft, und zwar in der Route (Einstellung
 * `version`, sonst der Merkzettel `.fb/minecraft-version` der Installation).
 * Jetzt kann es jedes Paket, das sagt, wo das Spiel seine Fassung hinschreibt:
 *
 *   "management": { "game_version": {
 *       "file": "Engine/Binaries/Linux/FactoryServer-Linux-Shipping.version",
 *       "build": "Changelist", "label": "GameVersion" } }
 *
 * Die Datei ist JSON — Unreal schreibt sie so. Ein Formatfeld gibt es nicht.
 *
 * `file` ist relativ zu game/ (wie die Ziele der Einstellungen). Jedes
 * Unreal-Spiel schreibt diese Datei selbst — gemessen an Satisfactory:
 * `"Changelist": 513885`, `"GameVersion": "1.2.4.1"`.
 *
 * ── Wer liest ───────────────────────────────────────────────────────────────
 *
 * Das Dashboard, über `gameserver.files.read` — derselbe Weg wie der
 * Merkzettel von Minecraft. Im Entwurf stand „der Daemon liest und meldet";
 * das wäre ein zweiter Weg zur selben Auskunft gewesen. Gelesen wird nach der
 * Installation und bei jedem Start (ein Update gibt es nur beim Start), und
 * gespeichert am Server: `build` für die Mod-Prüfung, `label` für die Anzeige.
 * Spiele ohne Angabe bekommen keine Anzeige — geraten wird nichts.
 */

const { ServiceManager } = require('dunebot-core');

/** Wie lang ein gelesener Wert höchstens sein darf — eine Fassung, kein Text. */
const MAX = { build: 40, label: 60 };

/** Die Angabe des Pakets — oder null. */
function angabe(paket) {
    const g = paket?.management?.game_version;
    return g && typeof g === 'object' && g.file && g.build ? g : null;
}

async function daemonVon(dbService, server) {
    const [zeile] = await dbService.query('SELECT daemon_id FROM rootserver WHERE id = ?', [server.rootserver_id]);
    return zeile ? zeile.daemon_id : null;
}

/**
 * Eine Datei vom Server lesen — Text, oder null mit Grund.
 *
 * `pfad` ab der Wurzel des Volumes (`/.fb/minecraft-version`, `/game/…`).
 * Der Daemon liefert Base64, immer (Baustelle 135).
 */
async function leseDatei(server, pfad) {
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    const daemonId = await daemonVon(dbService, server);
    if (!daemonId || !ipmServer?.isDaemonOnline(daemonId)) return { text: null, grund: 'Daemon nicht erreichbar' };
    const gelesen = await ipmServer.sendCommand(daemonId, 'gameserver.files.read', {
        server_id: String(server.id),
        rootserver_id: String(server.rootserver_id),
        install_path: server.install_path,
        path: pfad,
    }, 8000).catch(fehler => ({ success: false, error: fehler.message }));
    if (!gelesen?.success) return { text: null, grund: gelesen?.error || 'keine Antwort' };
    return { text: Buffer.from(String(gelesen.data?.content || ''), 'base64').toString('utf8'), grund: null };
}

/** Das erste Wort eines Merkzettels aus `.fb` (Minecraft) — oder null. */
async function merkzettel(server, name) {
    try {
        const { text } = await leseDatei(server, `/.fb/${name}`);
        return text ? (text.trim().split(/\s+/)[0] || null) : null;
    } catch {
        return null;
    }
}

/**
 * Den Inhalt der Datei nach der Angabe deuten.
 *
 * @returns {{build: string, label: string|null}|{fehler: string}}
 */
function deute(text, g) {
    let daten;
    try { daten = JSON.parse(text); } catch (e) { return { fehler: `kein JSON: ${e.message}` }; }
    const roh = daten?.[g.build];
    if (roh === undefined || roh === null || roh === '') return { fehler: `„${g.build}" steht nicht in der Datei` };
    const build = String(roh).trim();
    if (!build || build.length > MAX.build) return { fehler: `„${g.build}" ist keine Fassung: ${build.slice(0, 50)}` };
    const lab = g.label ? daten?.[g.label] : null;
    const label = lab === undefined || lab === null ? null : String(lab).trim().slice(0, MAX.label) || null;
    return { build, label };
}

/**
 * Lesen und am Server merken. Gibt das Gelesene zurück, oder null.
 *
 * Schlägt das Lesen fehl, bleibt der gespeicherte Wert stehen — er ist die
 * letzte bekannte Fassung, und ein Daemon, der gerade nicht antwortet, macht
 * das Spiel nicht älter. Der Grund geht ins Log.
 */
async function aktualisiere(server, paket) {
    const Logger = ServiceManager.get('Logger');
    const g = angabe(paket);
    if (!g) return null;
    const pfad = '/game/' + String(g.file).replace(/^\/+/, '');
    const { text, grund } = await leseDatei(server, pfad);
    if (text === null) {
        Logger.warn(`[Gameserver/Spielfassung] Server ${server.id}: ${pfad} nicht lesbar — ${grund}`);
        return null;
    }
    const d = deute(text, g);
    if (d.fehler) {
        Logger.warn(`[Gameserver/Spielfassung] Server ${server.id}: ${pfad} — ${d.fehler}`);
        return null;
    }
    await ServiceManager.get('dbService').query(
        'UPDATE gameservers SET spielfassung_build = ?, spielfassung_label = ?, spielfassung_am = NOW() WHERE id = ?',
        [d.build, d.label, server.id]);
    return d;
}

/** Die Einstellungen eines Servers, wie sie in `gameservers.paket_werte` stehen. */
function paketWerte(server) {
    try {
        return typeof server?.paket_werte === 'string' ? JSON.parse(server.paket_werte) : (server?.paket_werte || {});
    } catch {
        return {};
    }
}

/**
 * Die Fassung, gegen die Mods geprüft werden — oder null (unbekannt).
 *
 * Mit `management.game_version`: der gespeicherte Build, sonst frisch gelesen.
 * Ohne: wie bisher bei Minecraft — die Einstellung `version`, wenn sie nicht
 * `latest` ist, sonst der Merkzettel der Installation.
 */
async function fuerMods(server, paket) {
    if (angabe(paket)) {
        if (server?.spielfassung_build) return String(server.spielfassung_build);
        return (await aktualisiere(server, paket))?.build || null;
    }
    const ausWerten = String(paketWerte(server).version || '').trim();
    if (ausWerten && ausWerten !== 'latest') return ausWerten;
    return merkzettel(server, 'minecraft-version');
}

/**
 * Für Ereignisse, die nur die Nummer des Servers kennen (Start): Server und
 * Paket laden, lesen, merken. `management` hängt nicht am Lader — das rohe
 * Paket genügt.
 */
async function aktualisiereServer(serverId) {
    const dbService = ServiceManager.get('dbService');
    const [server] = await dbService.query(
        'SELECT id, rootserver_id, install_path FROM gameservers WHERE id = ?', [serverId]);
    if (!server) return null;
    const { ladePaketFuerServer } = require('./StartPayload');
    const z = await ladePaketFuerServer(dbService, server.id);
    const paket = z ? (typeof z.paket_json === 'string' ? JSON.parse(z.paket_json) : z.paket_json) : null;
    return angabe(paket) ? aktualisiere(server, paket) : null;
}

module.exports = { angabe, deute, leseDatei, merkzettel, aktualisiere, aktualisiereServer, paketWerte, fuerMods, MAX };
