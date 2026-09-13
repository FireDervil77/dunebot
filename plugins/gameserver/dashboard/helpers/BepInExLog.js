/**
 * Was BepInEx beim letzten Start wirklich geladen hat.
 *
 * ── Warum aus der Logdatei (gemessen am 2026-09-13) ─────────────────────────
 *
 * Betreiber, 2026-09-13: Die Angaben im Modbereich sind nicht verlaesslich —
 * also soll der Server selbst sagen, welcher Mod laedt. BepInEx schreibt bei
 * jedem Start `BepInEx/LogOutput.log` neu. Auf einer Kopie von Server 189 lief
 * TeleportEverything 2.9.1 in einen Absturz beim Laden, und die Ausnahme stand
 * in der Datei — zwischen `Loading [TeleportEverything 2.9.1]` und
 * `Chainloader startup complete`. Die Containerausgabe taugt nicht: Der
 * Container wird beim Stopp entfernt, der Konsolenverlauf fasst 500 Zeilen.
 *
 * ── Zuordnung ueber die POSITION, nicht ueber den Namen ────────────────────
 *
 * Die Ausnahme eines Mods traegt seinen Namen nicht zuverlaessig (sie kommt aus
 * Unity, nicht aus BepInEx). Sie steht aber im Block zwischen seinem `Loading`
 * und dem naechsten `Loading` oder dem Ende des Chainloaders — der Lader laedt
 * der Reihe nach.
 *
 * Die Saetze des Chainloaders stehen woertlich so in BepInEx.dll 5.4.23.5
 * (ausgelesen mit `strings -e l`). Eine neue BepInEx-Fassung, die sie umformt,
 * faellt im Waechter check-inhalte-holen.js auf.
 *
 * Reine Funktionen: kein Daemon, keine Datenbank. Die Route liest die Datei,
 * hier wird nur ausgewertet.
 */
'use strict';

const KOPF = /^\[(Message|Info|Warning|Error|Fatal|Debug)\s*:\s*([^\]]*?)\s*\]\s?(.*)$/;

const kuerze = (s) => {
    const t = String(s || '').trim();
    return t.length > 240 ? t.slice(0, 237) + '…' : t;
};

/** `Jotunn 2.30.0` → { name: 'Jotunn', fassung: '2.30.0' }; Namen duerfen Leerzeichen haben. */
function teilePlugin(text) {
    const s = String(text || '').trim();
    const i = s.lastIndexOf(' ');
    if (i > 0 && /^\d+(\.\d+)*$/.test(s.slice(i + 1))) {
        return { name: s.slice(0, i), fassung: s.slice(i + 1) };
    }
    return { name: s, fassung: null };
}

// Aus BepInEx.dll 5.4.23.5 — Meldungen, die ein Plugin beim Namen nennen,
// ohne dass es je zu `Loading […]` kam.
const MELDUNGEN = [
    { muster: /^Error loading \[(.+?)\] : (.*)$/, status: 'fehler',
      grund: m => kuerze(m[2]) },
    { muster: /^Could not load \[(.+?)\] because it has missing dependencies: (.*)$/, status: 'nicht_geladen',
      grund: m => kuerze(`Fehlende Abhängigkeiten: ${m[2]}`) },
    { muster: /^Could not load \[(.+?)\] because it is incompatible with: (.*)$/, status: 'nicht_geladen',
      grund: m => kuerze(`Unverträglich mit: ${m[2]}`) },
    { muster: /^Skipping \[(.+?)\] because a newer version exists \((.*)\)$/, status: 'uebersprungen',
      grund: m => kuerze(`Eine neuere Fassung ist vorhanden (${m[2]})`) },
    { muster: /^Skipping \[(.+?)\] because it has a dependency that was not loaded/, status: 'nicht_geladen',
      grund: () => 'Eine Abhängigkeit wurde nicht geladen' },
    { muster: /^Skipping \[(.+?)\] because of process filters \((.*)\)$/, status: 'uebersprungen',
      grund: m => kuerze(`Prozessfilter (${m[2]})`) },
];

/**
 * Die Logdatei auswerten.
 *
 * @param {string} text Inhalt von LogOutput.log
 * @returns {{vollstaendig: boolean, bepinex: string|null, pack: string|null, anzahl: number|null,
 *            plugins: Array<{name: string, fassung: string|null, status: string|null,
 *                            grund: string|null, warnungen: string[]}>}}
 */
function werteAus(text) {
    const ergebnis = { vollstaendig: false, bepinex: null, pack: null, anzahl: null, plugins: [] };
    const bekannt = new Map();
    const plugin = (roh) => {
        const { name, fassung } = teilePlugin(roh);
        const schluessel = `${name} ${fassung || ''}`;
        if (!bekannt.has(schluessel)) {
            const p = { name, fassung, status: null, grund: null, warnungen: [] };
            bekannt.set(schluessel, p);
            ergebnis.plugins.push(p);
        }
        return bekannt.get(schluessel);
    };

    let offen = null;
    for (const zeile of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
        const k = zeile.match(KOPF);
        // Ohne Kopf ist es eine Fortsetzung (Stacktrace). Den Grund traegt die
        // erste Zeile — der Rest wuerde die Anzeige nur fuellen.
        if (!k) continue;
        const [, stufe, quelle, nachricht] = k;

        if (quelle === 'BepInEx') {
            let m;
            if (!ergebnis.bepinex && (m = nachricht.match(/^BepInEx (\S+) - /))) { ergebnis.bepinex = m[1]; continue; }
            if (!ergebnis.pack && (m = nachricht.match(/version (\d+(?:\.\d+)+) from Thunderstore/))) { ergebnis.pack = m[1]; continue; }
            if ((m = nachricht.match(/^(\d+) plugins? to load$/))) { ergebnis.anzahl = Number(m[1]); continue; }
            if ((m = nachricht.match(/^Loading \[(.+)\]$/))) {
                offen = plugin(m[1]);
                if (!offen.status) offen.status = 'geladen';
                continue;
            }
            if (nachricht === 'Chainloader startup complete') { ergebnis.vollstaendig = true; offen = null; continue; }
            if ((m = nachricht.match(/^Plugin \[(.+?)\] targets a wrong version of BepInEx \((.*?)\)/))) {
                plugin(m[1]).warnungen.push(`Gebaut für BepInEx ${m[2]}`);
                continue;
            }
            const treffer = MELDUNGEN.map(x => ({ x, m: nachricht.match(x.muster) })).find(t => t.m);
            if (treffer) {
                const p = plugin(treffer.m[1]);
                p.status = treffer.x.status;
                p.grund = treffer.x.grund(treffer.m);
                continue;
            }
        }

        // Alles andere gehoert dem Mod, der gerade geladen wird — und nur ihm.
        // Nach `Chainloader startup complete` ist niemand mehr zustaendig: Die
        // Unity-Fehler danach (Shader, Video) betreffen das Spiel.
        if (!offen || ergebnis.vollstaendig) continue;
        if (stufe === 'Error' || stufe === 'Fatal') {
            if (offen.status === 'geladen') { offen.status = 'fehler'; offen.grund = kuerze(nachricht); }
        } else if (stufe === 'Warning' && offen.warnungen.length < 3) {
            offen.warnungen.push(kuerze(`${quelle}: ${nachricht}`));
        }
    }

    if (!ergebnis.vollstaendig && offen && offen.status === 'geladen') {
        offen.status = 'abgebrochen';
        offen.grund = 'Der Start endete, während dieser Mod geladen wurde.';
    }
    return ergebnis;
}

/**
 * Die Plugins aus dem Log den Zeilen des Servers zuordnen.
 *
 * Gemessen am 2026-09-13: Thunderstore-Name und Plugin-Name stimmen bei
 * Jotunn und TeleportEverything ueberein. Verglichen wird ohne Gross/Klein und
 * Zeichen; ersatzweise mit dem Namen aus der Kennung. Was sich keiner Zeile
 * zuordnen laesst, kommt als `fremd` zurueck — nicht still unter den Tisch:
 * Das kann ein Mod sein, den ein anderes Paket mitbringt, oder einer, dessen
 * Datei nach dem Entfernen noch liegt.
 *
 * @param {object} ergebnis aus werteAus
 * @param {{lader: object|null, mods: object[]}} liste aus Inhalte.fuerServer
 * @param {string|null} stand Zeitstempel der Logdatei (mod_time)
 */
function ordneZu(ergebnis, liste, stand) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const standZeit = stand ? new Date(stand).getTime() : null;
    const neuSeitStart = z => Boolean(standZeit && z.installiert_am
        && new Date(z.installiert_am).getTime() > standZeit);
    const zeilen = {};
    const vergeben = new Set();

    for (const z of (liste.mods || [])) {
        if (z.status !== 'installiert') continue;
        if (neuSeitStart(z)) {
            zeilen[z.id] = { status: 'neu_seit_start', warnungen: [],
                grund: 'Seit dem letzten Start installiert — BepInEx hat ihn noch nicht geladen.' };
            continue;
        }
        const namen = [norm(z.name), norm(String(z.kennung || '').split('-').slice(1).join('-'))].filter(Boolean);
        const kandidaten = ergebnis.plugins.filter(p => !vergeben.has(p) && namen.includes(norm(p.name)));
        const p = kandidaten.find(k => k.fassung && k.fassung === z.fassung) || kandidaten[0];
        if (!p) {
            zeilen[z.id] = { status: 'nicht_gesehen', warnungen: [],
                grund: 'Kommt im Log des letzten Starts nicht vor.' };
            continue;
        }
        vergeben.add(p);
        zeilen[z.id] = {
            status: p.status || 'nicht_gesehen', grund: p.grund, warnungen: p.warnungen,
            plugin: `${p.name}${p.fassung ? ' ' + p.fassung : ''}`,
            // Schalten aendert nur die Zeile, nicht die Datei — BepInEx laedt
            // alles, was in plugins/ liegt. Das soll man sehen.
            trotzAus: !z.aktiv && p.status === 'geladen',
        };
    }

    const z = liste.lader;
    if (z && z.status === 'installiert') {
        if (neuSeitStart(z)) {
            zeilen[z.id] = { status: 'neu_seit_start', warnungen: [], grund: 'Seit dem letzten Start installiert.' };
        } else if (ergebnis.vollstaendig) {
            zeilen[z.id] = { status: 'geladen', grund: null,
                warnungen: ergebnis.pack && z.fassung && ergebnis.pack !== z.fassung
                    ? [`Das Log meldet Pack ${ergebnis.pack}, eingetragen ist ${z.fassung}.`] : [] };
        } else if (ergebnis.bepinex) {
            zeilen[z.id] = { status: 'abgebrochen', warnungen: [],
                grund: 'BepInEx lief an, der Chainloader wurde aber nicht fertig.' };
        } else {
            zeilen[z.id] = { status: 'nicht_gesehen', warnungen: [], grund: 'Im Log steht kein Start von BepInEx.' };
        }
    }

    const fremd = ergebnis.plugins.filter(p => !vergeben.has(p))
        .map(p => ({ name: p.name, fassung: p.fassung, status: p.status, grund: p.grund }));
    return { zeilen, fremd };
}

module.exports = { werteAus, ordneZu, teilePlugin };
