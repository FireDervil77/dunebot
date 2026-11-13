'use strict';

/**
 * Fachereignisse: Vertrag (G-01), Melden und Hören (G-02).
 * Konzept: docs/plugins/gemeinsam/konzept.md.
 *
 * Eine geschlossene Liste aller Namen, die ein Plugin melden kann
 * (`liste.json`). Jedes Plugin erklärt in seiner `package.json`, was es sendet
 * und hört: `"ereignisse": { "sendet": [...], "hoert": [...] }`. Der Kern
 * erklärt seine `kern.*`-Namen in `plugins/core/package.json`.
 * `scripts/check-ereignisse.js` hält Liste, Erklärungen und Code beisammen.
 *
 * # Melden und Hören (G-02, 2026-11-13)
 *
 *     await Ereignisse.melde('ticket.geschlossen', { guild_id, schluessel, akteur, daten })
 *     Ereignisse.hoere('ticket.geschlossen', 'leveling', async (ereignis) => { … })
 *
 * Nur diese Schreibweise zählt der Wächter: Name und beim Hören das Plugin als
 * Zeichenkette.
 *
 * - **Melden geht in Bot und Dashboard.** Die Zeile kommt ins `ereignisbuch`,
 *   eindeutig je `(quelle, schluessel)`: Dasselbe zweimal gemeldet ergibt eine
 *   Zeile. Danach wird der Zusteller angestoßen, im Dashboard direkt, aus dem
 *   Bot über IPC (`core:EREIGNISSE_ANSTOSS`). Fällt der Anstoß aus, holt der
 *   Zusteller alle 2 s nach. Ein Neustart verliert also nichts.
 * - **Hören geht nur im Dashboard.** Dort läuft der Zusteller
 *   (`apps/dashboard/helpers/EreignisZusteller.js`). Braucht ein Hörer
 *   Discord, entscheidet er im Dashboard und lässt den Bot über IPC ausführen.
 * - **Mindestens einmal, nicht genau einmal.** Stirbt das Dashboard zwischen
 *   Hörer und Quittung, kommt dasselbe Ereignis noch einmal. Ein Hörer mit
 *   Wirkung prüft deshalb `ereignis.id` oder `ereignis.schluessel`.
 */
const liste = require('./liste.json');

const NACH_NAME = new Map(liste.ereignisse.map(e => [e.name, e]));

/** Der Absender `kern` erklärt sich in diesem Plugin. */
const KERN_PLUGIN = 'core';

/** Discord-ID: Mensch, Kanal, Rolle, Nachricht, Guild. */
const SNOWFLAKE = /^\d{17,20}$/;

/** `*` passt auf alles, `ticket.*` auf alle Namen, die mit `ticket.` beginnen. */
function passt(muster, name) {
    if (muster === '*') return true;
    if (muster.endsWith('.*')) return name.startsWith(muster.slice(0, -1));
    return muster === name;
}

/** Feldart ohne das `?` für „darf fehlen“. */
const feldart = (art) => String(art).replace(/\?$/, '');

/**
 * Die Schutzklasse, die aus Akteur, Betroffenem und Feldern folgt. Steht in
 * der Liste ausdrücklich, damit Logging und Löschen sie ohne Rechnen lesen;
 * der Wächter verlangt, dass beide gleich sind.
 */
function schutzAus(eintrag) {
    const arten = Object.values(eintrag.felder || {}).map(feldart);
    if (arten.includes('text')) return 'inhalt';
    if (eintrag.akteur !== 'system' || eintrag.betroffen === 'mitglied'
        || arten.some(a => a === 'mitglied' || a === 'mitglieder' || a === 'konto')) return 'personenbezogen';
    return 'allgemein';
}

/** Das Plugin, das einen Absender aus der Liste erklärt (`kern` → `core`). */
const pluginVon = (von) => (von === 'kern' ? KERN_PLUGIN : von);

/**
 * Darf dieses Plugin dieses Ereignis hören? Allgemeines jeder, alles andere
 * nur, wer in `hoerer` des Eintrags steht.
 */
function darfHoeren(plugin, eintrag) {
    return eintrag.schutz === 'allgemein' || (eintrag.hoerer || []).includes(plugin);
}

// ── Prüfen beim Melden ───────────────────────────────────────────────────────

const istText = (w) => typeof w === 'string' && w.length > 0;
const istZeit = (w) => (w instanceof Date && !isNaN(w))
    || (typeof w === 'number' && Number.isFinite(w))
    || (typeof w === 'string' && !isNaN(Date.parse(w)));

/** Je Feldart: passt der Wert? */
const FELDPRUEFUNG = {
    mitglied: (w) => typeof w === 'string' && SNOWFLAKE.test(w),
    mitglieder: (w) => Array.isArray(w) && w.every(x => typeof x === 'string' && SNOWFLAKE.test(x)),
    konto: istText,
    text: (w) => typeof w === 'string',
    name: istText,
    discord_id: (w) => typeof w === 'string' && SNOWFLAKE.test(w),
    id: (w) => (Number.isInteger(w) && w >= 0) || (typeof w === 'string' && /^\d+$/.test(w)),
    kennung: istText,
    wert: istText,
    werte: (w) => Array.isArray(w) && w.every(istText),
    zahl: (w) => typeof w === 'number' && Number.isFinite(w),
    zeit: istZeit,
    ja_nein: (w) => typeof w === 'boolean',
};

/**
 * Prüft eine Meldung gegen ihren Eintrag. Wirft mit einer Liste aller
 * Abweichungen, nicht nur der ersten.
 *
 * @param {Object} eintrag Eintrag aus der Liste
 * @param {Object} angaben Was gemeldet wird
 * @returns {Object} Die Zeile fürs Ereignisbuch (ohne `id`)
 */
function pruefeMeldung(eintrag, angaben) {
    const a = angaben || {};
    const fehler = [];
    const guildId = String(a.guild_id ?? '');
    const schluessel = typeof a.schluessel === 'string' ? a.schluessel : '';
    const akteur = a.akteur === undefined ? 'system' : String(a.akteur);
    const betroffen = a.betroffen === undefined || a.betroffen === null ? null : String(a.betroffen);
    const daten = a.daten === undefined ? {} : a.daten;

    const bekannt = ['guild_id', 'schluessel', 'akteur', 'betroffen', 'bezug', 'daten', 'zeit'];
    for (const k of Object.keys(a)) if (!bekannt.includes(k)) fehler.push(`unbekannte Angabe ${k}`);

    if (eintrag.stand !== 'aktiv') fehler.push(`steht auf ${eintrag.stand}, gemeldet wird nur, was aktiv ist`);
    if (!SNOWFLAKE.test(guildId)) fehler.push('guild_id fehlt oder ist keine Discord-ID');
    if (!schluessel || schluessel.length > 191) fehler.push('schluessel fehlt oder ist länger als 191 Zeichen');

    const akteurMensch = SNOWFLAKE.test(akteur);
    if (eintrag.akteur === 'mitglied' && !akteurMensch) fehler.push('akteur muss eine Discord-ID sein');
    if (eintrag.akteur === 'system' && akteur !== 'system') fehler.push('akteur muss `system` sein');
    if (eintrag.akteur === 'beides' && !akteurMensch && akteur !== 'system') fehler.push('akteur muss eine Discord-ID oder `system` sein');

    if (eintrag.betroffen === 'mitglied' && !SNOWFLAKE.test(betroffen || '')) fehler.push('betroffen muss eine Discord-ID sein');
    if (eintrag.betroffen !== 'mitglied' && betroffen !== null) fehler.push('betroffen ist für dieses Ereignis nicht vorgesehen');

    if (a.bezug !== undefined && a.bezug !== null && (typeof a.bezug !== 'object' || Array.isArray(a.bezug))) fehler.push('bezug muss ein Objekt sein');
    if (a.zeit !== undefined && !istZeit(a.zeit)) fehler.push('zeit ist kein Zeitpunkt');

    if (!daten || typeof daten !== 'object' || Array.isArray(daten)) {
        fehler.push('daten muss ein Objekt sein');
    } else {
        const felder = eintrag.felder || {};
        for (const k of Object.keys(daten)) if (!(k in felder)) fehler.push(`Feld ${k} steht nicht im Eintrag`);
        for (const [feld, art] of Object.entries(felder)) {
            const w = daten[feld];
            const darfFehlen = String(art).endsWith('?');
            if (w === undefined || w === null) {
                if (!darfFehlen) fehler.push(`Feld ${feld} fehlt`);
                continue;
            }
            const pruefe = FELDPRUEFUNG[feldart(art)];
            if (!pruefe || !pruefe(w)) fehler.push(`Feld ${feld} passt nicht zur Art ${feldart(art)}`);
        }
    }

    if (fehler.length) {
        const e = new Error(`Ereignis ${eintrag.name}: ${fehler.join('; ')}`);
        e.code = 'EREIGNIS_UNGUELTIG';
        e.fehler = fehler;
        throw e;
    }

    return {
        name: eintrag.name,
        version: eintrag.version,
        guild_id: guildId,
        quelle: eintrag.von,
        schluessel,
        schutz: eintrag.schutz,
        schwere: eintrag.schwere,
        akteur,
        betroffen,
        bezug: a.bezug ?? null,
        daten,
        zeit: a.zeit === undefined ? new Date() : new Date(a.zeit),
    };
}

// ── Melden ───────────────────────────────────────────────────────────────────

function dienste() {
    return require('dunebot-core').ServiceManager;
}

/**
 * Den Zusteller anstoßen. Im Dashboard direkt, im Bot über IPC. Ohne beides
 * (Skript, Test) nichts: Der Zusteller holt beim nächsten Takt nach.
 *
 * Der Anstoß wartet nicht. Scheitert er, ist das kein Fehler der Meldung: Die
 * Zeile steht, der Zusteller findet sie spätestens nach 2 s.
 */
function anstossen() {
    const sm = dienste();
    if (sm.has('ereignisZusteller')) {
        sm.get('ereignisZusteller').wecken();
        return;
    }
    if (!sm.has('ipcClient')) return;
    sm.get('ipcClient').sendToDashboard('core:EREIGNISSE_ANSTOSS', {}, 2000)
        .then((antwort) => {
            if (antwort?.success) return;
            if (sm.has('Logger')) {
                sm.get('Logger').debug(`[Ereignisse] Anstoß ans Dashboard ging nicht (${antwort?.error || 'keine Antwort'}), der Zusteller holt nach`);
            }
        });
}

/**
 * Ein Fachereignis melden.
 *
 * Wirft, wenn der Name nicht in der Liste steht, nicht aktiv ist oder die
 * Angaben nicht zum Eintrag passen. Ein falsches Ereignis still fallen zu
 * lassen wäre schlimmer als ein Fehler beim Absender.
 *
 * @param {string} name Name aus `liste.json`
 * @param {Object} angaben `{ guild_id, schluessel, akteur?, betroffen?, bezug?, daten?, zeit? }`
 * @returns {Promise<{id: number, neu: boolean}>} `neu: false`, wenn derselbe
 *   Schlüssel schon gemeldet war; `id` ist dann die vorhandene Zeile
 */
async function melde(name, angaben) {
    const eintrag = NACH_NAME.get(name);
    if (!eintrag) {
        const e = new Error(`Ereignis ${name} steht nicht in der Liste`);
        e.code = 'EREIGNIS_UNBEKANNT';
        throw e;
    }
    const z = pruefeMeldung(eintrag, angaben);

    // Ein Doppel ändert nur den Zähler `doppelt`. Damit meldet die Datenbank
    // 1 für neu und 2 für doppelt, auch mit CLIENT_FOUND_ROWS (mysql2 setzt
    // es von sich aus; `id = id` ergäbe dann in beiden Fällen 1).
    // `LAST_INSERT_ID(id)` liefert bei einem Doppel die vorhandene Zeile.
    // `INSERT IGNORE` hätte auch abgeschnittene Werte verschluckt.
    const ergebnis = await dienste().get('dbService').query(
        `INSERT INTO ereignisbuch
            (name, version, guild_id, quelle, schluessel, schutz, schwere,
             akteur, betroffen, bezug, daten, zeit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE doppelt = doppelt + 1, id = LAST_INSERT_ID(id)`,
        [z.name, z.version, z.guild_id, z.quelle, z.schluessel, z.schutz, z.schwere,
            z.akteur, z.betroffen, z.bezug === null ? null : JSON.stringify(z.bezug),
            JSON.stringify(z.daten), z.zeit]);

    const neu = ergebnis.affectedRows === 1;
    if (neu) anstossen();
    return { id: Number(ergebnis.insertId), neu };
}

// ── Hören ────────────────────────────────────────────────────────────────────

/** plugin → Map(muster → handler). Gilt nur im Dashboard-Prozess. */
const HOERER = new Map();

/**
 * Ein Plugin hört ein Ereignis oder ein Muster (`ticket.*`, `*`).
 *
 * Dasselbe Muster noch einmal ersetzt den Hörer (ein Plugin wird neu geladen).
 * Zwei Muster eines Plugins, die dasselbe Ereignis treffen, sind ein Fehler:
 * Je Ereignis und Plugin gibt es eine Quittung und also einen Hörer.
 *
 * Personenbezogenes und Inhalte bekommt der Hörer nur, wenn er in `hoerer`
 * des Eintrags steht. Ein `*` bringt ihm also nur Allgemeines und das, wofür
 * er freigegeben ist.
 *
 * @param {string} muster Name oder Muster
 * @param {string} plugin Das hörende Plugin
 * @param {(ereignis: Object) => Promise<void>} handler Wirft er, wird wiederholt
 * @returns {void}
 */
function hoere(muster, plugin, handler) {
    const sm = dienste();
    if (!sm.has('ipcServer')) {
        throw new Error(`hoere('${muster}', '${plugin}'): gehört wird nur im Dashboard, dort läuft der Zusteller`);
    }
    if (typeof plugin !== 'string' || !plugin) throw new Error(`hoere('${muster}'): Plugin fehlt`);
    if (typeof handler !== 'function') throw new Error(`hoere('${muster}', '${plugin}'): Handler fehlt`);
    const getroffen = liste.ereignisse.filter(e => passt(muster, e.name));
    if (!getroffen.length) throw new Error(`hoere('${muster}', '${plugin}'): trifft keinen Namen der Liste`);

    const eigene = HOERER.get(plugin) || new Map();
    for (const anderes of eigene.keys()) {
        if (anderes === muster) continue;
        const doppelt = getroffen.find(e => passt(anderes, e.name));
        if (doppelt) {
            throw new Error(`hoere('${muster}', '${plugin}'): ${doppelt.name} hört ${plugin} schon über '${anderes}'`);
        }
    }
    eigene.set(muster, handler);
    HOERER.set(plugin, eigene);
}

/**
 * Wer bekommt dieses Ereignis? Jedes Plugin mit einem passenden Hörer, das
 * es hören darf.
 *
 * @param {string} name Ereignisname
 * @returns {string[]} Plugins
 */
function abnehmerFuer(name) {
    const eintrag = NACH_NAME.get(name);
    if (!eintrag) return [];
    const aus = [];
    for (const [plugin, muster] of HOERER) {
        if (!darfHoeren(plugin, eintrag)) continue;
        if ([...muster.keys()].some(m => passt(m, name))) aus.push(plugin);
    }
    return aus;
}

/**
 * Der Hörer eines Plugins für ein Ereignis, oder `null`.
 *
 * @param {string} plugin Plugin
 * @param {string} name Ereignisname
 * @returns {Function|null} Handler
 */
function hoererFuer(plugin, name) {
    const eintrag = NACH_NAME.get(name);
    if (!eintrag || !darfHoeren(plugin, eintrag)) return null;
    for (const [m, handler] of HOERER.get(plugin) || []) if (passt(m, name)) return handler;
    return null;
}

/** Für die Anzeige unter /admin: plugin → Muster. */
function hoererListe() {
    return [...HOERER].map(([plugin, muster]) => ({ plugin, muster: [...muster.keys()] }));
}

module.exports = {
    fassung: liste.fassung,
    liste,
    KERN_PLUGIN,
    eintrag: (name) => NACH_NAME.get(name) || null,
    kennt: (name) => NACH_NAME.has(name),
    passt,
    feldart,
    schutzAus,
    pluginVon,
    darfHoeren,
    pruefeMeldung,
    melde,
    hoere,
    abnehmerFuer,
    hoererFuer,
    hoererListe,
};
