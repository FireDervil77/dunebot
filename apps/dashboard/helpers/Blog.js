'use strict';

const { ServiceManager, Spielemeldungen } = require('dunebot-core');
const { htmlZuVorschautext } = require('./text');

/**
 * Was die Webseite außerhalb der Blogseite über den Blog wissen will
 * (Betreiber, 2026-10-12):
 *
 *   - der neueste Artikel als Aufmacher im Hero der Startseite
 *   - ein „Neu" am Menüpunkt Blog, solange ein Artikel ganz neu ist
 *
 * Beides meint die EIGENEN Artikel. Die Spiele-Updates aus Discord
 * (`source = 'discord'`) zählen nicht („die Spiele-Sammlung könnte man
 * ignorieren") — bei fünf bis sechs Meldungen je Woche stünde das „Neu" sonst
 * immer da und der Aufmacher wäre jeden zweiten Tag ein Hotfix.
 */

/** So lange gilt ein Artikel als neu. */
const NEU_TAGE = 7;
/** Das Menü steht auf jeder Seite — gezählt wird höchstens einmal je Minute. */
const MERKDAUER = 60_000;

let gemerkt = { bis: 0, zahl: 0 };

const db = () => ServiceManager.get('dbService');

/**
 * Der neueste veröffentlichte eigene Artikel — oder `null`.
 *
 * @param {string} sprache
 * @returns {Promise<{slug: string, titel: string, kurztext: string, zeit: Date}|null>}
 */
async function neuester(sprache) {
    const [zeile] = await db().query(
        `SELECT slug, title_translations, excerpt_translations, content_translations, published_at
           FROM blog_posts
          WHERE status = 'published' AND source = 'own' AND published_at IS NOT NULL AND published_at <= NOW()
          ORDER BY published_at DESC, id DESC LIMIT 1`);
    if (!zeile) return null;
    const titel = Spielemeldungen.text(zeile.title_translations, sprache);
    if (!titel) return null;
    // Anriss und Inhalt kommen als HTML aus dem Editor; der Hero zeigt reinen Text.
    const kurztext = htmlZuVorschautext(Spielemeldungen.text(zeile.excerpt_translations, sprache), 180)
        || htmlZuVorschautext(Spielemeldungen.text(zeile.content_translations, sprache), 180);
    return { slug: zeile.slug, titel, kurztext, zeit: zeile.published_at };
}

/** Wie viele eigene Artikel in den letzten sieben Tagen erschienen sind. */
async function zahlNeu() {
    if (Date.now() < gemerkt.bis) return gemerkt.zahl;
    const [zeile] = await db().query(
        `SELECT COUNT(*) AS zahl FROM blog_posts
          WHERE status = 'published' AND source = 'own'
            AND published_at <= NOW() AND published_at >= NOW() - INTERVAL ${NEU_TAGE} DAY`);
    gemerkt = { bis: Date.now() + MERKDAUER, zahl: Number(zeile?.zahl || 0) };
    return gemerkt.zahl;
}

/** Für den Wächter: das Gemerkte verwerfen. */
function vergiss() {
    gemerkt = { bis: 0, zahl: 0 };
}

module.exports = { NEU_TAGE, neuester, zahlNeu, vergiss };
