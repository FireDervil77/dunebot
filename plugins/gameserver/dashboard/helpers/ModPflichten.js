'use strict';

/**
 * Was eine einzelne Mod selbst als Pflicht nennt — und ob es auf dem Server
 * liegt (K379, Rest von K226, im Plan vom 2026-10-14 Schritt 5).
 *
 * ── Die Lücke ───────────────────────────────────────────────────────────────
 *
 * `Modrinth.aufloesen` holt, was die Fassung bei Modrinth als `required`
 * führt. Was der Autor dort nicht einträgt, steht trotzdem in der Mod selbst
 * (`mods.toml`, `fabric.mod.json`) — und der Lader bricht beim Start ab, wenn
 * es fehlt. Dieselbe Lücke hat bei BMC4 das ganze Paket unbrauchbar gemacht
 * (FLIB, Temporal API, Twilight Forest; K226).
 *
 * ── Gemessen, nicht geraten ─────────────────────────────────────────────────
 *
 * Beide Seiten werden aus den Dateien selbst gelesen, mit `ModBeschreibung`:
 *
 *   was kommt    die aufgelösten Dateien, Teilstücke von cdn.modrinth.com
 *   was liegt    die Jars, die im Mod-Ordner des Servers WIRKLICH liegen,
 *                Teilstücke über den Abruf des Daemons (`/datei`, Range)
 *
 * Ein Abgleich über die Zeilen in `gameserver_content` wäre geraten: Die Kennung
 * bei Modrinth (Slug) und die in der Mod (modId) sind oft verschieden, ein
 * Modpack führt seine Mods nicht als Zeilen, und hochgeladene Jars haben gar
 * keine Herkunft.
 *
 * ── Genannt, nicht gesperrt ─────────────────────────────────────────────────
 *
 * Die Mod wird trotzdem installiert. Die Regeln sind die nachsichtigen aus
 * `ModBeschreibung` (nur die eigene Laderfamilie, keine Fassungsbereiche); ein
 * Fehlalarm darf niemandem eine Mod verweigern, die vielleicht läuft.
 *
 * ── Zwischenspeicher ────────────────────────────────────────────────────────
 *
 * Eine Datei bei Modrinth ändert sich nie (Schlüssel: ihre Adresse), eine auf
 * dem Server mit Name, Größe und Zeitstempel. Vorschau und Installieren lesen
 * dieselben Dateien kurz nacheinander — das zweite Mal kostet nichts.
 */

const ZipFern = require('./ZipFern');
const ModBeschreibung = require('./ModBeschreibung');
const PackBefund = require('./PackBefund');

/** Nur diese Lader beschreiben ihre Mods in einer Datei, die hier gelesen wird. */
const LADER = ['forge', 'neoforge', 'fabric'];
/** Das Ende eines Mod-Jars: Das Verzeichnis ist klein (wie im Pack-Befund). */
const JAR_SCHWANZ = 32 * 1024;
/** Eine Beschreibung ist ein paar hundert Byte — 5000 sind ein großer Server und Luft. */
const SPEICHER_HOECHSTENS = 5000;
/** In diesen Dateien stehen Pflichten. `mcmod.info` (Forge bis 1.12) nennt keine. */
const MIT_PFLICHTEN = ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'fabric.mod.json'];

const speicher = new Map();

function merke(schluessel, wert) {
    if (speicher.size >= SPEICHER_HOECHSTENS) speicher.delete(speicher.keys().next().value);
    speicher.set(schluessel, wert);
    return wert;
}

/** Die Beschreibung einer Datei — gelesen oder aus dem Speicher. */
async function beschreibung(schluessel, oeffne, lader) {
    const s = `${ModBeschreibung.familie(lader)}|${lader}|${schluessel}`;
    if (speicher.has(s)) return speicher.get(s);
    const b = await ModBeschreibung.beschreibe(await oeffne(), lader);
    return merke(s, {
        name: b.name,
        kennungen: b.kennungen,
        braucht: b.braucht,
        eingebettet: b.eingebettet,
        unlesbar: b.unlesbar,
        // Nur das alte Format ist „nicht prüfbar": `mcmod.info` ohne eine der
        // neuen Dateien. Ein Jar ohne jede Beschreibung (Connector: die Mod
        // steckt eingebettet darin) oder eine Bibliothek verlangt nichts.
        altesFormat: b.eintraege.some(e => e.name === 'mcmod.info')
            && !b.eintraege.some(e => MIT_PFLICHTEN.includes(e.name)),
        // null: noch nicht geöffnet. Erst gebraucht, wenn sonst etwas fehlt.
        innen: b.eingebettet.length ? null : [],
    });
}

/**
 * Prüfen, ob die Pflichten der neuen Dateien erfüllt sind.
 *
 * @param {{lader: string, pakete: Object[], bestand: Object, umgebung?: Object}} auftrag
 *        `pakete` wie aus `Modrinth.aufloesen` (`kennung`, `name`, `adresse`,
 *        `bytes`). `bestand` vom Server: `{dateien: [{name, groesse, zeit}],
 *        oeffne(datei), schluessel}` oder `{grund}`, wenn der Ordner nicht
 *        lesbar war. `umgebung`: `abruf`, `erlaubt`, `kopf` — die Wächter
 *        setzen dort Attrappen ein.
 * @returns {Promise<null|{fehlt: Object[], nichtPruefbar: string[], nichtGelesen: string[],
 *          bestand: number|null, bestandGrund: string|null}>} null: Dieser
 *          Lader beschreibt seine Mods nicht so, dass es etwas zu prüfen gäbe.
 */
async function pruefe({ lader, pakete, bestand, umgebung = {} }) {
    if (!LADER.includes(lader)) return null;
    const Modrinth = (umgebung.erlaubt && umgebung.kopf) ? null : require('./Modrinth');
    const abruf = umgebung.abruf || fetch;
    const erlaubt = umgebung.erlaubt || Modrinth.istErlaubt;
    const kopf = umgebung.kopf || Modrinth.KOPF;

    const nichtGelesen = [];
    const neu = [];
    await PackBefund.nebeneinander(pakete || [], async (p) => {
        if (!p.adresse || !erlaubt(p.adresse)) {
            nichtGelesen.push(`${p.kennung}: liegt nicht bei Modrinth`);
            return;
        }
        const oeffne = () => ZipFern.fernQuelle(p.adresse, { abruf, kopf, groesse: p.bytes, schwanz: JAR_SCHWANZ });
        try {
            neu.push({ name: p.name || p.kennung, oeffne, e: await beschreibung(`modrinth|${p.adresse}`, oeffne, lader) });
        } catch (fehler) {
            nichtGelesen.push(`${p.kennung}: ${fehler.message}`);
        }
    });

    const vorhanden = [];
    if (Array.isArray(bestand?.dateien)) {
        await PackBefund.nebeneinander(bestand.dateien, async (d) => {
            const oeffne = () => bestand.oeffne(d);
            try {
                vorhanden.push({ name: d.name, oeffne,
                    e: await beschreibung(`server|${bestand.schluessel}|${d.name}|${d.groesse}|${d.zeit}`, oeffne, lader) });
            } catch (fehler) {
                nichtGelesen.push(`${d.name} (auf dem Server): ${fehler.message}`);
            }
        });
    }

    const alle = [...neu, ...vorhanden];
    const offene = () => {
        const da = new Set(PackBefund.EINGEBAUT);
        for (const x of alle) for (const k of [...x.e.kennungen, ...(x.innen || x.e.innen || [])]) da.add(k);
        const fehlt = new Map();
        for (const x of neu) {
            for (const kennung of x.e.braucht) {
                if (da.has(kennung)) continue;
                if (!fehlt.has(kennung)) fehlt.set(kennung, []);
                fehlt.get(kennung).push(x.e.name || x.name);
            }
        }
        return fehlt;
    };

    // Erst wenn etwas fehlt, werden eingebettete Jars geöffnet (Jar-in-Jar):
    // Fabric API bringt seine Teilmodule so mit, und eine Mod, die
    // `fabric-api-base` verlangt, fände es sonst nicht.
    if (offene().size) {
        await PackBefund.nebeneinander(alle.filter(x => x.e.innen === null), async (x) => {
            try {
                const quelle = await x.oeffne();
                const eintraege = await ZipFern.verzeichnis(quelle);
                const innen = await ModBeschreibung.eingebetteteKennungen(quelle,
                    { eingebettet: x.e.eingebettet, eintraege }, lader);
                x.innen = innen.kennungen;
                // Nur Vollständiges kommt in den Speicher — sonst bliebe ein
                // Lesefehler für immer ein „fehlt".
                if (!innen.unlesbar.length) x.e.innen = innen.kennungen;
                nichtGelesen.push(...innen.unlesbar.map(t => `${x.name} → ${t}`));
            } catch (fehler) {
                nichtGelesen.push(`${x.name}: ${fehler.message}`);
            }
        });
    }

    return {
        fehlt: [...offene()]
            .map(([kennung, von]) => ({ kennung, gebraucht_von: [...new Set(von)].slice(0, 5) }))
            .sort((a, b) => a.kennung.localeCompare(b.kennung)),
        // Forge bis 1.12: Die Pflichten stehen in einer Annotation im Code. „Nichts
        // fehlt" wäre dort eine Behauptung ohne Messung.
        nichtPruefbar: neu.filter(x => x.e.altesFormat).map(x => x.e.name || x.name),
        nichtGelesen: nichtGelesen.slice(0, 20),
        bestand: Array.isArray(bestand?.dateien) ? bestand.dateien.length : null,
        bestandGrund: bestand?.grund || null,
    };
}

/**
 * Der Satz dazu, für Vorschau, Meldung nach dem Installieren und Log.
 *
 * @returns {{ton: 'warn'|'gut'|'leise', text: string}|null}
 */
function satz(e) {
    if (!e) return null;
    const ohneBestand = e.bestand === null;
    const fussnote = [
        ohneBestand ? `Den Mod-Ordner des Servers konnte ich nicht lesen (${e.bestandGrund || 'kein Grund genannt'}) — was dort schon liegt, ist nicht gezählt.` : '',
        e.nichtGelesen.length ? `${e.nichtGelesen.length} Datei(en) ließen sich nicht lesen; was sie mitbringen, ist nicht gezählt.` : '',
    ].filter(Boolean).join(' ');

    if (e.fehlt.length) {
        const GENANNT = 5;
        const namen = e.fehlt.slice(0, GENANNT)
            .map(f => `${f.kennung} (verlangt von ${f.gebraucht_von.slice(0, 2).join(', ')})`);
        const mehr = e.fehlt.length > GENANNT ? ` und ${e.fehlt.length - GENANNT} weitere` : '';
        return {
            ton: 'warn',
            text: `Die Mod nennt in ihrer eigenen Beschreibung ${e.fehlt.length === 1 ? 'eine Pflicht-Mod' : `${e.fehlt.length} Pflicht-Mods`}, `
                + `die Modrinth nicht als Abhängigkeit führt und die ${ohneBestand
                    ? (e.fehlt.length === 1 ? 'nicht mitkommt' : 'nicht mitkommen')
                    : `auf dem Server ${e.fehlt.length === 1 ? 'fehlt' : 'fehlen'}`}: `
                + `${namen.join('; ')}${mehr}. Ohne sie bricht der Lader beim Start ab — such sie hier oder lade sie hoch.`
                + (fussnote ? ` ${fussnote}` : ''),
        };
    }
    if (e.nichtPruefbar.length) {
        return {
            ton: 'leise',
            text: `Nicht prüfbar: ${e.nichtPruefbar.slice(0, 3).join(', ')} nennt seine Pflichten nicht in einer Datei `
                + '(Forge bis 1.12 schreibt sie in den Code).',
        };
    }
    return {
        ton: fussnote ? 'leise' : 'gut',
        text: `Geprüft: Was die Mod selbst als Pflicht nennt, ${ohneBestand ? 'kommt mit' : 'ist da'}.` + (fussnote ? ` ${fussnote}` : ''),
    };
}

module.exports = { pruefe, satz, LADER, JAR_SCHWANZ };
