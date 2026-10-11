'use strict';

/**
 * Die Wissensdatenbank: `kb_categories` und `kb_articles` — und die 34 Dateien
 * der alten Dokumentation ziehen hinein (Betreiber, 2026-10-08; gebaut 2026-10-11).
 *
 * ── Warum im Kern ───────────────────────────────────────────────────────────
 *
 * Eine Supportseite gehört keiner Guild. Sie ist Inhalt des Betreibers wie
 * News, Blog und Changelogs, und die liegen alle im Kern (Entscheidung E-1,
 * `docs/wissensdatenbank/STAND.md`).
 *
 * ── Die Form ────────────────────────────────────────────────────────────────
 *
 * Sprachen wie bei News: `*_translations` als JSON mit `de-DE` und `en-GB`
 * (E-2). Verknüpft wird über Zahlen. Kollation wie der Kern.
 *
 * ── Das Einspielen ──────────────────────────────────────────────────────────
 *
 * Es steht HIER, in einem Zug mit den Tabellen: Die Seite `/kb` liest ab
 * diesem Stand nur noch aus der Datenbank, und eine leere Wissensdatenbank
 * zwischen zwei Handgriffen wäre eine Lücke, die Besucher sehen.
 *
 *   - Die fünf Ordner werden Bereiche. `faq.md` kommt in einen Bereich
 *     „Allgemein", `index.md` wird dort der Artikel `startseite` — der Text
 *     der Startseite von `/kb`.
 *   - Der Titel ist die erste Überschrift der Datei (sie steht danach nicht
 *     mehr im Inhalt, die Seite zeigt den Titel selbst). Der Kurztext ist der
 *     erste Absatz.
 *   - Verweise zwischen den Dateien (`ressourcen.md`, `../plugins/x.md`)
 *     werden zu den neuen Adressen (`/kb/gameserver/ressourcen`).
 *   - Sieben Artikel beschreiben Plugins, die es nicht gibt. Sie werden
 *     ENTWURF, nicht gelöscht.
 *   - Alles andere wird veröffentlicht UND öffentlich: Es war bisher für
 *     jeden lesbar. Erst neue Artikel entstehen als „nur angemeldet".
 *
 * Gemessen am 2026-10-11: 34 Dateien, 27 veröffentlicht, 7 Entwurf.
 * `scripts/check-wissensdatenbank.js` zählt nach: 34 hinein, 34 heraus.
 *
 * `documentation/` BLEIBT liegen und wird nicht mehr gelesen. Eine Migration,
 * die ihre Quelle im selben Zug wegnimmt, macht jeden Fehler unumkehrbar; der
 * Ordner geht in einem eigenen Schritt, wenn der Betreiber die Artikel
 * gesehen hat.
 *
 * Fehlt der Ordner (neue Anlage), entstehen nur die Tabellen und der Bereich
 * „Allgemein" mit einer leeren Startseite.
 */

const fs = require('fs');
const path = require('path');

const ORDNER = path.join(__dirname, '..', '..', 'documentation');

/** Die Bereiche, die aus den Ordnern werden — Titel, Symbol (Bootstrap Icons), Reihenfolge. */
const BEREICHE = {
    'getting-started': { de: 'Erste Schritte', en: 'Getting started', symbol: 'bi-rocket-takeoff', reihe: 10,
        text: { de: 'Bot einladen, einrichten und die ersten Rechte vergeben.', en: 'Invite the bot, set it up and assign the first permissions.' } },
    'dashboard':       { de: 'Dashboard', en: 'Dashboard', symbol: 'bi-speedometer2', reihe: 20,
        text: { de: 'Das Web-Dashboard: Übersicht, Einstellungen, Plugins, Themes.', en: 'The web dashboard: overview, settings, plugins, themes.' } },
    'gameserver':      { de: 'Gameserver', en: 'Game servers', symbol: 'bi-hdd-rack', reihe: 30, plugin: 'gameserver',
        text: { de: 'Eigene Maschine anbinden, Server anlegen und betreiben.', en: 'Connect your own machine, create and run servers.' } },
    'plugins':         { de: 'Plugins', en: 'Plugins', symbol: 'bi-puzzle', reihe: 40,
        text: { de: 'Was die einzelnen Plugins können und wie man sie einstellt.', en: 'What each plugin does and how to configure it.' } },
    'bot':             { de: 'Bot', en: 'Bot', symbol: 'bi-robot', reihe: 50,
        text: { de: 'Befehle des Bots in Discord.', en: 'The bot\'s commands in Discord.' } },
    'allgemein':       { de: 'Allgemein', en: 'General', symbol: 'bi-question-circle', reihe: 60,
        text: { de: 'Häufige Fragen und alles, was sonst nirgends hingehört.', en: 'Frequently asked questions and everything else.' } },
};

/** Artikel zu Plugins, die es nicht gibt (gemessen 2026-10-08, nachgemessen 2026-10-11). */
const ENTWURF = new Set(['economy', 'leveling', 'clan-manager', 'social-alerts', 'statistik', 'voiceserver', 'image-builder']
    .map(n => 'plugins/' + n));

const RE_KUERZEL = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Die neue Adresse zu einem Pfad der alten Dokumentation (relativ zu `documentation/`). */
function neueAdresse(alterPfad) {
    const teile = String(alterPfad || '').split('/').filter(Boolean).map(t => t.replace(/\.md$/i, '').toLowerCase());
    if (teile.length && teile[teile.length - 1] === 'index') teile.pop();
    if (!teile.length || teile.some(t => !RE_KUERZEL.test(t))) return '/kb';
    if (teile.length === 1) return teile[0] === 'faq' ? '/kb/allgemein/faq' : `/kb/${teile[0]}`;
    return `/kb/${teile[0]}/${teile[1]}`;
}

/**
 * Verweise einer Datei auf andere Dateien → neue Adressen.
 * `ordner` ist der Ordner der Datei relativ zu `documentation/` ('' an der Wurzel).
 * Fremde Adressen (http, mailto), Anker und absolute Pfade bleiben, wie sie sind.
 */
function schreibeVerweiseUm(inhalt, ordner) {
    return inhalt.replace(/\]\(([^)\s]+)\)/g, (ganz, ziel) => {
        if (/^(https?:|mailto:|#|\/)/i.test(ziel)) return ganz;
        const [pfad, anker] = ziel.split('#');
        if (!pfad) return ganz;
        const aufgeloest = path.posix.normalize(path.posix.join(ordner, pfad));
        if (aufgeloest.startsWith('..')) return ganz;
        return `](${neueAdresse(aufgeloest)}${anker ? '#' + anker : ''})`;
    });
}

/** Erste Überschrift = Titel; der Rest ist der Inhalt. */
function zerlege(roh, ersatzTitel) {
    const text = String(roh).replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const m = /^#\s+(.+?)\s*$/m.exec(text);
    const titel = m ? m[1].trim() : ersatzTitel;
    const inhalt = (m ? text.slice(0, m.index) + text.slice(m.index + m[0].length) : text).trim();
    // Kurztext: der erste Absatz, der kein Aufbau ist (Überschrift, Liste, Tabelle, Zitat, Code).
    const absatz = inhalt.split(/\n\s*\n/).map(a => a.trim())
        .find(a => a && !/^(#|[-*+] |\d+\. |\||>|```)/.test(a)) || '';
    const kurz = absatz.replace(/\s+/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '').trim();
    return { titel, inhalt, kurztext: kurz.length > 240 ? kurz.slice(0, 237).replace(/\s+\S*$/, '') + ' …' : kurz };
}

/**
 * Der Bestand als Bereiche und Artikel — rein, ohne Datenbank, damit der
 * Wächter ihn nachzählen kann.
 *
 * @param {string} [ordner]
 * @returns {{ dateien: number, bereiche: object[], artikel: object[] }}
 */
function leseBestand(ordner = ORDNER) {
    if (!fs.existsSync(ordner)) return { dateien: 0, bereiche: [], artikel: [] };
    const artikel = [];
    const benutzt = new Set(['allgemein']);

    const nimm = (datei, bereich, relativ, reihe) => {
        const name = path.basename(datei, '.md').toLowerCase();
        const istStart = relativ === 'index';
        const kuerzel = istStart ? 'startseite' : name;
        if (!RE_KUERZEL.test(kuerzel)) throw new Error(`Wissensdatenbank: „${relativ}.md" ergibt kein gültiges Kürzel.`);
        const z = zerlege(fs.readFileSync(datei, 'utf8'), name);
        const entwurf = ENTWURF.has(relativ);
        artikel.push({
            quelle: relativ + '.md', bereich, kuerzel, titel: z.titel, kurztext: z.kurztext,
            inhalt: schreibeVerweiseUm(z.inhalt, path.posix.dirname(relativ) === '.' ? '' : path.posix.dirname(relativ)),
            stand: entwurf ? 'draft' : 'published', oeffentlich: entwurf ? 0 : 1, reihe,
        });
    };

    // Wurzel: index.md und faq.md → „Allgemein".
    fs.readdirSync(ordner, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name).sort()
        .forEach((name, i) => nimm(path.join(ordner, name), 'allgemein', path.basename(name, '.md'), (i + 1) * 10));

    // Ordner: je einer ein Bereich. Tiefer geschachtelt ist der Bestand nicht —
    // käme es doch vor, soll es auffallen statt still verloren zu gehen.
    for (const e of fs.readdirSync(ordner, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const bereich = e.name.toLowerCase();
        if (!RE_KUERZEL.test(bereich)) throw new Error(`Wissensdatenbank: Der Ordner „${e.name}" ergibt kein gültiges Kürzel.`);
        const drin = fs.readdirSync(path.join(ordner, e.name), { withFileTypes: true });
        const tiefer = drin.filter(x => x.isDirectory());
        if (tiefer.length) throw new Error(`Wissensdatenbank: „${e.name}/" hat Unterordner (${tiefer.map(x => x.name).join(', ')}) — das Einspielen kennt nur eine Ebene.`);
        drin.filter(x => x.isFile() && x.name.endsWith('.md')).map(x => x.name).sort()
            .forEach((name, i) => nimm(path.join(ordner, e.name, name), bereich, `${e.name}/${path.basename(name, '.md')}`, (i + 1) * 10));
        benutzt.add(bereich);
    }

    const bereiche = [...benutzt].map((kuerzel) => {
        const b = BEREICHE[kuerzel] || { de: kuerzel, en: '', symbol: 'bi-journal-text', reihe: 900, text: { de: '', en: '' } };
        return { kuerzel, titel: { de: b.de, en: b.en }, text: b.text, symbol: b.symbol, reihe: b.reihe, plugin: b.plugin || null };
    }).sort((a, b) => a.reihe - b.reihe);

    return { dateien: artikel.length, bereiche, artikel };
}

const sprachen = (de, en) => JSON.stringify(en ? { 'de-DE': de, 'en-GB': en } : { 'de-DE': de });

module.exports = {
    description: 'Wissensdatenbank: kb_categories + kb_articles, die alte Dokumentation zieht ein',

    // Für den Wächter (scripts/check-wissensdatenbank.js).
    leseBestand, neueAdresse, schreibeVerweiseUm, zerlege,

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS kb_categories (
                id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
                slug                      VARCHAR(80) NOT NULL COMMENT 'Kürzel in der Adresse: /kb/<slug>',
                title_translations        JSON NOT NULL COMMENT '{"de-DE": …, "en-GB": …} wie news',
                description_translations  JSON NULL,
                icon                      VARCHAR(60) NULL COMMENT 'Bootstrap-Icon der öffentlichen Seite, etwa bi-puzzle',
                sort_order                INT NOT NULL DEFAULT 0,
                plugin                    VARCHAR(60) NULL COMMENT 'Name des Plugins, dessen Hilfe dieser Bereich ist',
                created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_kb_categories_slug (slug)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Wissensdatenbank: Bereiche. Regeln in apps/dashboard/helpers/Wissen.js.'
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS kb_articles (
                id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
                category_id           INT UNSIGNED NOT NULL,
                slug                  VARCHAR(80) NOT NULL COMMENT 'Kürzel in der Adresse: /kb/<bereich>/<slug>',
                title_translations    JSON NOT NULL,
                excerpt_translations  JSON NULL COMMENT 'Kurztext — steht auch an Artikeln mit Schloss',
                content_translations  JSON NOT NULL COMMENT 'Markdown; gerendert wird beim Anzeigen',
                status                ENUM('draft','published') NOT NULL DEFAULT 'draft',
                is_public             TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = ohne Anmeldung lesbar; 0 = außen nur Titel und Kurztext',
                sort_order            INT NOT NULL DEFAULT 0,
                author                VARCHAR(100) NULL,
                created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_kb_articles_adresse (category_id, slug),
                KEY idx_kb_articles_liste (category_id, status, sort_order),
                CONSTRAINT fk_kb_articles_bereich FOREIGN KEY (category_id) REFERENCES kb_categories (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Wissensdatenbank: Artikel.'
        `);

        // ── Einspielen — nur in leere Tabellen ──────────────────────────────
        // **Nicht destrukturieren** — `db.query()` liefert die Zeilen direkt.
        const schonDa = await db.query('SELECT (SELECT COUNT(*) FROM kb_categories) + (SELECT COUNT(*) FROM kb_articles) AS n');
        if (Number(schonDa[0].n) > 0) return;

        const bestand = leseBestand();
        if (!bestand.bereiche.length) {
            // Neue Anlage ohne `documentation/`: Die Startseite braucht ihren Platz trotzdem.
            const b = BEREICHE.allgemein;
            bestand.bereiche.push({ kuerzel: 'allgemein', titel: { de: b.de, en: b.en }, text: b.text, symbol: b.symbol, reihe: b.reihe, plugin: null });
        }
        if (!bestand.artikel.some(a => a.bereich === 'allgemein' && a.kuerzel === 'startseite')) {
            bestand.artikel.push({ bereich: 'allgemein', kuerzel: 'startseite', titel: 'Wissensdatenbank', kurztext: '',
                inhalt: 'Hier entsteht die Wissensdatenbank.', stand: 'published', oeffentlich: 1, reihe: 0 });
        }

        // ── Alles oder nichts — in EINER Transaktion ────────────────────────
        //
        // Ein halber Bestand sähe beim nächsten Start aus wie „schon
        // eingespielt" und bliebe für immer halb. Aufgeräumt wird deshalb per
        // Rollback, nicht mit `DELETE`: Bot und Dashboard fahren die
        // Kern-Migrationen beide beim Start (bot.js, app.js). Starten sie
        // zugleich, scheitert der zweite am eindeutigen Kürzel — und ein
        // `DELETE FROM kb_articles` im Fehlerfall hätte dann gelöscht, was der
        // erste gerade eingespielt hat.
        const spieleEin = async (verbindung) => {
            const q = async (sql, p) => (await verbindung.query(sql, p))[0];
            for (const b of bestand.bereiche) {
                await q(
                    `INSERT INTO kb_categories (slug, title_translations, description_translations, icon, sort_order, plugin)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [b.kuerzel, sprachen(b.titel.de, b.titel.en), sprachen(b.text.de, b.text.en), b.symbol, b.reihe, b.plugin]);
            }
            for (const a of bestand.artikel) {
                await q(
                    `INSERT INTO kb_articles (category_id, slug, title_translations, excerpt_translations,
                            content_translations, status, is_public, sort_order, author)
                     SELECT id, ?, ?, ?, ?, ?, ?, ?, 'FireBot' FROM kb_categories WHERE slug = ?`,
                    [a.kuerzel, sprachen(a.titel), sprachen(a.kurztext), sprachen(a.inhalt), a.stand, a.oeffentlich, a.reihe, a.bereich]);
            }
            const drin = await q('SELECT COUNT(*) AS n FROM kb_articles');
            if (Number(drin[0].n) !== bestand.artikel.length) {
                throw new Error(`Wissensdatenbank: ${bestand.artikel.length} Artikel gelesen, ${drin[0].n} angekommen.`);
            }
        };
        try {
            await db.transaction(spieleEin);
        } catch (fehler) {
            // Hat der andere Prozess inzwischen eingespielt, ist die Arbeit getan.
            const jetzt = await db.query('SELECT COUNT(*) AS n FROM kb_articles');
            if (Number(jetzt[0].n) !== bestand.artikel.length) throw fehler;
        }

        // ── Menü und Fußzeile der öffentlichen Seite zeigen auf /kb ─────────
        // Die alte Adresse leitet zwar weiter, aber ein Menüpunkt soll nicht
        // dauerhaft über eine Weiterleitung führen. Nur die genauen alten Ziele.
        for (const tabelle of ['frontend_menu_items', 'frontend_footer_links']) {
            const gibtEs = await db.query(
                `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tabelle]);
            if (gibtEs.length) await db.query(`UPDATE ${tabelle} SET url = '/kb' WHERE url IN ('/docs', '/docs/')`);
        }
    },

    async down(db) {
        // `documentation/` wurde nie angefasst — der Rückweg verliert nur, was
        // nach dem Einspielen in der Verwaltung geschrieben wurde.
        for (const tabelle of ['frontend_menu_items', 'frontend_footer_links']) {
            const gibtEs = await db.query(
                `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tabelle]);
            if (gibtEs.length) await db.query(`UPDATE ${tabelle} SET url = '/docs' WHERE url = '/kb'`);
        }
        await db.query('DROP TABLE IF EXISTS kb_articles');
        await db.query('DROP TABLE IF EXISTS kb_categories');
    },
};
