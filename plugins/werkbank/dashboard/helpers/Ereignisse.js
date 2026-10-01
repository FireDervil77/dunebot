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
 * ## Prüfdurchlauf (Stufe 3)
 *
 * Der Daemon meldet alles Zwischendurch unter `<kennung>-pruefung` — dieselben
 * Aktionen wie Schritt und Probestart. `verteile` fängt sie VOR den Handlern
 * ab und schreibt sie ins Protokoll des Durchlaufs; sonst suchten die Handler
 * einen Schritt oder Lauf, den es nicht gibt. Das Urteil kommt als `pruefung`
 * unter der Kennung der Sitzung.
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
/** kennung → { pruefId, guildId } — der laufende Prüfdurchlauf. */
const pruefungen = new Map();
/** pruefId → { zeilen: [], zeitgeber } */
const pruefPuffer = new Map();
function merkePruefung(kennung, eintrag) { pruefungen.set(kennung, eintrag); }
function vergissPruefung(kennung) { pruefungen.delete(kennung); }
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
    // Die Summe VOR dem Statuswechsel: Wer auf „fertig" hin die Seite lädt,
    // soll den Schritt schon mit eingetragener Summe sehen.
    if (ok && payload.pruefsumme && await Sitzungen.pruefsummeEintragen(lauf.schrittId, payload.pruefsumme)) {
        await Sitzungen.ausgabeAnhaengen(lauf.schrittId,
            `==> Pruefsumme ausgerechnet und in den Schritt eingetragen: ${payload.pruefsumme}\n`
            + '    (selbst gerechnet — nennt der Hersteller eine, vergleiche sie)\n');
    }
    const dateien = payload.dateien && typeof payload.dateien === 'object' ? payload.dateien : null;
    await Sitzungen.beenden(lauf.schrittId, ok
        ? { status: 'ok', bytes: Number.isFinite(Number(payload.bytes)) ? Number(payload.bytes) : null, dateien }
        : { status: 'fehler', fehler: String(payload.error || 'unbekannter Fehler'), dateien });
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

/**
 * Der Nachweis der Einstellungen (B1) als Zeilen — für Konsole und Protokoll.
 * `configured` kommt auf demselben Weg wie die Bereitschaftsstufen, ist aber
 * keine: Als Bereitschaft gespeichert, stünde kurz „configured" im Kasten.
 */
function nachweisZeilen(p) {
    const n = Array.isArray(p.nachweis) ? p.nachweis : [];
    if (!n.length) return ['── Einstellungen: fb-init hat Dateien geschrieben (keine Einstellung im Entwurf)'];
    return ['── Einstellungen — kam der Wert an?'].concat(n.map(x =>
        `   ${x.zustand === 'angekommen' ? '✓' : '✗'} ${x.key} → ${x.ziel}${x.wo ? ' ' + x.wo : ''}: ${x.zustand}${x.hinweis ? ' — ' + x.hinweis : ''}`));
}

const beiBereitschaft = zumLauf('bereitschaft', async (p, lauf, kennung) => {
    const { sitzung_id, server_id, ...daten } = p;
    if (daten.type === 'configured') {
        sende(lauf.guildId, { action: 'einstellungen', sitzung_id: kennung, zeilen: nachweisZeilen(daten) });
        return;
    }
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

// ── Prüfdurchlauf ────────────────────────────────────────────────────────────

async function findePruefung(kennung) {
    if (pruefungen.has(kennung)) return pruefungen.get(kennung);
    const z = await Sitzungen.laufendePruefung(kennung);
    if (z) pruefungen.set(kennung, { pruefId: z.pruefId, guildId: z.guildId });
    return z ? pruefungen.get(kennung) : null;
}

async function schreibePruefPuffer(pruefId) {
    const p = pruefPuffer.get(pruefId);
    if (!p) return;
    clearTimeout(p.zeitgeber);
    pruefPuffer.delete(pruefId);
    if (p.zeilen.length) await Sitzungen.pruefProtokoll(pruefId, p.zeilen.join(''));
}

/** Eine Zeile fürs Protokoll aus einer Zwischenmeldung — oder null. */
function pruefZeile(action, p) {
    switch (action) {
        case 'status':       return p.message ? `── ${p.message}` : null;
        case 'output':       return (p.finding ? '⚑ ' : '') + String(p.line ?? '');
        case 'konsole':      return String(p.line ?? '');
        case 'gestartet':    return '── Spiel gestartet';
        case 'bereitschaft': if (p.type === 'configured') return nachweisZeilen(p).join('\n');
                             return `── Bereitschaft: ${p.type || ''}${p.stage ? ' · ' + p.stage : ''}${(p.hinweis || p.note) ? ' — ' + (p.hinweis || p.note) : ''}`;
        case 'beendet':      return `── Spiel beendet (Code ${p.exit_code ?? '?'})`;
        case 'fertig':       return '── Schritt fertig';
        case 'fehlgeschlagen': return `── Schritt gescheitert: ${p.error || ''}`;
        default:             return null; // ports: steht im Urteil
    }
}

async function beiPruefZwischen(action, payload) {
    const kennung = String(payload.sitzung_id).slice(0, -Sitzungen.PRUEF_SUFFIX.length);
    const pr = await findePruefung(kennung);
    if (!pr) return;
    const zeile = pruefZeile(action, payload);
    if (zeile === null) return;
    sende(pr.guildId, { action: 'pruefung_zeile', sitzung_id: kennung, line: zeile });
    let b = pruefPuffer.get(pr.pruefId);
    if (!b) {
        b = { zeilen: [], zeitgeber: null };
        pruefPuffer.set(pr.pruefId, b);
    }
    b.zeilen.push(zeile + '\n');
    if (!b.zeitgeber) {
        b.zeitgeber = setTimeout(() => {
            schreibePruefPuffer(pr.pruefId).catch(fehler =>
                ServiceManager.get('Logger').error(`[Werkbank] Prüfprotokoll nicht gespeichert (${pr.pruefId}):`, fehler));
        }, 1000);
    }
}

async function beiPruefung(payload) {
    const kennung = payload?.sitzung_id;
    const pr = kennung && await findePruefung(kennung);
    const Logger = ServiceManager.get('Logger');
    if (!pr) {
        Logger.warn(`[Werkbank] Urteil für Sitzung ${kennung} ohne laufenden Durchlauf`);
        return;
    }
    await schreibePruefPuffer(pr.pruefId);
    const ergebnis = payload.ergebnis && typeof payload.ergebnis === 'object' ? payload.ergebnis : { gruen: false, gruende: ['Urteil ohne Inhalt'] };
    await Sitzungen.pruefungBeenden(pr.pruefId, ergebnis);
    vergissPruefung(kennung);
    sende(pr.guildId, { action: 'pruefung', sitzung_id: kennung, gruen: Boolean(ergebnis.gruen) });
    Logger.info(`[Werkbank] Sitzung ${kennung}: Prüfdurchlauf ${pr.pruefId} ${ergebnis.gruen ? 'GRÜN' : 'rot'}`);
}

/** Zwischenmeldungen eines Durchlaufs abfangen, alles andere zum Handler. */
function verteile(action, handler) {
    return (payload) => {
        const kennung = String(payload?.sitzung_id || '');
        if (kennung.endsWith(Sitzungen.PRUEF_SUFFIX)) return beiPruefZwischen(action, payload);
        return handler(payload);
    };
}

let angemeldet = false;

/** Beim Router anmelden — einmal je Prozess. */
function anmelden() {
    if (angemeldet) return;
    const eventRouter = require('../../../../apps/dashboard/helpers/IPMEventRouter');
    eventRouter.register(NS, 'status', verteile('status', beiStatus));
    eventRouter.register(NS, 'output', verteile('output', beiAusgabe));
    eventRouter.register(NS, 'fertig', verteile('fertig', (p) => beiEnde(p, true)));
    eventRouter.register(NS, 'fehlgeschlagen', verteile('fehlgeschlagen', (p) => beiEnde(p, false)));
    eventRouter.register(NS, 'gestartet', verteile('gestartet', beiGestartet));
    eventRouter.register(NS, 'konsole', verteile('konsole', beiKonsole));
    eventRouter.register(NS, 'bereitschaft', verteile('bereitschaft', beiBereitschaft));
    eventRouter.register(NS, 'ports', verteile('ports', beiPorts));
    eventRouter.register(NS, 'beendet', verteile('beendet', beiBeendet));
    eventRouter.register(NS, 'pruefung', beiPruefung);
    angemeldet = true;
}

module.exports = {
    anmelden, merke, vergiss, merkeLauf, vergissLauf, merkePruefung, vergissPruefung, verteile,
    beiAusgabe, beiEnde, beiStatus, beiGestartet, beiKonsole, beiBereitschaft, beiPorts, beiBeendet, beiPruefung,
    _laufend: laufend, _puffer: puffer, _laeufe: laeufe, _konsolenPuffer: konsolenPuffer,
    _pruefungen: pruefungen, _pruefPuffer: pruefPuffer,
};
