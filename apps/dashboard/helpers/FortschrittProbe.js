'use strict';

/**
 * Probe der Fortschritts-Bibliothek (G-20, K382, 2026-11-14) für /admin/fortschritt.
 *
 * Bis Leveling Stufe 1 bucht kein Plugin. Damit der Betreiber nach dem
 * Neustart sieht, dass Buchen, Doppelschutz, Kürzen, Storno, Ranglisten und
 * Nachrechnen gegen die echte Datenbank gehen, läuft hier eine Folge auf der
 * Kennung `kern:probe` in der Kontroll-Guild, mit dem Betreiber als Mitglied.
 * Vorher und nachher wird alles dieses Mitglieds in `kern:probe` gelöscht;
 * die Stufentabelle bleibt (sie lässt sich auf der Seite ausprobieren).
 *
 * @module apps/dashboard/helpers/FortschrittProbe
 */

const { Fortschritt } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

const KENNUNG = 'kern:probe';

/**
 * @param {string} guildId Kontroll-Guild
 * @param {string} mitglied Discord-ID des Betreibers
 * @returns {Promise<{ok: boolean, schritte: Array<{name, ok, text}>}>}
 */
async function laufen(guildId, mitglied) {
    const schritte = [];
    const lauf = `${Date.now()}`;
    const k = (n) => `probe:${lauf}:${n}`;
    const basis = { guildId, kennung: KENNUNG };
    async function schritt(name, fn) {
        try {
            const text = await fn();
            schritte.push({ name, ok: true, text: text || '' });
        } catch (err) {
            schritte.push({ name, ok: false, text: err.message });
        }
    }
    const soll = (bed, text) => { if (!bed) throw new Error(text); };

    await schritt('Ausgangslage', async () => {
        const r = await Fortschritt.entferneMitglied({ ...basis, mitglied });
        return `alte Probe weg: ${r.buchungen} Buchung(en)`;
    });
    await schritt('Buchen +150', async () => {
        const r = await Fortschritt.buche({ ...basis, mitglied, menge: 150, quelle: 'probe', schluessel: k(1) });
        const { stufen } = await Fortschritt.stufen(basis);
        soll(r.neu && r.xp === 150, `erwartet neu und 150 XP, war ${JSON.stringify({ neu: r.neu, xp: r.xp })}`);
        soll(r.level === Fortschritt.levelAus(stufen, 150), `Level ${r.level} passt nicht zur Tabelle`);
        return `150 XP, Level ${r.level} von ${stufen.length}${r.aufstieg ? ', Aufstieg gemeldet' : ''}`;
    });
    await schritt('Gleicher Schlüssel', async () => {
        const r = await Fortschritt.buche({ ...basis, mitglied, menge: 150, quelle: 'probe', schluessel: k(1) });
        soll(r.doppelt && r.xp === 150, `erwartet doppelt und 150 XP, war ${JSON.stringify({ doppelt: r.doppelt, xp: r.xp })}`);
        return 'doppelt, Stand unverändert 150';
    });
    await schritt('Minus über den Stand', async () => {
        const r = await Fortschritt.buche({ ...basis, mitglied, menge: -1000, quelle: 'probe', schluessel: k(2) });
        soll(r.gekuerzt && r.menge === -150 && r.xp === 0, `erwartet gekürzt auf −150 und 0 XP, war ${JSON.stringify({ menge: r.menge, xp: r.xp })}`);
        return 'auf −150 gekürzt, Stand 0';
    });
    await schritt('Storno', async () => {
        const a = await Fortschritt.storniere({ ...basis, schluessel: k(2), akteur: mitglied, grund: 'Probe' });
        const b = await Fortschritt.storniere({ ...basis, schluessel: k(1), akteur: mitglied, grund: 'Probe' });
        const c = await Fortschritt.storniere({ ...basis, schluessel: k(1) });
        soll(a.xp === 150 && b.xp === 0 && c.schon, `erwartet 150, 0 und „schon storniert“, war ${a.xp}, ${b.xp}, ${c.schon}`);
        return 'beide zurück, Stand 0; zweites Storno erkannt';
    });
    await schritt('Ranglisten', async () => {
        await Fortschritt.buche({ ...basis, mitglied, menge: 300, quelle: 'probe', schluessel: k(3) });
        const woche = await Fortschritt.rangliste({ ...basis, zeitraum: 'woche' });
        const gesamt = await Fortschritt.rangliste({ ...basis });
        const p = await Fortschritt.position({ ...basis, mitglied, zeitraum: 'monat' });
        const ich = woche.eintraege.find((e) => e.mitglied_id === String(mitglied));
        soll(ich && ich.xp === 300, `Wochenrangliste: erwartet 300, war ${ich?.xp}`);
        soll(gesamt.eintraege.some((e) => e.mitglied_id === String(mitglied) && e.xp === 300), 'Gesamtrangliste ohne 300');
        soll(p.platz >= 1 && p.xp === 300, `Monatsplatz: ${JSON.stringify(p)}`);
        return `Woche 300 (Platz ${ich.platz} von ${woche.gesamt}), Monat Platz ${p.platz} von ${p.von}`;
    });
    await schritt('Gesamtstand', async () => {
        const g = await Fortschritt.gesamtstand(basis);
        soll(g.xp >= 300, `erwartet mindestens 300, war ${g.xp}`);
        return `${g.xp} XP aus ${g.mitglieder} Mitglied(ern), Gesamt-Level ${g.level}`;
    });
    await schritt('Nachrechnen', async () => {
        const r = await Fortschritt.pruefe(basis);
        soll(!r.abweichungen.length, `Stand ≠ Summe: ${JSON.stringify(r.abweichungen)}`);
        return `${r.geprueft} Stand/Stände = Summe der Buchungen`;
    });
    await schritt('Aufräumen', async () => {
        const r = await Fortschritt.entferneMitglied({ ...basis, mitglied });
        return `${r.buchungen} Buchung(en), ${r.stand} Stand gelöscht`;
    });
    const ok = schritte.every((s) => s.ok);
    ServiceManager.get('Logger')[ok ? 'info' : 'warn'](`[Fortschritt] Probe in ${guildId}: ${schritte.map((s) => `${s.name} ${s.ok ? 'ok' : 'ROT'}`).join(', ')}`);
    return { ok, schritte };
}

/**
 * Überblick für /admin/fortschritt: Erklärungen und Zahlen je Kennung.
 *
 * @returns {Promise<{erklaerungen, je: Array, fehlt: string|null}>}
 */
async function ueberblick() {
    const db = ServiceManager.get('dbService');
    const erklaerungen = Fortschritt.erklaerungen({ frisch: true });
    try {
        const stand = await db.query('SELECT kennung, COUNT(DISTINCT guild_id) AS guilds, COUNT(*) AS mitglieder, COALESCE(SUM(xp), 0) AS xp FROM fortschritt_stand GROUP BY kennung ORDER BY kennung');
        const buch = await db.query(`SELECT kennung, COUNT(*) AS buchungen, SUM(storniert_am IS NOT NULL) AS storniert,
                                            SUM(quelle = 'kern:verdichtet') AS verdichtet, MAX(zeit) AS zuletzt
                                     FROM fortschritt_buchungen GROUP BY kennung`);
        const saisons = await db.query('SELECT kennung, COUNT(*) AS saisons, SUM(beendet_am IS NULL) AS offen FROM fortschritt_saisons GROUP BY kennung');
        const b = new Map(buch.map((z) => [z.kennung, z]));
        const s = new Map(saisons.map((z) => [z.kennung, z]));
        const kennungen = [...new Set([...stand.map((z) => z.kennung), ...b.keys(), ...s.keys()])].sort();
        const je = kennungen.map((kennung) => {
            const st = stand.find((z) => z.kennung === kennung) || {};
            const bu = b.get(kennung) || {};
            const sa = s.get(kennung) || {};
            return {
                kennung, erklaert: Boolean(Fortschritt.erklaerungFuer(kennung)),
                guilds: Number(st.guilds || 0), mitglieder: Number(st.mitglieder || 0), xp: Number(st.xp || 0),
                buchungen: Number(bu.buchungen || 0), storniert: Number(bu.storniert || 0), verdichtet: Number(bu.verdichtet || 0), zuletzt: bu.zuletzt || null,
                saisons: Number(sa.saisons || 0), offen: Number(sa.offen || 0),
            };
        });
        return { erklaerungen, je, fehlt: null };
    } catch (err) {
        if (err?.errno === 1146) return { erklaerungen, je: [], fehlt: 'Die Tabellen fehlen noch: Die Kern-Migration 20261114_235000_fortschritt läuft mit dem nächsten Neustart.' };
        throw err;
    }
}

module.exports = { laufen, ueberblick, KENNUNG };
