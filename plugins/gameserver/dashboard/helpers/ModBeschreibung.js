'use strict';

/**
 * Was eine Mod über sich selbst sagt: wie sie heißt, was sie braucht, was in
 * ihr steckt (K226, Pack-Befund Stufe 2).
 *
 * ── Wozu ────────────────────────────────────────────────────────────────────
 *
 * Ein Modpack läuft auf dem Server, wenn jede Mod, die dort landet, ihre
 * Pflichtabhängigkeiten vorfindet. Der Lader prüft genau das beim Start und
 * bricht sonst ab. Die Angaben stehen in jeder Mod selbst:
 *
 *   Forge / NeoForge   META-INF/mods.toml, META-INF/neoforge.mods.toml
 *   Fabric             fabric.mod.json
 *   Forge bis 1.12     mcmod.info (nur die Kennung; Abhängigkeiten stehen dort
 *                      in der Annotation im Code, nicht in der Datei)
 *
 * ── Wofür die Angaben NICHT taugen ──────────────────────────────────────────
 *
 * Als Trennsignal Client/Server (gemessen 2026-10-14 an BMC4):
 * `clientSideOnly = true` tragen Sparse Structures (Weltgenerierung) und
 * Krypton Reno. Hier wird deshalb nichts aussortiert. Gelesen wird die Angabe
 * nur in der nachsichtigen Richtung: Eine Mod, die der Lader auf dem Server
 * gar nicht lädt, verlangt dort auch nichts.
 *
 * ── Nachsichtig, mit Absicht ────────────────────────────────────────────────
 *
 * Aus diesen Angaben wird „unvollständig", und das blendet ein Paket für alle
 * aus. Im Zweifel gilt eine Abhängigkeit deshalb als erfüllt:
 *
 * - Verlangt wird nur nach den Angaben der Laderfamilie des Pakets. Eine
 *   Fabric-Mod in einem Forge-Paket (Sinytra Connector) nennt `fabricloader`,
 *   das dort eine Brücke stellt, die diese Datei nicht kennt.
 * - Geboten wird alles, was irgendeine Angabe nennt.
 * - Fassungsbereiche werden nicht geprüft, nur das Vorhandensein.
 */

const ZipFern = require('./ZipFern');

/** Eine Beschreibungsdatei ist Text; mehr als das ist keine. */
const TEXT_GRENZE = 2 * 1024 * 1024;
/** Ein eingebettetes Jar wird ganz in den Speicher geholt. */
const EINGEBETTET_GRENZE = 48 * 1024 * 1024;
/** Jar in Jar in Jar — tiefer verschachtelt niemand. */
const TIEFE = 3;

const FORGE_DATEIEN = ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml'];
const FABRIC_DATEI = 'fabric.mod.json';
const ALT_DATEI = 'mcmod.info';
const JARJAR = 'META-INF/jarjar/metadata.json';

/** `forge` und `neoforge` lesen dieselbe Beschreibung. */
function familie(lader) {
    return lader === 'fabric' ? 'fabric' : 'forge';
}

/**
 * Den Wert rechts vom `=` lesen — nur was hier gebraucht wird.
 * @returns {string|boolean|undefined} undefined: etwas anderes (Zahl, Liste, Tabelle)
 */
function tomlWert(roh) {
    const text = roh.trim();
    if (text.startsWith('"') || text.startsWith("'")) {
        const zeichen = text[0];
        let aus = '';
        for (let i = 1; i < text.length; i++) {
            if (zeichen === '"' && text[i] === '\\') { aus += text[i + 1] || ''; i++; continue; }
            if (text[i] === zeichen) return aus;
            aus += text[i];
        }
        return aus;
    }
    const wort = text.split('#')[0].trim();
    if (wort === 'true') return true;
    if (wort === 'false') return false;
    return undefined;
}

/**
 * `mods.toml` lesen — der Teil von TOML, den diese Dateien benutzen.
 *
 * Kein allgemeiner TOML-Leser: Gebraucht werden die Tabellen `[[mods]]` und
 * `[[dependencies.<mod>]]` mit Text- und Wahrheitswerten. Mehrzeilige Texte
 * (Beschreibungen in `'''`) werden übersprungen, damit ein `[[…]]` in einer
 * Beschreibung keine Tabelle eröffnet.
 *
 * @returns {{mods: Object[], abhaengig: Object[], oben: Object}}
 */
function leseModsToml(text) {
    const mods = [];
    const abhaengig = [];
    const oben = {};
    let ziel = oben;
    let offen = null; // das Ende eines mehrzeiligen Textes, auf das gewartet wird

    for (const zeileRoh of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
        if (offen) {
            if (zeileRoh.includes(offen)) offen = null;
            continue;
        }
        const zeile = zeileRoh.trim();
        if (!zeile || zeile.startsWith('#')) continue;

        const tabelle = /^\[\[\s*([^\]]+?)\s*\]\]/.exec(zeile);
        if (tabelle) {
            const name = tabelle[1];
            if (name === 'mods') {
                ziel = {};
                mods.push(ziel);
            } else if (/^dependencies\b/.test(name)) {
                ziel = { besitzer: name.replace(/^dependencies\.?/, '').replace(/^["']|["']$/g, '') };
                abhaengig.push(ziel);
            } else {
                ziel = {};
            }
            continue;
        }
        if (/^\[[^\]]*\]/.test(zeile)) { ziel = {}; continue; }

        const paar = /^([A-Za-z0-9_.\-"']+)\s*=\s*(.*)$/.exec(zeile);
        if (!paar) continue;
        const rest = paar[2];
        const dreifach = /^('''|""")/.exec(rest);
        if (dreifach) {
            if (!rest.slice(3).includes(dreifach[1])) offen = dreifach[1];
            continue;
        }
        const wert = tomlWert(rest);
        if (wert !== undefined) ziel[paar[1].replace(/["']/g, '')] = wert;
    }
    return { mods, abhaengig, oben };
}

/** JSON, wie Mods es schreiben: mit Zeilenumbrüchen mitten im Text. */
function leseJsonNachsichtig(text) {
    const sauber = String(text).replace(/^﻿/, '');
    try { return JSON.parse(sauber); } catch { /* zweiter Versuch unten */ }
    return JSON.parse(sauber.replace(/[\u0000-\u001F]+/g, ' '));
}

const alsKennung = (wert) => String(wert || '').trim().toLowerCase();

/**
 * Eine Mod beschreiben.
 *
 * @param {Object} quelle   ZipFern-Quelle des Jars
 * @param {string} lader    Lader des Pakets (`forge`, `neoforge`, `fabric`)
 * @returns {Promise<{kennungen: string[], name: string|null, braucht: string[],
 *           eingebettet: string[], ohneBeschreibung: boolean, unlesbar: string|null,
 *           eintraege: Object[]}>}
 */
async function beschreibe(quelle, lader) {
    const eintraege = await ZipFern.verzeichnis(quelle);
    const finde = (name) => eintraege.find(e => e.name === name);
    const text = async (eintrag) => (await ZipFern.liesEintrag(quelle, eintrag, TEXT_GRENZE)).toString('utf8');

    const kennungen = new Set();
    const braucht = new Set();
    const eingebettet = new Set();
    let name = null;
    let gefunden = false;
    let unlesbar = null;
    const fam = familie(lader);

    // ── Welche der beiden Dateien gilt ──────────────────────────────────────
    //
    // Ein Jar für mehrere Lader trägt beide, mit verschiedenen Pflichten
    // (gemessen 2026-11-12, Immersive Lanterns 1.0.6: `accessories` Pflicht in
    // `neoforge.mods.toml`, freiwillig in `mods.toml`). Forge liest nur
    // `mods.toml`. NeoForge liest je nach Spielfassung die eine oder die
    // andere — dort gilt als Pflicht nur, was BEIDE nennen.
    const pflichtenJe = [];
    for (const datei of FORGE_DATEIEN) {
        const eintrag = finde(datei);
        if (!eintrag) continue;
        gefunden = true;
        try {
            const toml = leseModsToml(await text(eintrag));
            const eigene = toml.mods.map(m => alsKennung(m.modId)).filter(Boolean);
            eigene.forEach(k => kennungen.add(k));
            name = name || toml.mods.map(m => m.displayName).find(Boolean) || null;
            if (fam !== 'forge') continue;
            if (lader === 'forge' && datei !== FORGE_DATEIEN[0]) continue;
            const pflichten = new Set();
            pflichtenJe.push(pflichten);
            // Lädt der Lader sie auf dem Server nicht, verlangt sie dort nichts.
            if (toml.oben.clientSideOnly === true) continue;
            for (const a of toml.abhaengig) {
                const pflicht = a.mandatory === true || alsKennung(a.type) === 'required';
                if (!pflicht || alsKennung(a.side) === 'client') continue;
                if (a.modId) pflichten.add(alsKennung(a.modId));
            }
        } catch (fehler) {
            unlesbar = `${datei}: ${fehler.message}`;
        }
    }
    for (const kennung of pflichtenJe[0] || []) {
        if (pflichtenJe.every(menge => menge.has(kennung))) braucht.add(kennung);
    }

    const jarjar = finde(JARJAR);
    if (jarjar) {
        try {
            for (const j of leseJsonNachsichtig(await text(jarjar)).jars || []) {
                if (j?.path) eingebettet.add(String(j.path));
            }
        } catch (fehler) {
            unlesbar = unlesbar || `${JARJAR}: ${fehler.message}`;
        }
    }

    const fabric = finde(FABRIC_DATEI);
    if (fabric) {
        gefunden = true;
        try {
            const json = leseJsonNachsichtig(await text(fabric));
            if (json.id) kennungen.add(alsKennung(json.id));
            for (const k of Array.isArray(json.provides) ? json.provides : []) kennungen.add(alsKennung(k));
            name = name || json.name || null;
            for (const j of Array.isArray(json.jars) ? json.jars : []) {
                if (j?.file) eingebettet.add(String(j.file));
            }
            if (fam === 'fabric' && json.environment !== 'client') {
                for (const k of Object.keys(json.depends || {})) braucht.add(alsKennung(k));
            }
        } catch (fehler) {
            unlesbar = unlesbar || `${FABRIC_DATEI}: ${fehler.message}`;
        }
    }

    const alt = finde(ALT_DATEI);
    if (alt && !kennungen.size) {
        gefunden = true;
        try {
            const json = leseJsonNachsichtig(await text(alt));
            const liste = Array.isArray(json) ? json : (json.modList || []);
            for (const m of liste) if (m?.modid) kennungen.add(alsKennung(m.modid));
            name = name || liste.map(m => m?.name).find(Boolean) || null;
        } catch {
            // `mcmod.info` ist oft kein gültiges JSON und sagt über
            // Abhängigkeiten ohnehin nichts — kein Befund.
        }
    }

    // Was sie selbst mitbringt, verlangt sie nicht von anderen.
    for (const k of kennungen) braucht.delete(k);

    return {
        kennungen: [...kennungen],
        name,
        braucht: [...braucht],
        eingebettet: [...eingebettet],
        ohneBeschreibung: !gefunden,
        unlesbar,
        eintraege,
    };
}

/**
 * Die Kennungen der Mods, die in dieser stecken (Jar-in-Jar).
 *
 * Teurer als `beschreibe` — jedes eingebettete Jar wird geholt. Deshalb ein
 * eigener Schritt, den der Befund nur geht, wenn sonst etwas fehlte.
 *
 * @returns {Promise<{kennungen: string[], unlesbar: string[]}>} `unlesbar`:
 *          eingebettete Jars, die sich nicht öffnen ließen — sie bieten dann
 *          nichts an, und der Befund muss das wissen.
 */
async function eingebetteteKennungen(quelle, beschreibung, lader, tiefe = TIEFE) {
    const kennungen = new Set();
    const unlesbar = [];
    if (tiefe <= 0) return { kennungen: [], unlesbar };
    for (const pfad of beschreibung.eingebettet) {
        const eintrag = beschreibung.eintraege.find(e => e.name === pfad);
        if (!eintrag) continue;
        try {
            const innen = ZipFern.pufferQuelle(await ZipFern.liesEintrag(quelle, eintrag, EINGEBETTET_GRENZE));
            const b = await beschreibe(innen, lader);
            b.kennungen.forEach(k => kennungen.add(k));
            const tiefer = await eingebetteteKennungen(innen, b, lader, tiefe - 1);
            tiefer.kennungen.forEach(k => kennungen.add(k));
            unlesbar.push(...tiefer.unlesbar);
        } catch (fehler) {
            unlesbar.push(`${pfad}: ${fehler.message}`);
        }
    }
    return { kennungen: [...kennungen], unlesbar };
}

module.exports = { beschreibe, eingebetteteKennungen, leseModsToml, familie };
