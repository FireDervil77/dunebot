'use strict';
/**
 * Server-Timing je Antwort, und langsame Anfragen ins Protokoll (2026-11-08).
 *
 * Steht als ERSTE Middleware, damit „gesamt" alles umfasst. Der Kopf wird
 * gesetzt, wenn die Antwort ihren Kopf schreibt — bei einer gerenderten Seite
 * also nach dem ganzen Rendern, bei der Live-Leitung (SSE) gleich zu Beginn.
 * Chrome zeigt ihn im Netzwerk-Reiter unter „Timing" → „Server-Timing".
 *
 * Gezählt werden Datenbank, Daemon und Bot (Anfragezeit). Was dann noch zur
 * Gesamtzeit fehlt, ist das Dashboard selbst: Rendern, Rechnen, Middlewares.
 */
const { performance } = require('perf_hooks');
const { ServiceManager, Anfragezeit } = require('dunebot-core');

/** Ab hier steht eine Anfrage im Protokoll — Zeit bis zum Kopf der Antwort. */
const LANGSAM_MS = 3000;

function anfragezeit(req, res, next) {
    Anfragezeit.lauf(() => {
        const zaehler = Anfragezeit.aktuell();
        const schreibeKopf = res.writeHead;
        res.writeHead = function (...args) {
            // Eine Messung darf nie eine Antwort verhindern.
            try {
                if (!res.headersSent) {
                    // Namen der Befehle nur für Angemeldete.
                    res.setHeader('Server-Timing', Anfragezeit.kopf(zaehler, { mitNamen: !!req.session?.user }));
                    const ms = performance.now() - zaehler.beginn;
                    if (ms >= LANGSAM_MS) {
                        // Ohne Abfrageteil: Dort können Schlüssel stehen.
                        const pfad = String(req.originalUrl || req.url || '').split('?')[0];
                        ServiceManager.get('Logger')?.warn(`[Anfragezeit] ${req.method} ${pfad} → ${res.statusCode} `
                            + `nach ${Math.round(ms)} ms — ${Anfragezeit.zusammenfassung(zaehler)}`);
                    }
                }
            } catch (_) {
                // bewusst still: Der Kopf ist ein Zusatz, die Antwort geht vor.
            }
            return schreibeKopf.apply(this, args);
        };
        next();
    });
}

module.exports = anfragezeit;
module.exports.LANGSAM_MS = LANGSAM_MS;
