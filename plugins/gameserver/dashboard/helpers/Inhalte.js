'use strict';

/**
 * Die Inhalte eines Servers — Mods und der Lader, der sie traegt (E6/B.12).
 *
 * Alles, was `gameserver_content` liest oder schreibt, steht hier. Die Routen
 * bleiben damit lesbar, und die drei Bedingungen fuer „Lader ist scharf" stehen
 * an EINER Stelle statt in jeder Abfrage neu.
 *
 * ── Was hier NICHT ist ──────────────────────────────────────────────────────
 *
 * Ein Verzeichnis der moeglichen Mods eines Spiels. Das haben Thunderstore und
 * Modrinth als API; ein handgepflegter Katalog waere in einer Woche veraltet.
 * Hier steht, was auf EINEM Server liegt.
 */

const { ServiceManager } = require('dunebot-core');
const Quellen = require('./Quellen');

/** Der Lader ist die erste Zeile, kein Sonderfall. */
const ART_LADER = 'loader';
const ART_MOD = 'mod';
// Ein ganzes Paket, als EINE Zeile (2026-09-22). Seine Mods einzeln zu fuehren
// waere eine Luege ueber die Verwaltbarkeit: Wer eine davon aktualisiert,
// zerlegt das Paket, und die naechste Fassung raeumt sie ohnehin weg.
const ART_MODPACK = 'modpack';

/**
 * Alles, was zu einem Server gehoert — auch das Entfernte.
 *
 * Entfernte Zeilen bleiben stehen (Entscheidung des Betreibers, 2026-09-08:
 * „dann ist das ganze ein lernender Prozess den man ueberblicken kann"), sie
 * gehoeren aber nicht in dieselbe Liste wie das Laufende. Deshalb getrennt
 * zurueckgegeben statt vom Aufrufer gefiltert.
 *
 * @param {number|string} serverId
 * @returns {Promise<{lader: object|null, mods: Array, entfernt: Array}>}
 */
async function fuerServer(serverId) {
    const dbService = ServiceManager.get('dbService');

    const zeilen = await dbService.query(
        `SELECT id, art, quelle, kennung, name, fassung, aktiv, reihenfolge,
                ablage, dateien, client_side, mitgebracht, braucht,
                status, fehler, installiert_am, created_at,
                -- Als Zeichenkette lesen: Ein DATE kaeme als Date-Objekt zurueck,
                -- und dessen Umweg ueber die Zeitzone macht aus dem 09.09. in der
                -- JSON-Antwort den 08.09. (siehe die Migration).
                DATE_FORMAT(veroeffentlicht, '%Y-%m-%d') AS veroeffentlicht
           FROM gameserver_content
          WHERE server_id = ?
          ORDER BY art = 'loader' DESC, reihenfolge ASC, id ASC`,
        [serverId]
    );

    const laufend = (zeilen || []).filter(z => z.status !== 'entfernt');

    return {
        lader:    laufend.find(z => z.art === ART_LADER) || null,
        modpack:  laufend.find(z => z.art === ART_MODPACK) || null,
        mods:     laufend.filter(z => z.art === ART_MOD),
        entfernt: (zeilen || []).filter(z => z.status === 'entfernt'),
    };
}

/**
 * Ist der Lader dieses Servers scharf?
 *
 * **Drei Bedingungen, nicht eine.** Ohne alle drei waere jeder Server mit
 * irgendeinem Eintrag „modifiziert" — auch einer, bei dem die Installation
 * fehlschlug oder der ihn abgeschaltet hat. Dieselbe Abfrage steht in
 * `StartPayload.js`; sie ist der Schalter, der mit dem Startbefehl mitgeht.
 *
 * @param {number|string} serverId
 * @returns {Promise<boolean>}
 */
async function laderAktiv(serverId) {
    const dbService = ServiceManager.get('dbService');
    const [zeile] = await dbService.query(
        `SELECT id FROM gameserver_content
          WHERE server_id = ? AND art = ? AND aktiv = 1 AND status = 'installiert'
          LIMIT 1`,
        [serverId, ART_LADER]
    );
    return Boolean(zeile);
}

/**
 * Eine Zeile anlegen oder wiederbeleben.
 *
 * `UNIQUE (server_id, quelle, kennung)` heisst: Derselbe Mod zweimal ist kein
 * Zustand. Wer ihn nach dem Entfernen erneut hochlaedt, bekommt **dieselbe
 * Zeile zurueck** — mit neuer Fassung und neuem Stand. Ein zweiter Eintrag
 * waere die Sorte Doppelung, die man erst bemerkt, wenn zwei Fassungen
 * desselben Mods im Ordner liegen.
 *
 * ── `mitgebracht`: einmal selbst gewaehlt, immer selbst gewaehlt ────────────
 *
 * `daten.mitgebracht` ist true (nur als Abhaengigkeit), false (selbst
 * gewaehlt) oder fehlt (keine Aussage, etwa beim Aktualisieren). Wer Jotunn
 * selbst installiert hat, dem darf es nicht verschwinden, nur weil XPortal es
 * spaeter AUCH braucht — deshalb gewinnt die 0. Eine entfernte Zeile faengt
 * neu an. Eine Altzeile (NULL) wird nur zu 0, nie zu 1: Ob sie damals gewaehlt
 * war, weiss niemand, und im Zweifel bleibt sie liegen.
 *
 * `braucht` wird mit jeder Fassung neu geschrieben — eine neue Fassung kann
 * andere Abhaengigkeiten haben.
 *
 * @param {object} daten
 * @returns {Promise<number>} Kennung der Zeile
 */
async function eintragen(daten) {
    const dbService = ServiceManager.get('dbService');

    const ergebnis = await dbService.query(
        `INSERT INTO gameserver_content
             (server_id, guild_id, art, quelle, kennung, name, fassung, veroeffentlicht,
              aktiv, reihenfolge, ablage, dateien, client_side, mitgebracht, braucht,
              status, fehler, installiert_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             -- VOR status: MySQL wertet die Zuweisungen der Reihe nach aus, und
             -- hier muss der ALTE Status gelesen werden.
             mitgebracht    = CASE
                                WHEN status = 'entfernt'          THEN VALUES(mitgebracht)
                                WHEN VALUES(mitgebracht) IS NULL  THEN mitgebracht
                                WHEN mitgebracht IS NULL          THEN IF(VALUES(mitgebracht) = 0, 0, NULL)
                                ELSE LEAST(mitgebracht, VALUES(mitgebracht))
                              END,
             braucht        = VALUES(braucht),
             name           = VALUES(name),
             fassung        = VALUES(fassung),
             veroeffentlicht = VALUES(veroeffentlicht),
             aktiv          = 1,
             ablage         = VALUES(ablage),
             dateien        = VALUES(dateien),
             client_side    = VALUES(client_side),
             status         = VALUES(status),
             fehler         = VALUES(fehler),
             installiert_am = VALUES(installiert_am)`,
        [
            daten.serverId, String(daten.guildId), daten.art, daten.quelle,
            daten.kennung, daten.name || null, daten.fassung || null,
            // Nur der Tag, und zwar so, wie die Quelle ihn nennt (ISO). Ohne
            // Umweg ueber ein Date-Objekt: Der Treiber wuerde es in die
            // Sitzungszeitzone schieben, und ein Datum kurz vor Mitternacht
            // rutschte dabei auf den Vortag.
            daten.veroeffentlicht ? String(daten.veroeffentlicht).slice(0, 10) : null,
            Number(daten.reihenfolge) || 0,
            daten.ablage || null,
            // Die genaue Liste — ohne sie muss das Entfernen raten, und bei
            // einem Mod aus mehreren Dateien heisst Raten „der ganze Ordner".
            Array.isArray(daten.dateien) && daten.dateien.length
                ? JSON.stringify(daten.dateien) : null,
            daten.clientSide ? 1 : 0,
            typeof daten.mitgebracht === 'boolean' ? (daten.mitgebracht ? 1 : 0) : null,
            // Unbekannt bleibt NULL, nicht `[]`: Eine leere Liste hiesse
            // „braucht nichts", und daneben ginge jede Abhaengigkeit mit.
            Array.isArray(daten.braucht) ? JSON.stringify(daten.braucht) : null,
            daten.status || 'geplant',
            daten.fehler || null,
            daten.status === 'installiert' ? new Date() : null,
        ]
    );

    if (ergebnis.insertId) return ergebnis.insertId;

    // Bei ON DUPLICATE KEY ist insertId 0 — die vorhandene Zeile suchen.
    const [zeile] = await dbService.query(
        'SELECT id FROM gameserver_content WHERE server_id = ? AND quelle = ? AND kennung = ?',
        [daten.serverId, daten.quelle, daten.kennung]
    );
    return zeile ? zeile.id : null;
}

/**
 * Eine Zeile auf „entfernt" setzen — sie bleibt stehen.
 *
 * Kein DELETE: Der Rueckweg auf eine vorige Fassung ist Teil von B.12, und im
 * Nachhinein sichtbar zu haben, welcher Mod wann dazukam, ist die Frage, die
 * nach einem kaputten Server als erste gestellt wird.
 *
 * @returns {Promise<object|null>} Die Zeile VOR der Aenderung — der Aufrufer
 *                                 braucht `ablage`, um die Dateien zu entfernen
 */
async function entfernen(id, serverId) {
    const dbService = ServiceManager.get('dbService');

    const [vorher] = await dbService.query(
        'SELECT * FROM gameserver_content WHERE id = ? AND server_id = ?', [id, serverId]);
    if (!vorher) return null;

    await dbService.query(
        "UPDATE gameserver_content SET status = 'entfernt', aktiv = 0 WHERE id = ?", [id]);
    return vorher;
}

/**
 * Den Lader an- oder abschalten, ohne zu entfernen (B.12).
 *
 * **Nur den Lader, und nur einen, der ueber den Start scharf wird.** Bis zum
 * 2026-10-28 gab es den Schalter an jedem Mod. Er setzte `aktiv = 0`, und das
 * las niemand: Die Dateien blieben liegen, das Spiel lud sie (gemessen an
 * Satisfactory). Ein Mod ist installiert oder entfernt. Beim Lader wirkt der
 * Schalter, wenn das Paket `loader.adds` nennt (BepInEx: ohne die Umgebung
 * kein doorstop) — siehe `laderUeberStart`. Die Route prueft das, hier steht
 * die Bedingung an der Zeile.
 *
 * Eine entfernte Zeile laesst sich nicht anschalten: Ihre Dateien liegen nicht
 * mehr da, und ein `aktiv = 1` daneben waere eine Behauptung.
 */
async function schalten(id, serverId, aktiv) {
    const dbService = ServiceManager.get('dbService');
    const ergebnis = await dbService.query(
        `UPDATE gameserver_content SET aktiv = ?
          WHERE id = ? AND server_id = ? AND art = ? AND status <> 'entfernt'`,
        [aktiv ? 1 : 0, id, serverId, ART_LADER]
    );
    return ergebnis.affectedRows > 0;
}

/**
 * Wird der Lader ueber den START scharf — oder schon dadurch, dass er daliegt?
 *
 * BepInEx braucht Umgebung und Argumente (doorstop); das Paket nennt sie in
 * `loader.adds`, der Daemon setzt sie nur bei `lader_aktiv`. Ohne `adds` gibt
 * es nichts, was der Start hinzufuegen koennte: SML liegt in
 * `FactoryGame/Mods/SML` und wird geladen, solange es dort liegt. Fuer einen
 * solchen Lader ist „abschalten" wirkungslos und „entfernen" heisst loeschen.
 */
function laderUeberStart(inhalt) {
    return Boolean(inhalt?.loader?.adds);
}

/**
 * Was nur als Abhaengigkeit kam und jetzt niemand mehr braucht.
 *
 * Gerechnet von dem, was SELBST GEWAEHLT ist (oder unbekannt), entlang
 * `braucht`. Was dabei nicht erreicht wird und `mitgebracht = 1` traegt, ist
 * verwaist — auch eine Kette (PowerChecker → MarcioCommonLibs → SML).
 *
 * ── Im Zweifel bleibt alles liegen ──────────────────────────────────────────
 *
 * Erreicht die Rechnung eine Zeile, deren `braucht` unbekannt ist
 * (Hochgeladenes, Modpack, Altzeile), koennte die JEDE Abhaengigkeit brauchen.
 * Dann geht nichts mit, und `unbekannt` nennt, an wem es hing. Ein geloeschter
 * Mod, den noch jemand braucht, ist ein Server, der nicht startet; ein
 * liegengebliebener nur einer, der aufgeraeumt werden will.
 *
 * Der Lader geht zusaetzlich nur, wenn KEIN Mod und kein Modpack mehr da ist.
 * Nicht jeder Mod nennt ihn als Abhaengigkeit, und ohne ihn laedt keiner.
 *
 * `ohneId` rechnet so, als waere diese Zeile schon entfernt — fuer die
 * Rueckfrage, die VOR dem Entfernen nennt, was mitgeht (2026-10-28). Dieselbe
 * Rechnung wie danach, damit die Vorschau nie etwas anderes verspricht.
 *
 * @param {{lader: object|null, modpack: object|null, mods: object[]}} liste  aus `fuerServer`
 * @param {number|string|null} [ohneId]
 * @returns {{waisen: object[], unbekannt: object[]}}
 */
function waisenVon(liste, ohneId = null) {
    const laufend = [liste.lader, liste.modpack, ...liste.mods].filter(Boolean)
        .filter(z => ohneId === null || String(z.id) !== String(ohneId));
    const schluessel = z => `${z.quelle}|${z.kennung}`;
    const nach = new Map(laufend.map(z => [schluessel(z), z]));

    const erreicht = new Set();
    const unbekannt = [];
    const offen = laufend.filter(z => z.mitgebracht !== 1);
    while (offen.length) {
        const z = offen.pop();
        if (erreicht.has(schluessel(z))) continue;
        erreicht.add(schluessel(z));
        const braucht = brauchtAus(z);
        if (braucht === null) { unbekannt.push(z); continue; }
        for (const k of braucht) {
            const ziel = nach.get(`${z.quelle}|${k}`);
            if (ziel) offen.push(ziel);
        }
    }

    // Leere Rechnung, wenn eine Spur abreisst — siehe oben.
    if (unbekannt.length) return { waisen: [], unbekannt };

    const verwaist = laufend.filter(z => z.mitgebracht === 1 && !erreicht.has(schluessel(z)));
    const nochMods = laufend.some(z => z.art !== ART_LADER && !verwaist.includes(z));
    const waisen = verwaist.filter(z => !(z.art === ART_LADER && nochMods));
    return { waisen, unbekannt };
}

/** `braucht` einer Zeile — oder null, wenn unbekannt. */
function brauchtAus(zeile) {
    if (!zeile || zeile.braucht === null || zeile.braucht === undefined) return null;
    try {
        const liste = typeof zeile.braucht === 'string' ? JSON.parse(zeile.braucht) : zeile.braucht;
        return Array.isArray(liste) ? liste.filter(k => typeof k === 'string' && k) : null;
    } catch {
        return null;
    }
}

/**
 * Die geschriebenen Dateien einer Zeile.
 *
 * Alte Zeilen (vor dem 2026-09-11) haben keine Liste — dann ist sie leer, und
 * der Aufrufer muss selbst entscheiden, ob er mit `ablage` allein etwas
 * anfangen kann. Eine erfundene Liste waere schlimmer als keine.
 *
 * @returns {string[]}
 */
function dateienAus(zeile) {
    if (!zeile || !zeile.dateien) return [];
    try {
        const liste = typeof zeile.dateien === 'string' ? JSON.parse(zeile.dateien) : zeile.dateien;
        return Array.isArray(liste) ? liste.filter(d => typeof d === 'string' && d) : [];
    } catch {
        return [];
    }
}

/**
 * Die Seite, auf der dieser Inhalt bei seiner Quelle steht.
 *
 * ── Warum das Spiel in die Adresse gehoert ──────────────────────────────────
 *
 * Thunderstore ist nach Spielen getrennt. `thunderstore.io/package/<ns>/<name>/`
 * gibt es zwar — es leitet aber auf die Gemeinschaft um, in der das Paket
 * ZUERST erschien: Fuer `ValheimModding-Jotunn` landet man damit bei
 * **riskofrain2** (gemessen am 2026-09-12, HTTP 301). Richtig ist
 * `/c/<gemeinschaft>/p/<namensraum>/<name>/`, und die Gemeinschaft weiss nur
 * das Paket (`content.source_ids.thunderstore`).
 *
 * Deshalb steht die Adresse hier und nicht in der Ansicht: Die Ansicht kennt
 * das Spielpaket nicht.
 *
 * ── Wie die Adresse entsteht, weiss der Anbieter ────────────────────────────
 *
 * Seit dem 2026-09-14 baut sie nicht mehr diese Funktion, sondern der Anbieter
 * (`Quellen.fuer(zeile.quelle).adresse(raum, kennung)`). Hier bleibt nur die
 * Zuordnung: welche Zeile zu welchem Raum gehoert. Eine hochgeladene Datei hat
 * keine Seite und bekommt deshalb `null` — das ist eine Auskunft, kein Fehler.
 *
 * @param {object} zeile   Zeile aus gameserver_content
 * @param {object|string|null} raeume  Raum je Quelle (`Quellen.raeumeAus`);
 *        eine blosse Zeichenkette gilt als Raum der Quelle dieser Zeile
 * @returns {string|null}
 */
function paketAdresse(zeile, raeume) {
    if (!zeile || !zeile.quelle || !Quellen.gibtEs(zeile.quelle)) return null;

    const raum = typeof raeume === 'string' || raeume === null || raeume === undefined
        ? raeume
        : raeume[zeile.quelle];
    if (!raum) return null;

    return Quellen.fuer(zeile.quelle).adresse(raum, zeile.kennung);
}

// ── Ein Ordner je Mod (Stufe 10 S2, 2026-10-27) ─────────────────────────────
//
// Bis hierher lag jeder Mod eines Spiels in EINEM Ordner (`content.path`,
// etwa `game/BepInEx/plugins`). Satisfactory will einen je Mod: Eine `.smod`
// ist der Plugin-Ordner selbst (`SML.uplugin`, `Binaries/`, `Content/`) und
// gehört nach `FactoryGame/Mods/<mod_reference>/` — ausgepackt in den
// gemeinsamen Ordner lägen die `.uplugin` aller Mods übereinander.
//
// Das Paket sagt es mit einem Platzhalter als LETZTEM Abschnitt:
// `game/FactoryGame/Mods/{{content:key}}`. Er wird zur Kennung des Mods. Ohne
// Platzhalter bleibt alles, wie es war.

const PLATZHALTER = '{{content:key}}';
const RE_ORDNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Hat dieser Pfad einen Ordner je Mod? */
function jeMod(pfad) {
    return String(pfad || '').includes(PLATZHALTER);
}

/**
 * Der Ablageort für EINEN Inhalt — mit seiner Kennung statt des Platzhalters.
 *
 * Die Kennung wird ein Ordnername auf dem Server; sie kommt vom Anbieter oder
 * aus einem Formular. Deshalb streng: ein Abschnitt, Buchstaben, Ziffern,
 * `.`, `_`, `-`, kein `..`. Eine andere wirft — geraten wird kein Ordner.
 */
function ablageFuer(pfad, kennung) {
    const p = String(pfad || '');
    if (!jeMod(p)) return p;
    const k = String(kennung || '');
    if (!RE_ORDNER.test(k) || k.includes('..')) {
        throw new Error(`„${k}" taugt nicht als Ordnername für einen Mod (Buchstaben, Ziffern, „.", „_", „-").`);
    }
    return p.split(PLATZHALTER).join(k);
}

/** Für die Anzeige: `game/FactoryGame/Mods/<Mod>` statt des Platzhalters. */
function pfadAnzeige(pfad) {
    return pfad ? String(pfad).split(PLATZHALTER).join('<Mod>') : pfad;
}

module.exports = {
    fuerServer, laderAktiv, eintragen, entfernen, schalten, dateienAus, paketAdresse,
    laderUeberStart, waisenVon, brauchtAus,
    ART_LADER, ART_MOD, ART_MODPACK,
    PLATZHALTER, jeMod, ablageFuer, pfadAnzeige,
};
