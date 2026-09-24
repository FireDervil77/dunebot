'use strict';
/**
 * Ereignisse des Daemons für die Werkbank — `werkbank.status|output|fertig|fehlgeschlagen`.
 *
 * Der Daemon meldet unter dem Namensraum `werkbank` mit `sitzung_id` (W-13,
 * 2026-09-24), in derselben Form wie der Installationsfortschritt unter
 * `install`. Eine Sitzung ist kein Server — unter `install` versuchte das
 * Dashboard, eine gameservers-Zeile zu setzen.
 *
 * ## Ausgabe: sofort an den Browser, gebündelt in die Datenbank
 *
 * Jede Zeile geht sofort per SSE an die offenen Seiten der Guild (Namensraum
 * `werkbank`, die Seite filtert nach ihrer Sitzung). In die Datenbank wird
 * höchstens einmal je Sekunde geschrieben: SteamCMD schreibt mehrere Zeilen je
 * Sekunde, und jede als eigene UPDATE-Abfrage wäre Last für nichts. Am Ende
 * des Schritts wird der Puffer VOR dem Status geschrieben — sonst stünde
 * „fertig" über einer Ausgabe, der die letzten Zeilen fehlen.
 *
 * ## Probestart (Stufe 2)
 *
 * `gestartet|konsole|bereitschaft|ports|beendet` gehören zu einem Lauf in
 * `werkbank_laeufe`. Die Konsole wird wie die Schrittausgabe gebündelt; beim
 * Ende zuerst der Puffer, dann der Status — aus demselben Grund.
 *
 * @module werkbank/helpers/Ereignisse
 */

const { ServiceManager } = require('dunebot-core');
const Sitzungen = require('./Sitzungen');

const NS = 'werkbank';

/** kennung → { schrittId, guildId } — der gerade laufende Schritt. */
const laufend = new Map();
/** schrittId → { zeilen: [], zeitgeber } */
const puffer = new Map();
/** kennung → { laufId, guildId } — der laufende Probestart. */
const laeufe = new Map();
/** laufId → { zeilen: [], zeitgeber } */
const konsolenPuffer = new Map();

function merke(kennung, eintrag) { laufend.set(kennung, eintrag); }
function vergiss(kennung) { laufend.delete(kennung); }
function merkeLauf(kennung, eintrag) { laeufe.set(kennung, eintrag); }
function vergissLauf(kennung) { laeufe.delete(kennung); }

async function findeLauf(kennung) {
    if (laeufe.has(kennung)) return laeufe.get(kennung);
    const z = await Sitzungen.laufenderLauf(kennung);
    if (z) laeufe.set(kennung, { laufId: z.laufId, guildId: z.guildId });
    return z ? laeufe.get(kennung) : null;
}

/** Nach einem Neustart des Dashboards steht der laufende Schritt nur in der Datenbank. */
async function finde(kennung) {
    if (laufend.has(kennung)) return laufend.get(kennung);
    const z = await Sitzungen.laufenderSchritt(kennung);
    if (z) laufend.set(kennung, z);
    return z;
}

async function schreibePuffer(schrittId) {
    const p = puffer.get(schrittId);
    if (!p) return;
    clearTimeout(p.zeitgeber);
    puffer.delete(schrittId);
    if (p.zeilen.length) {
        await Sitzungen.ausgabeAnhaengen(schrittId, p.zeilen.join(''));
    }
}

function sende(guildId, daten) {
    if (!ServiceManager.has('sseManager')) return;
    ServiceManager.get('sseManager').broadcast(guildId, NS, daten);
}

async function beiStatus(payload) {
    const kennung = payload?.sitzung_id;
    const lauf = kennung && await finde(kennung);
    if (!lauf) return;
    sende(lauf.guildId, { action: 'status', sitzung_id: kennung, message: payload.message || '' });
}

async function beiAusgabe(payload) {
    const kennung = payload?.sitzung_id;
    const lauf = kennung && await finde(kennung);
    if (!lauf) return;
    const zeile = String(payload.line ?? '');
    const befund = payload.finding ? String(payload.finding) : null;

    sende(lauf.guildId, { action: 'output', sitzung_id: kennung, line: zeile, finding: befund });

    let p = puffer.get(lauf.schrittId);
    if (!p) {
        p = { zeilen: [], zeitgeber: null };
        puffer.set(lauf.schrittId, p);
    }
    p.zeilen.push((befund ? '⚑ ' : '') + zeile + '\n');
    if (!p.zeitgeber) {
        p.zeitgeber = setTimeout(() => {
            schreibePuffer(lauf.schrittId).catch(fehler =>
                ServiceManager.get('Logger').error(`[Werkbank] Ausgabe nicht gespeichert (Schritt ${lauf.schrittId}):`, fehler));
        }, 1000);
    }
}

async function beiEnde(payload, ok) {
    const Logger = ServiceManager.get('Logger');
    const kennung = payload?.sitzung_id;
    const lauf = kennung && await finde(kennung);
    if (!lauf) {
        Logger.warn(`[Werkbank] Ende für Sitzung ${kennung} ohne laufenden Schritt — nichts zu setzen`);
        return;
    }
    await schreibePuffer(lauf.schrittId);
    await Sitzungen.beenden(lauf.schrittId, ok
        ? { status: 'ok', bytes: Number.isFinite(Number(payload.bytes)) ? Number(payload.bytes) : null }
        : { status: 'fehler', fehler: String(payload.error || 'unbekannter Fehler') });
    vergiss(kennung);
    sende(lauf.guildId, {
        action: ok ? 'fertig' : 'fehlgeschlagen', sitzung_id: kennung,
        schritt_id: lauf.schrittId, error: ok ? null : String(payload.error || ''),
        bytes: payload.bytes ?? null,
    });
    Logger.info(`[Werkbank] Sitzung ${kennung}: Schritt ${lauf.schrittId} ${ok ? 'fertig' : 'gescheitert'}`);
}

// ── Probestart ───────────────────────────────────────────────────────────────

async function schreibeKonsole(laufId) {
    const p = konsolenPuffer.get(laufId);
    if (!p) return;
    clearTimeout(p.zeitgeber);
    konsolenPuffer.delete(laufId);
    if (p.zeilen.length) await Sitzungen.konsoleAnhaengen(laufId, p.zeilen.join(''));
}

/** Ein Ereignis zu einem Lauf: finden, dann `tu` — ohne Lauf nur protokollieren. */
function zumLauf(action, tu) {
    return async (payload) => {
        const kennung = payload?.sitzung_id;
        const lauf = kennung && await findeLauf(kennung);
        if (!lauf) {
            if (action !== 'konsole') {
                ServiceManager.get('Logger').warn(`[Werkbank] ${action} für Sitzung ${kennung} ohne laufenden Probestart`);
            }
            return;
        }
        await tu(payload, lauf, kennung);
    };
}

const beiGestartet = zumLauf('gestartet', async (p, lauf, kennung) => {
    await Sitzungen.laufSetzen(lauf.laufId, { status: 'laeuft', luecken: Array.isArray(p.luecken) ? p.luecken : [] });
    sende(lauf.guildId, { action: 'gestartet', sitzung_id: kennung, luecken: p.luecken || [] });
});

const beiKonsole = zumLauf('konsole', async (p, lauf, kennung) => {
    const zeile = String(p.line ?? '');
    sende(lauf.guildId, { action: 'konsole', sitzung_id: kennung, line: zeile });
    let k = konsolenPuffer.get(lauf.laufId);
    if (!k) {
        k = { zeilen: [], zeitgeber: null };
        konsolenPuffer.set(lauf.laufId, k);
    }
    k.zeilen.push(zeile + '\n');
    if (!k.zeitgeber) {
        k.zeitgeber = setTimeout(() => {
            schreibeKonsole(lauf.laufId).catch(fehler =>
                ServiceManager.get('Logger').error(`[Werkbank] Konsole nicht gespeichert (Lauf ${lauf.laufId}):`, fehler));
        }, 1000);
    }
});

const beiBereitschaft = zumLauf('bereitschaft', async (p, lauf, kennung) => {
    const { sitzung_id, server_id, ...daten } = p;
    await Sitzungen.laufSetzen(lauf.laufId, { bereitschaft: daten });
    sende(lauf.guildId, { action: 'bereitschaft', sitzung_id: kennung, ...daten });
});

const beiPorts = zumLauf('ports', async (p, lauf, kennung) => {
    const ports = Array.isArray(p.ports) ? p.ports : [];
    await Sitzungen.laufSetzen(lauf.laufId, { ports });
    sende(lauf.guildId, { action: 'ports', sitzung_id: kennung, ports });
});

const beiBeendet = zumLauf('beendet', async (p, lauf, kennung) => {
    await schreibeKonsole(lauf.laufId);
    const code = Number.isFinite(Number(p.exit_code)) ? Number(p.exit_code) : null;
    const text = [p.error, p.hinweis].filter(Boolean).join(' — ') || null;
    await Sitzungen.laufBeenden(lauf.laufId, {
        exit_code: code, gestoppt: p.gestoppt ? 1 : 0, fehler: text,
        dateien: p.dateien && typeof p.dateien === 'object' ? p.dateien : null,
    });
    vergissLauf(kennung);
    sende(lauf.guildId, { action: 'beendet', sitzung_id: kennung, exit_code: code, gestoppt: Boolean(p.gestoppt), error: text });
    ServiceManager.get('Logger').info(`[Werkbank] Sitzung ${kennung}: Probestart ${lauf.laufId} beendet (Code ${code})`);
});

let angemeldet = false;

/** Beim Router anmelden — einmal je Prozess. */
function anmelden() {
    if (angemeldet) return;
    const eventRouter = require('../../../../apps/dashboard/helpers/IPMEventRouter');
    eventRouter.register(NS, 'status', beiStatus);
    eventRouter.register(NS, 'output', beiAusgabe);
    eventRouter.register(NS, 'fertig', (p) => beiEnde(p, true));
    eventRouter.register(NS, 'fehlgeschlagen', (p) => beiEnde(p, false));
    eventRouter.register(NS, 'gestartet', beiGestartet);
    eventRouter.register(NS, 'konsole', beiKonsole);
    eventRouter.register(NS, 'bereitschaft', beiBereitschaft);
    eventRouter.register(NS, 'ports', beiPorts);
    eventRouter.register(NS, 'beendet', beiBeendet);
    angemeldet = true;
}

module.exports = {
    anmelden, merke, vergiss, merkeLauf, vergissLauf,
    beiAusgabe, beiEnde, beiStatus, beiGestartet, beiKonsole, beiBereitschaft, beiPorts, beiBeendet,
    _laufend: laufend, _puffer: puffer, _laeufe: laeufe, _konsolenPuffer: konsolenPuffer,
};
