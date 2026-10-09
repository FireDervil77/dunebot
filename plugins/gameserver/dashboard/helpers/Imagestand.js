'use strict';

/**
 * Hängt ein Paket am neuesten Bau seines Images — oder gibt es einen neueren?
 * (Baustelle 177, 2026-10-09.)
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 *
 * Jedes Paket ist an einen Digest angeheftet; der Daemon nimmt ihn vor dem Tag.
 * Ein neu gebautes Image erreicht deshalb kein Paket von selbst — das ist
 * gewollt (am 25.09. fehlte im ersten Bau die Abfrage-Kennung a2s). Nur sah
 * bis heute niemand, WELCHE Pakete zurückliegen: `scripts/hefte-images-an.js`
 * verglich den Tag des Pakets mit sich selbst, kannte nur fünf Paketdateien
 * und meldete nach dem Monatswechsel (2026.09 → 2026.10) zu Recht „aktuell".
 *
 * Betreiber, 2026-10-09: *„müsste ich sehen können welche pakete ich auf die
 * neuen images nach einer änderung umziehen müsste"* — und: Es muss übers
 * Dashboard gehen.
 *
 * ── Was verglichen wird ─────────────────────────────────────────────────────
 *
 *   angeheftet     `image.digest` der NEUESTEN Fassung des Pakets
 *                  (Paketfassung.ladeNeuesteFassungenMitInhalt — nach
 *                  Veröffentlichung, über beide Kanäle)
 *   neuester Bau   der Digest hinter `latest` bzw. `latest-<variante>` desselben
 *                  Images. Den Tag schiebt bauen.sh bei jedem Bau mit; welcher
 *                  Stand dahinter liegt (2026.10), sagt das Etikett des Images.
 *
 * Gefragt wird ein Daemon (`image.stand`) — das Dashboard spricht mit keiner
 * Registry. Die Registry ist für alle Maschinen dieselbe, also genügt
 * irgendeine, die erreichbar ist; welche es war, steht im Ergebnis.
 *
 * ── Was diese Stelle NICHT tut ──────────────────────────────────────────────
 *
 * Sie zieht nichts um. Ein Umzug ist eine neue Paketfassung, die sich nur im
 * Image unterscheidet, und sie entsteht in der Werkbank: Paket öffnen (die
 * Sitzung nimmt den neuesten Bau), Prüfdurchlauf, veröffentlichen — neue
 * Fassung in `test`, `stable` erst über die Freigabe. Die Übersicht sagt, wo
 * das ansteht.
 */

const { ServiceManager } = require('dunebot-core');
const Paketfassung = require('./Paketfassung');
const { imageVariante, neuesterTag, imageName } = require('../../../../packages/fbpkg/lib/imagetag');

const FRIST_MS = 180000;
const STAND = { aktuell: 'aktuell', neuerBau: 'neuer_bau', unbekannt: 'unbekannt' };

function json(wert) {
    if (wert && typeof wert === 'object') return wert;
    try { return JSON.parse(wert); } catch { return null; }
}

/** Je Paket: neueste Fassung, ihr Image und der Tag, hinter dem der neueste Bau steht. */
async function paketImages(dbService) {
    const zeilen = await Paketfassung.ladeNeuesteFassungenMitInhalt(dbService);
    return zeilen.map((z) => {
        const img = json(z.fbpkg)?.image || {};
        const kalender = imageVariante(img.tag) !== null;
        return {
            paket_id: z.paket_id, slug: z.slug, name: z.name, version: z.version, kanal: z.channel,
            ref: img.ref || null, tag: img.tag || null, digest: img.digest || null,
            image: img.ref ? imageName(img) : null,
            // Ein Tag, der weder Kalenderfassung noch „latest" ist, hat keinen
            // „neuesten Bau" — das Paket wird genannt, aber nicht verglichen.
            frageTag: img.ref && img.tag && kalender ? neuesterTag(img.tag) : null,
        };
    });
}

/** Der erste erreichbare Daemon — oder null. */
async function erreichbarerDaemon(dbService) {
    const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    if (!ipm) return null;
    const maschinen = await dbService.query('SELECT id, name, daemon_id FROM rootserver WHERE daemon_id IS NOT NULL ORDER BY id');
    const m = maschinen.find(x => ipm.isDaemonOnline(x.daemon_id));
    return m ? { ipm, id: m.id, name: m.name, daemonId: m.daemon_id } : null;
}

/** Urteil für ein Paket, wenn die Antwort des Daemons da ist. */
function urteile(paket, bau) {
    if (!paket.ref) return { stand: STAND.unbekannt, grund: 'Das Paket nennt kein Image.' };
    if (!paket.frageTag) return { stand: STAND.unbekannt, grund: `Der Tag „${paket.tag}" ist keine Kalenderfassung — dazu gibt es keinen „neuesten Bau".` };
    if (!paket.digest) return { stand: STAND.unbekannt, grund: 'Das Paket ist an keinen Digest angeheftet — es folgt seinem Tag.' };
    if (!bau) return { stand: STAND.unbekannt, grund: 'Der Daemon hat zu diesem Image nichts gesagt.' };
    if (bau.fehler || !bau.digest) return { stand: STAND.unbekannt, grund: bau.fehler || 'Der Daemon nannte keinen Digest.' };
    return bau.digest === paket.digest ? { stand: STAND.aktuell, grund: null } : { stand: STAND.neuerBau, grund: null };
}

/**
 * Die Übersicht. Wirft nicht, wenn der Daemon fehlt: Dann steht bei jedem Paket
 * „unbekannt" mit dem Grund — nie „aktuell", ohne gefragt zu haben.
 *
 * @returns {Promise<{pakete: object[], gefragtBei: string|null, fehler: string|null, zaehlung: object}>}
 */
async function stand(dbService) {
    const pakete = await paketImages(dbService);
    const fragen = new Map();
    for (const p of pakete) if (p.frageTag) fragen.set(`${p.ref}:${p.frageTag}`, { ref: p.ref, tag: p.frageTag });

    let gefragtBei = null, fehler = null;
    const antworten = new Map();
    if (fragen.size) {
        const d = await erreichbarerDaemon(dbService);
        if (!d) {
            fehler = 'Kein Daemon ist erreichbar — der neueste Bau lässt sich nicht erfragen.';
        } else {
            gefragtBei = d.name;
            const antwort = await d.ipm.sendCommand(d.daemonId, 'image.stand', { images: [...fragen.values()] }, FRIST_MS)
                .catch(e => ({ success: false, error: e.message }));
            const liste = antwort?.data?.images;
            if (antwort?.success && Array.isArray(liste)) {
                for (const b of liste) antworten.set(`${b.ref}:${b.tag}`, b);
            } else if (antwort?.error === 'Gameserver nicht gefunden') {
                // Ein Daemon vor 1.0.116 kennt den Befehl nicht und hält ihn für
                // einen Gameserver-Befehl (im Verteiler nachgelesen, 2026-10-09).
                fehler = `Der Daemon von „${d.name}" kennt die Abfrage noch nicht — sie kommt mit 1.0.116.`;
            } else {
                fehler = antwort?.error || `Der Daemon von „${d.name}" hat keine Auskunft geliefert.`;
            }
        }
    }

    const zaehlung = { [STAND.aktuell]: 0, [STAND.neuerBau]: 0, [STAND.unbekannt]: 0 };
    const aus = pakete.map((p) => {
        const bau = p.frageTag ? antworten.get(`${p.ref}:${p.frageTag}`) : null;
        const u = fehler && p.frageTag && p.digest ? { stand: STAND.unbekannt, grund: fehler } : urteile(p, bau);
        zaehlung[u.stand]++;
        return {
            paket_id: p.paket_id, slug: p.slug, name: p.name, version: p.version, kanal: p.kanal,
            image: p.image, tag: p.tag, digest: p.digest,
            neuester: bau && bau.digest ? { fassung: bau.fassung || null, digest: bau.digest, hinweis: bau.hinweis || null } : null,
            stand: u.stand, grund: u.grund,
        };
    });
    return { pakete: aus, gefragtBei, fehler, zaehlung };
}

module.exports = { STAND, paketImages, urteile, stand };
