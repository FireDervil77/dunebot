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
 * @module werkbank/helpers/Ereignisse
 */

const { ServiceManager } = require('dunebot-core');
const Sitzungen = require('./Sitzungen');

const NS = 'werkbank';

/** kennung → { schrittId, guildId } — der gerade laufende Schritt. */
const laufend = new Map();
/** schrittId → { zeilen: [], zeitgeber } */
const puffer = new Map();

function merke(kennung, eintrag) { laufend.set(kennung, eintrag); }
function vergiss(kennung) { laufend.delete(kennung); }

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

let angemeldet = false;

/** Beim Router anmelden — einmal je Prozess. */
function anmelden() {
    if (angemeldet) return;
    const eventRouter = require('../../../../apps/dashboard/helpers/IPMEventRouter');
    eventRouter.register(NS, 'status', beiStatus);
    eventRouter.register(NS, 'output', beiAusgabe);
    eventRouter.register(NS, 'fertig', (p) => beiEnde(p, true));
    eventRouter.register(NS, 'fehlgeschlagen', (p) => beiEnde(p, false));
    angemeldet = true;
}

module.exports = { anmelden, merke, vergiss, beiAusgabe, beiEnde, beiStatus, _laufend: laufend, _puffer: puffer };
