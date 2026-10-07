'use strict';

/**
 * Welche Fassung eines Spielpakets gilt — für einen Server, beim Anlegen, und
 * wer eine Fassung freigibt (Baustelle 172, 2026-10-07).
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 *
 * Bis hierhin stand an sechs Stellen dieselbe Zeile:
 *
 *     ORDER BY (v.channel = 'stable') DESC, v.published_at DESC
 *
 * „stable zuerst, sonst die neueste". Weil es keine einzige `stable`-Fassung
 * gab und niemand sie setzen konnte, hiess das in Wahrheit: IMMER die neueste.
 * Gemessen am 2026-10-06 an Server 208: Er nahm 1.0.3, 1.0.4, 1.0.5 und 1.0.6
 * von StarRupture jeweils beim nächsten Start — vier Zwischenstände der
 * Werkbank an einem Vormittag. Für einen Testserver ist das bequem; für den
 * Server einer fremden Guild ist jede Veröffentlichung ein Eingriff, von dem
 * dort niemand weiss.
 *
 * ── Die Regel (Betreiber, 2026-10-07) ───────────────────────────────────────
 *
 *   Server    Jeder Server folgt einem Kanal (`gameservers.channel`, E-2):
 *               stable  die neueste FREIGEGEBENE Fassung
 *               test    die neueste Fassung überhaupt
 *             Kein stiller Rückfall: Ein Server auf `stable`, dessen Paket
 *             keine freigegebene Fassung hat, bekommt KEINE — und der Start
 *             sagt das. Ein „stable", das heimlich eine Testfassung startet,
 *             wäre genau die Auskunft, die diese Regel abschaffen soll.
 *
 *   Freigabe  Nur eine Fassung mit grünem Prüfdurchlauf (`test_passed_at`)
 *             wird `stable` (E-17: Prüfdurchlauf UND Freigabe). Rücknahme geht.
 *
 *   Anlegen   Andere Guilds sehen nur Pakete mit einer freigegebenen Fassung.
 *             Ein Paket ohne ist ein Entwurf und erscheint nur in der Guild des
 *             Betreibers (`CONTROL_GUILD_ID`) — dort entsteht der Server dann
 *             auf dem Kanal `test`. „Keine privaten Pakete, aber Entwürfe
 *             bleiben verborgen" (Entscheidung vom 2026-08-18).
 *
 * ── Eine Stelle ─────────────────────────────────────────────────────────────
 *
 * Die Unterabfragen stehen NUR hier. Wer eine Paketfassung braucht, nimmt eine
 * der Funktionen unten oder bindet `FASSUNG_FUER_SERVER` ein — eine siebte
 * Kopie der Regel wäre die erste, die beim nächsten Umbau vergessen wird
 * (`scripts/check-freigabe.js` zählt nach).
 */

const KANAELE = ['stable', 'test'];

/** Die Guild des Betreibers — nur dort gibt es Entwürfe und den Kanal `test`. */
function istKontrollGuild(guildId) {
    const k = process.env.CONTROL_GUILD_ID;
    return Boolean(k) && guildId !== undefined && guildId !== null && String(guildId) === String(k);
}

/**
 * Die Fassung, mit der EIN Server läuft — als Unterabfrage, die eine
 * `package_versions.id` liefert. Erwartet im äusseren FROM die Namen `gs`
 * (gameservers) und `pk` (packages).
 */
const FASSUNG_FUER_SERVER = `(
            SELECT v.id FROM package_versions v
             WHERE v.package_id = pk.id
               AND (gs.channel = 'test' OR v.channel = 'stable')
             ORDER BY v.published_at DESC, v.id DESC
             LIMIT 1)`;

/**
 * Die Fassung, mit der ein NEUER Server angelegt wird: die neueste
 * freigegebene; gibt es keine, die neueste überhaupt — aber nur, wenn der
 * eine Platzhalter (`?`, 1 oder 0) sagt, dass Entwürfe erlaubt sind.
 * Erwartet `pk` im äusseren FROM.
 */
const FASSUNG_FUER_ANLEGEN = `COALESCE(
            (SELECT v.id FROM package_versions v
              WHERE v.package_id = pk.id AND v.channel = 'stable'
              ORDER BY v.published_at DESC, v.id DESC LIMIT 1),
            IF(?, (SELECT v.id FROM package_versions v
                    WHERE v.package_id = pk.id
                    ORDER BY v.published_at DESC, v.id DESC LIMIT 1), NULL))`;

/**
 * Das Paket eines bestehenden Servers — die Fassung seines Kanals.
 *
 * @param {object} dbService
 * @param {number|string} serverId
 * @returns {Promise<object|null>} { kanal, paket_slug, paket_version, paket_channel, paket_checksum, paket_json }
 *          oder null, wenn der Server kein Paket oder sein Kanal keine Fassung hat
 */
async function ladePaketFuerServer(dbService, serverId) {
    if (!serverId) return null;
    const [row] = await dbService.query(`
        SELECT gs.channel AS kanal, pk.slug AS paket_slug,
               pv.fbpkg AS paket_json, pv.version AS paket_version,
               pv.channel AS paket_channel, pv.checksum AS paket_checksum
        FROM gameservers gs
        JOIN packages pk ON pk.id = gs.addon_marketplace_id
        LEFT JOIN package_versions pv ON pv.id = ${FASSUNG_FUER_SERVER}
        WHERE gs.id = ?
    `, [serverId]);
    if (!row || !row.paket_json) return null;
    return row;
}

/**
 * Das Paket für einen Server, der gerade ANGELEGT wird.
 *
 * `kanal` im Ergebnis ist der Kanal, den der neue Server bekommt: `stable`,
 * wenn es eine freigegebene Fassung gibt — sonst `test`, und das nur in der
 * Guild des Betreibers. Für jede andere Guild gibt es ohne Freigabe kein Paket.
 *
 * @param {object} dbService
 * @param {number|string} addonId   addon_marketplace.id (= packages.id)
 * @param {string|number|null} guildId
 * @returns {Promise<object|null>}
 */
async function ladePaketFuerAnlegen(dbService, addonId, guildId) {
    if (!addonId) return null;
    const [row] = await dbService.query(`
        SELECT pk.slug AS paket_slug,
               pv.fbpkg AS paket_json, pv.version AS paket_version,
               pv.channel AS paket_channel, pv.checksum AS paket_checksum
        FROM packages pk
        LEFT JOIN package_versions pv ON pv.id = ${FASSUNG_FUER_ANLEGEN}
        WHERE pk.id = ?
    `, [istKontrollGuild(guildId) ? 1 : 0, addonId]);
    if (!row || !row.paket_json) return null;
    row.kanal = row.paket_channel === 'stable' ? 'stable' : 'test';
    return row;
}

/**
 * Die Pakete zu einer Liste von Servern — je Server die Fassung SEINES Kanals.
 *
 * Bis zum 2026-10-07 nach Addon-Kennung geordnet: ein Paket je Spiel. Seit ein
 * Server einem Kanal folgt, können zwei Server desselben Spiels verschiedene
 * Fassungen haben — also nach Server-Kennung.
 *
 * @param {object} dbService
 * @param {Array<{id: number}>} servers
 * @returns {Promise<Object<number, object>>} Server-Kennung → FBPKG-Paket
 */
async function ladePaketeZuServern(dbService, servers) {
    const ids = [...new Set((servers || []).map(x => x && x.id).filter(Boolean))];
    const paketNachServer = {};
    if (!ids.length) return paketNachServer;

    const zeilen = await dbService.query(`
        SELECT gs.id, pv.fbpkg
          FROM gameservers gs
          JOIN packages pk ON pk.id = gs.addon_marketplace_id
          LEFT JOIN package_versions pv ON pv.id = ${FASSUNG_FUER_SERVER}
         WHERE gs.id IN (${ids.map(() => '?').join(',')})`, ids);

    for (const z of zeilen) {
        if (!z.fbpkg) continue;
        try {
            paketNachServer[z.id] = typeof z.fbpkg === 'string' ? JSON.parse(z.fbpkg) : z.fbpkg;
        } catch { /* ein unlesbares Paket ist kein Grund, die Liste zu verlieren */ }
    }
    return paketNachServer;
}

/**
 * Alle Pakete, aus denen diese Guild einen Server anlegen darf — je Paket die
 * Fassung, mit der er entstünde (Schritt 1 des Anlegens).
 */
async function ladePaketeFuerAnlegen(dbService, guildId) {
    return dbService.query(`
        SELECT pk.id, pk.slug, pv.fbpkg, pv.version, pv.channel
          FROM packages pk
          JOIN package_versions pv ON pv.id = ${FASSUNG_FUER_ANLEGEN}
         ORDER BY pk.slug`, [istKontrollGuild(guildId) ? 1 : 0]);
}

/**
 * Die neueste Fassung eines Pakets überhaupt — der Arbeitsstand, den auch ein
 * Server auf `test` bekommt. Für die Werkbank: ein fertiges Paket öffnen heisst,
 * an DIESEM Stand weiterzuarbeiten, nicht an einem freigegebenen von früher.
 *
 * @param {object} dbService
 * @param {{paketId?: number|string, slug?: string}} wonach
 * @returns {Promise<{paket_id, slug, version, channel, fbpkg}|null>}
 */
async function ladeNeuesteFassung(dbService, { paketId = null, slug = null } = {}) {
    if (!paketId && !slug) return null;
    const [z] = await dbService.query(`
        SELECT pk.id AS paket_id, pk.slug, v.version, v.channel, v.fbpkg
          FROM packages pk
          JOIN package_versions v ON v.package_id = pk.id
         WHERE ${paketId ? 'pk.id = ?' : 'pk.slug = ?'}
         ORDER BY v.published_at DESC, v.id DESC
         LIMIT 1`, [paketId || slug]);
    return z || null;
}

/** Alle Pakete mit ihrer neuesten Fassung — ohne das Dokument (für Auswahllisten). */
async function ladeNeuesteFassungen(dbService) {
    return dbService.query(`
        SELECT pk.id AS paket_id, pk.slug, pk.name, v.version, v.channel, v.published_at
          FROM packages pk
          JOIN package_versions v ON v.id = (
              SELECT n.id FROM package_versions n
               WHERE n.package_id = pk.id
               ORDER BY n.published_at DESC, n.id DESC LIMIT 1)
         ORDER BY pk.slug`);
}

// ── Freigabe (Adminbereich) ─────────────────────────────────────────────────

/** Alle Fassungen eines Pakets, neueste zuerst — ohne das Dokument selbst. */
async function fassungenZuPaket(dbService, paketId) {
    return dbService.query(`
        SELECT v.id, v.version, v.channel, v.published_at, v.published_by,
               v.test_passed_at, v.released_at, v.released_by
          FROM package_versions v
         WHERE v.package_id = ?
         ORDER BY v.published_at DESC, v.id DESC`, [paketId]);
}

/** Wie viele Server dieses Pakets welchem Kanal folgen. */
async function serverJeKanal(dbService, paketId) {
    const zeilen = await dbService.query(
        'SELECT channel, COUNT(*) AS n FROM gameservers WHERE addon_marketplace_id = ? GROUP BY channel', [paketId]);
    const aus = { stable: 0, test: 0 };
    for (const z of zeilen) aus[z.channel] = Number(z.n);
    return aus;
}

async function fassung(dbService, paketId, fassungId) {
    const [z] = await dbService.query(
        `SELECT id, version, channel, test_passed_at, released_at
           FROM package_versions WHERE id = ? AND package_id = ?`, [fassungId, paketId]);
    if (!z) throw new Error('Diese Fassung gehört nicht zu diesem Paket.');
    return z;
}

/**
 * Eine Fassung freigeben: `test` → `stable`.
 *
 * Nur mit grünem Prüfdurchlauf (E-17, Betreiber am 2026-10-07: „nur mit grünem
 * Prüfdurchlauf"). Pakete, die über die Kommandozeile kamen, haben keinen —
 * sie werden freigebbar, sobald sie durch die Werkbank gegangen sind.
 */
async function freigeben(dbService, { paketId, fassungId, userId }) {
    const f = await fassung(dbService, paketId, fassungId);
    if (f.channel === 'stable') throw new Error(`Fassung ${f.version} ist schon freigegeben.`);
    if (!f.test_passed_at) {
        throw new Error(`Fassung ${f.version} hat keinen grünen Prüfdurchlauf — freigegeben wird nur, was die Werkbank geprüft hat.`);
    }
    await dbService.query(
        `UPDATE package_versions SET channel = 'stable', released_at = NOW(), released_by = ?
          WHERE id = ? AND package_id = ? AND channel = 'test' AND test_passed_at IS NOT NULL`,
        [userId ? String(userId).slice(0, 20) : null, fassungId, paketId]);
    return f;
}

/**
 * Eine Freigabe zurücknehmen: `stable` → `test`.
 *
 * Server auf `stable` fallen damit auf die vorige freigegebene Fassung zurück —
 * oder haben keine mehr, wenn es die letzte war. Wie viele das trifft, sagt
 * das Ergebnis; entscheiden muss es der Mensch davor.
 */
async function zuruecknehmen(dbService, { paketId, fassungId }) {
    const f = await fassung(dbService, paketId, fassungId);
    if (f.channel !== 'stable') throw new Error(`Fassung ${f.version} ist nicht freigegeben.`);
    await dbService.query(
        `UPDATE package_versions SET channel = 'test', released_at = NULL, released_by = NULL
          WHERE id = ? AND package_id = ? AND channel = 'stable'`, [fassungId, paketId]);
    const [rest] = await dbService.query(
        `SELECT COUNT(*) AS n FROM package_versions WHERE package_id = ? AND channel = 'stable'`, [paketId]);
    return { ...f, nochFreigegeben: Number(rest?.n || 0) };
}

/**
 * Den Kanal eines Servers umstellen.
 *
 * `test` gibt es nur in der Guild des Betreibers. `stable` nur, wenn das Paket
 * eine freigegebene Fassung hat — sonst stünde der Server ohne Paket da.
 */
async function kanalSetzen(dbService, { serverId, guildId, kanal }) {
    if (!KANAELE.includes(kanal)) throw new Error(`Kanal: ${KANAELE.join(' oder ')}.`);
    const [server] = await dbService.query(
        'SELECT id, addon_marketplace_id, channel FROM gameservers WHERE id = ? AND guild_id = ?', [serverId, guildId]);
    if (!server) throw new Error('Server nicht gefunden');
    if (server.channel === kanal) return { kanal, geaendert: false };
    if (kanal === 'test' && !istKontrollGuild(guildId)) {
        throw new Error('Testfassungen gibt es nur in der Guild des Betreibers.');
    }
    if (kanal === 'stable') {
        const [z] = await dbService.query(
            `SELECT COUNT(*) AS n FROM package_versions WHERE package_id = ? AND channel = 'stable'`,
            [server.addon_marketplace_id]);
        if (!Number(z?.n)) {
            throw new Error('Für dieses Spiel ist noch keine Fassung freigegeben — auf „stable" hätte der Server kein Paket.');
        }
    }
    await dbService.query('UPDATE gameservers SET channel = ?, updated_at = NOW() WHERE id = ?', [kanal, server.id]);
    return { kanal, geaendert: true };
}

module.exports = {
    KANAELE, istKontrollGuild, FASSUNG_FUER_SERVER, FASSUNG_FUER_ANLEGEN,
    ladePaketFuerServer, ladePaketFuerAnlegen, ladePaketeZuServern, ladePaketeFuerAnlegen, ladeNeuesteFassung, ladeNeuesteFassungen,
    fassungenZuPaket, serverJeKanal, freigeben, zuruecknehmen, kanalSetzen,
};
