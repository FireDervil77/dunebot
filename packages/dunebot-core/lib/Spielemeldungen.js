'use strict';

/**
 * Spielemeldungen — Ankündigungen der Hersteller aus einem Discord-Kanal im Blog
 * (Betreiber, 2026-10-12: „bisher schreiben wir ja nur nach Discord. Aber geil
 * wäre es, wenn alle Spiele-Updates des Channels so auch einmal in dem Blog
 * landen würden").
 *
 * Der Kanal (`📡-game-updates`) wird nicht von FireBot befüllt. Er „folgt"
 * Ankündigungskanälen fremder Server; Discord legt jede Ankündigung dort als
 * Nachricht mit dem Merkmal „gefolgt" ab. Genau diese Nachrichten werden
 * Blogbeiträge — was jemand sonst in den Kanal schreibt, nie.
 *
 * ── Eine Stelle für die Regel ───────────────────────────────────────────────
 *
 * Der Bot schreibt (er hört im Kanal mit und holt nach, was er verpasst hat),
 * das Dashboard liest und blendet aus. Beide nehmen diese Datei; deshalb liegt
 * sie im geteilten Paket und kennt weder discord.js noch Express. Die
 * Datenbank bekommt sie als Funktion `q(sql, werte)`, die Zeilen liefert.
 *
 * ── Fremder Text ────────────────────────────────────────────────────────────
 *
 * Der Blog gibt gespeichertes HTML ungefiltert aus (`blog-detail.ejs`). Für
 * Texte des Betreibers aus dem Editor ist das richtig. Eine Meldung schreibt
 * aber jemand in einem fremden Server. `zuHtml` escapt deshalb ZUERST alles
 * und setzt danach nur die Auszeichnungen, die hier stehen. Verweise gibt es
 * nur auf `http(s)://`. Kein Weg führt von einem Zeichen der Meldung zu einem
 * Tag, das nicht in dieser Datei steht.
 *
 * ── Entschieden mit dem Betreiber (2026-10-12) ──────────────────────────────
 *
 *   - voller Text, nicht nur ein Anriss; dafür an jeder Meldung die Quelle und
 *     der Verweis aufs Original, und jede lässt sich einzeln ausblenden
 *   - sichtbar von selbst, ohne Freigabe
 *   - jede Meldung ein eigener Beitrag (auch Hotfix-Zeilen); die Spalte auf der
 *     Blogseite zeigt je Spiel höchstens drei
 *   - Bestand ab dem 1. Juli 2026, „alles andere ist Schrott"
 *   - englisch, wie die Hersteller schreiben — übersetzt wird nichts
 */

/** Schlüssel in `admin_settings`: `{ "channel_id": "…", "channel_name": "…" }`. */
const SCHLUESSEL = 'spiele_updates_kanal';
/** Ältere Meldungen bleiben im Kanal liegen. */
const STICHTAG = '2026-07-01';
const RUBRIK = 'spiele-updates';
const QUELLE = 'discord';

/** Merkmale einer Discord-Nachricht (`flags`). */
const GEFOLGT = 1 << 1;        // IS_CROSSPOST — kam über „Folgen" aus einem fremden Kanal
const ORIGINAL_WEG = 1 << 3;   // SOURCE_MESSAGE_DELETED — der Hersteller hat das Original gelöscht

/** Sichtbar, vom Betreiber ausgeblendet, vom Hersteller oder aus dem Kanal gelöscht. */
const STAENDE = ['published', 'hidden', 'removed'];

const JE_SPIEL = 3;
const IN_DER_SPALTE = 12;
const JE_SEITE = 30;

// ── Text ────────────────────────────────────────────────────────────────────

function escape(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function datum(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Nimmt heraus, was nur in Discord etwas bedeutet: eigene Emojis, Erwähnungen
 * (die Kennungen gehören zum fremden Server), `@everyone`. Zeitmarken werden
 * ein Datum, `<https://…>` wird die Adresse.
 */
function bereinige(text) {
    return String(text ?? '')
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/<@[!&]?\d+>|<#\d+>|<id:\w+>/g, '')
        .replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (_, s) => datum(new Date(Number(s) * 1000)))
        .replace(/<(https?:\/\/[^\s<>]+)>/g, '$1')
        .replace(/@(everyone|here)\b/g, '')
        .replace(/(\S)[ \t]{2,}/g, '$1 ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const ADRESSE = /https?:\/\/[^\s<>"`\u0000]+/g;
/** Satzzeichen und Auszeichnung am Ende gehören nicht zur Adresse. */
const stutze = (adresse) => adresse.replace(/[.,;:!?)\]*_~|]+$/, '');

/** Auszeichnung innerhalb einer Zeile. Was herauskommt, ist fertiges HTML. */
function zeile(roh) {
    const ablage = [];
    const merke = (html) => `\u0000${ablage.push(html) - 1}\u0000`;

    // Erst herausnehmen, was nicht weiter ausgezeichnet werden darf: Code und
    // Adressen (ein `_` in einer Adresse ist keine Kursivschrift).
    let t = roh
        .replace(/`([^`\n]+)`/g, (_, code) => merke(`<code>${escape(code)}</code>`))
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)<>"]+)\)/g, (_, text, adresse) =>
            merke(`<a href="${escape(adresse)}" target="_blank" rel="noopener nofollow">${escape(text.replace(/[*_~`]/g, ''))}</a>`))
        .replace(ADRESSE, (treffer) => {
            const adresse = stutze(treffer);
            return merke(`<a href="${escape(adresse)}" target="_blank" rel="noopener nofollow">${escape(adresse)}</a>`)
                + treffer.slice(adresse.length);
        });

    t = escape(t)
        .replace(/\|\|(.+?)\|\|/g, '$1')
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<u>$1</u>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>')
        .replace(/(?<![_\w])_(?!\s)([^_\n]+?)(?<!\s)_(?![_\w])/g, '<em>$1</em>');

    return t.replace(/\u0000(\d+)\u0000/g, (_, n) => ablage[Number(n)]);
}

/**
 * Discord-Markdown zu HTML. Überschriften rücken eine Stufe ein (`#` wird
 * `<h2>`), weil die Seite den Titel schon als `<h1>` trägt.
 *
 * @param {string} text bereinigter Text der Meldung
 * @returns {string} HTML
 */
function zuHtml(text) {
    const zeilen = bereinige(text).split('\n');
    const aus = [];
    let absatz = [];
    let zitat = [];
    const listen = [];   // offene Listen, je `{ art, einzug }`

    const schliesseAbsatz = () => { if (absatz.length) { aus.push(`<p>${absatz.join('<br>')}</p>`); absatz = []; } };
    const schliesseZitat = () => { if (zitat.length) { aus.push(`<blockquote>${zitat.join('<br>')}</blockquote>`); zitat = []; } };
    const schliesseListen = (bis = 0) => { while (listen.length > bis) aus.push(`</li></${listen.pop().art}>`); };
    const schliesseAlles = () => { schliesseAbsatz(); schliesseZitat(); schliesseListen(); };

    for (let i = 0; i < zeilen.length; i++) {
        const z = zeilen[i];
        let m;

        if (/^\s*```/.test(z)) {
            schliesseAlles();
            const block = [];
            const rest = z.replace(/^\s*```/, '');
            if (rest.includes('```')) {
                block.push(rest.slice(0, rest.indexOf('```')));
            } else {
                // Ein einzelnes Wort hinter dem Zaun ist die Sprachangabe, kein Text.
                if (rest.trim() && !/^\w+$/.test(rest.trim())) block.push(rest);
                for (i++; i < zeilen.length; i++) {
                    const ende = zeilen[i].indexOf('```');
                    if (ende < 0) { block.push(zeilen[i]); continue; }
                    if (zeilen[i].slice(0, ende).trim()) block.push(zeilen[i].slice(0, ende));
                    break;
                }
            }
            aus.push(`<pre><code>${escape(block.join('\n').trim())}</code></pre>`);
            continue;
        }
        if (!z.trim()) { schliesseAlles(); continue; }

        if ((m = z.match(/^(#{1,3})\s+(.+)$/))) {
            schliesseAlles();
            const stufe = m[1].length + 1;
            aus.push(`<h${stufe}>${zeile(m[2].trim())}</h${stufe}>`);
            continue;
        }
        if ((m = z.match(/^-#\s+(.+)$/))) {
            schliesseAlles();
            aus.push(`<p><small>${zeile(m[1])}</small></p>`);
            continue;
        }
        if ((m = z.match(/^>{1,3}\s?(.*)$/))) {
            schliesseAbsatz(); schliesseListen();
            zitat.push(zeile(m[1]));
            continue;
        }
        if ((m = z.match(/^(\s*)([-*•]|\d{1,3}[.)])\s+(.+)$/))) {
            schliesseAbsatz(); schliesseZitat();
            const einzug = m[1].length;
            const art = /\d/.test(m[2]) ? 'ol' : 'ul';
            while (listen.length && einzug < listen[listen.length - 1].einzug) schliesseListen(listen.length - 1);
            const oben = listen[listen.length - 1];
            if (!oben || (einzug >= oben.einzug + 2 && listen.length < 2)) {
                // Die erste Zeile einer Liste — oder eine eingerückte unter einem Punkt.
                listen.push({ art, einzug });
                aus.push(`<${art}>`);
            } else {
                aus.push('</li>');
            }
            aus.push(`<li>${zeile(m[3])}`);
            continue;
        }

        schliesseZitat(); schliesseListen();
        absatz.push(zeile(z.trim()));
    }
    schliesseAlles();
    return aus.join('\n');
}

/** Ohne Auszeichnung, ohne Adressen, in einer Zeile. */
function klartext(text) {
    return bereinige(text)
        .replace(/```\w*/g, ' ')
        .replace(/\[([^\]\n]+)\]\((?:https?:\/\/)?[^)\s]*\)/g, '$1')
        .replace(ADRESSE, ' ')
        .replace(/^\s*(#{1,3}|-#|>{1,3}|[-*•])\s+/gm, '')
        .replace(/\*\*|__|~~|\|\||`/g, '')
        .replace(/(?<![\w*])[*_](?=\S)|(?<=\S)[*_](?![\w*])/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function kuerze(text, laenge) {
    if (text.length <= laenge) return text;
    const stueck = text.slice(0, laenge - 1);
    const leer = stueck.lastIndexOf(' ');
    return (leer > laenge / 2 ? stueck.slice(0, leer) : stueck).replace(/[\s,;:–-]+$/, '') + '…';
}

/**
 * Eine Discord-Nachricht hat keine Überschrift. Genommen wird die erste Zeile,
 * wenn sie eine Überschrift ist oder ganz fett — die fällt dann aus dem Text,
 * sonst stünde sie doppelt da. Sonst der erste Satz; der Text bleibt ganz.
 *
 * @returns {{ titel: string, rest: string }}
 */
function titelUndRest(text) {
    const sauber = bereinige(text);
    const zeilen = sauber.split('\n');
    const i = zeilen.findIndex(z => z.trim());
    if (i < 0) return { titel: '', rest: '' };
    const erste = zeilen[i].trim();
    const ueberschrift = (z) => z.match(/^#{1,3}\s+(.+)$/) || z.match(/^\*\*((?:(?!\*\*).)+)\*\*[\s:]*$/);
    const ohne = (k) => zeilen.filter((_, nr) => nr !== k).join('\n').trim();

    let m = ueberschrift(erste);
    if (m && klartext(m[1])) return { titel: kuerze(klartext(m[1]), 140), rest: ohne(i) };

    // Stehen oben nur ein, zwei kurze Zeilen („Ahoy!", „A little follow-up …"),
    // ist die Überschrift die Zeile darunter — aber nur eine lange: „**FIXES**"
    // ist eine Zwischenüberschrift, kein Titel.
    const belegt = zeilen.map((z, nr) => (z.trim() ? nr : -1)).filter(nr => nr >= 0);
    for (const j of belegt.slice(1, 3)) {
        if (zeilen[belegt[belegt.indexOf(j) - 1]].trim().length >= 60) break;
        m = ueberschrift(zeilen[j].trim());
        if (m && klartext(m[1]).length >= 25) return { titel: kuerze(klartext(m[1]), 140), rest: ohne(j) };
    }
    const ganz = klartext(erste) || klartext(sauber);
    const satz = ganz.match(/^.{15,}?[.!?](?=\s|$)/);
    return { titel: kuerze(satz ? satz[0] : ganz, 140), rest: sauber };
}

// ── Die Nachricht ───────────────────────────────────────────────────────────

/**
 * Absender einer gefolgten Meldung ist „Server #kanal", z. B.
 * „Dune: Awakening #patch-notes" oder „Windrose #│announcements".
 */
function quelle(absender) {
    const name = String(absender ?? '').replace(/\s+/g, ' ').trim();
    const m = name.match(/^(.*\S)\s+#\s*(.+)$/);
    const spiel = (m ? m[1] : name).replace(/\s+Official$/i, '').trim();
    return { name, spiel: spiel || 'Unbekannt', kanal: m ? m[2].replace(/^[^\p{L}\p{N}]+/u, '') : '' };
}

/** Eine Discord-Kennung, die zu diesem Zeitpunkt gehört — für „alles danach". */
function kennungAus(zeitpunkt) {
    return ((BigInt(new Date(zeitpunkt).getTime()) - 1420070400000n) << 22n).toString();
}

function kuerzel(spiel, titel, kennung) {
    const wort = `${spiel} ${titel}`.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
    return `${wort || 'meldung'}-${BigInt(kennung).toString(36)}`;
}

/**
 * Die Form, mit der diese Datei arbeitet — gleich, ob die Nachricht von
 * discord.js kommt oder roh aus der Schnittstelle.
 *
 * @typedef {object} Nachricht
 * @property {string} id
 * @property {string} text
 * @property {number} flags
 * @property {string} absender
 * @property {{guild?: string, kanal?: string, nachricht?: string}|null} bezug  das Original
 * @property {Date} zeit
 * @property {Array<{titel?: string, beschreibung?: string}>} einbettungen
 */

/** @returns {Nachricht} */
function ausDiscordJs(message) {
    return {
        id: String(message.id),
        text: message.content || '',
        flags: Number(message.flags?.bitfield ?? 0),
        absender: message.author?.username || '',
        bezug: message.reference
            ? { guild: message.reference.guildId, kanal: message.reference.channelId, nachricht: message.reference.messageId }
            : null,
        zeit: message.createdAt,
        einbettungen: (message.embeds || []).map(e => ({ art: e.data?.type, titel: e.title, beschreibung: e.description })),
    };
}

/** @returns {Nachricht} */
function ausRoh(m) {
    return {
        id: String(m.id),
        text: m.content || '',
        flags: Number(m.flags ?? 0),
        absender: m.author?.username || '',
        bezug: m.message_reference
            ? { guild: m.message_reference.guild_id, kanal: m.message_reference.channel_id, nachricht: m.message_reference.message_id }
            : null,
        zeit: new Date(m.timestamp),
        einbettungen: (m.embeds || []).map(e => ({ art: e.type, titel: e.title, beschreibung: e.description })),
    };
}

/**
 * Manche Hersteller schreiben die Meldung nicht als Text, sondern als
 * Einbettung. Dann — und nur dann — wird die genommen. Die Vorschaukästen, die
 * Discord zu einer Adresse im Text erzeugt, zählen nicht (`art` ist dort
 * `link`, `article`, `video` …).
 */
function textVon(n) {
    if (bereinige(n.text)) return n.text;
    const e = (n.einbettungen || []).find(x => (x.art === 'rich' || !x.art) && (x.titel || x.beschreibung));
    return e ? [e.titel ? `# ${e.titel}` : '', e.beschreibung || ''].filter(Boolean).join('\n') : '';
}

/**
 * Was aus einer Nachricht im Blog wird — oder `null`, wenn sie keine gefolgte
 * Ankündigung ist (Geplauder im Kanal, „X folgt jetzt …") oder leer.
 *
 * @param {Nachricht} n
 */
function beitrag(n) {
    if (!n || !/^\d{17,20}$/.test(String(n.id)) || !(n.flags & GEFOLGT)) return null;
    const text = textVon(n);
    const { titel, rest } = titelUndRest(text);
    if (!titel) return null;

    const q = quelle(n.absender);
    const erste = bereinige(text).match(ADRESSE);
    const original = erste ? stutze(erste[0])
        : (n.bezug?.guild && n.bezug?.kanal && n.bezug?.nachricht
            ? `https://discord.com/channels/${n.bezug.guild}/${n.bezug.kanal}/${n.bezug.nachricht}` : null);

    return {
        kennung: String(n.id),
        titel,
        inhalt: zuHtml(rest) || `<p>${escape(titel)}</p>`,
        kurztext: kuerze(klartext(rest) || titel, 220),
        kuerzel: kuerzel(q.spiel, titel, n.id),
        spiel: q.spiel.slice(0, 120),
        quellName: q.name.slice(0, 255),
        original: original && original.length <= 512 ? original : null,
        zeit: n.zeit instanceof Date && !isNaN(n.zeit) ? n.zeit : new Date(),
        originalWeg: Boolean(n.flags & ORIGINAL_WEG),
    };
}

// ── Datenbank ───────────────────────────────────────────────────────────────

const json = (wert) => { try { return typeof wert === 'string' ? JSON.parse(wert) : (wert || {}); } catch { return {}; } };

/** Die Fassung in der Sprache des Lesers; sonst Deutsch; sonst die, die es gibt. */
function text(feld, sprache) {
    const t = json(feld);
    return t[sprache] || t['de-DE'] || t['en-GB'] || Object.values(t).find(Boolean) || '';
}

/** @returns {Promise<{channel_id: string, channel_name: string}|null>} der Kanal, oder `null`: nichts einlesen */
async function kanal(q) {
    const zeilen = await q('SELECT `value` FROM admin_settings WHERE `key` = ?', [SCHLUESSEL]);
    const wert = json(zeilen[0]?.value);
    return /^\d{17,20}$/.test(String(wert.channel_id || '')) ? { channel_id: String(wert.channel_id), channel_name: String(wert.channel_name || '') } : null;
}

async function kanalSetzen(q, { channel_id, channel_name }) {
    const kennung = String(channel_id ?? '').trim();
    if (kennung && !/^\d{17,20}$/.test(kennung)) throw new Error('Das ist keine Kanal-Kennung.');
    const wert = JSON.stringify({ channel_id: kennung, channel_name: kennung ? String(channel_name ?? '').slice(0, 100) : '' });
    await q('INSERT INTO admin_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?', [SCHLUESSEL, wert, wert]);
    return kennung || null;
}

/**
 * Legt die Meldung an oder zieht eine geänderte nach.
 *
 * Der Stand wird beim Nachziehen NIE angefasst: Was der Betreiber ausgeblendet
 * hat, bleibt ausgeblendet, auch wenn der Hersteller seinen Text ändert.
 *
 * @returns {Promise<'neu'|'geaendert'|'gleich'|'entfernt'|null>} `null`: keine Meldung für den Blog
 */
async function uebernimm(q, n, kanalId) {
    const b = beitrag(n);
    if (!b) return null;

    const da = await q('SELECT id, status, title_translations, content_translations FROM blog_posts WHERE source_message_id = ?', [b.kennung]);

    if (b.originalWeg) {
        if (!da.length || da[0].status !== 'published') return null;
        await q("UPDATE blog_posts SET status = 'removed' WHERE id = ?", [da[0].id]);
        return 'entfernt';
    }

    const titel = JSON.stringify({ 'en-GB': b.titel });
    const inhalt = JSON.stringify({ 'en-GB': b.inhalt });
    const kurz = JSON.stringify({ 'en-GB': b.kurztext });

    if (!da.length) {
        try {
            await q(
                `INSERT INTO blog_posts (title_translations, content_translations, excerpt_translations, slug, author,
                                         category, tags, status, published_at,
                                         source, source_message_id, source_channel_id, source_name, source_url, game)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?)`,
                [titel, inhalt, kurz, b.kuerzel, b.spiel, RUBRIK, b.spiel, b.zeit,
                 QUELLE, b.kennung, String(kanalId || ''), b.quellName, b.original, b.spiel]);
        } catch (fehler) {
            // Nachholen und Mithören können dieselbe Meldung gleichzeitig bringen.
            if (fehler?.code === 'ER_DUP_ENTRY') return 'gleich';
            throw fehler;
        }
        return 'neu';
    }

    if (text(da[0].title_translations, 'en-GB') === b.titel && text(da[0].content_translations, 'en-GB') === b.inhalt) return 'gleich';
    await q('UPDATE blog_posts SET title_translations = ?, content_translations = ?, excerpt_translations = ?, source_url = ? WHERE id = ?',
        [titel, inhalt, kurz, b.original, da[0].id]);
    return 'geaendert';
}

/** Die Nachricht wurde aus dem Kanal gelöscht: Der Beitrag verschwindet von der Seite. */
async function entfernt(q, kennung) {
    const r = await q("UPDATE blog_posts SET status = 'removed' WHERE source = ? AND source_message_id = ? AND status = 'published'",
        [QUELLE, String(kennung)]);
    return Number(r?.affectedRows || 0) > 0;
}

/**
 * Ausblenden und wieder zeigen — nur für Meldungen, nie für eigene Beiträge
 * (die haben „Entwurf" und „Veröffentlicht" im Editor), und nicht für eine,
 * die der Hersteller gelöscht hat.
 */
async function sichtbar(q, id, an) {
    const r = await q('UPDATE blog_posts SET status = ? WHERE id = ? AND source = ? AND status = ?',
        [an ? 'published' : 'hidden', Number(id), QUELLE, an ? 'hidden' : 'published']);
    return Number(r?.affectedRows || 0) > 0;
}

/** Die jüngste eingelesene Meldung dieses Kanals — von dort holt der Bot nach. */
async function letzteKennung(q, kanalId) {
    // Als Text sortiert, nicht als Zahl: eine Kennung hat 19 Stellen und
    // käme als Zahl gerundet aus der Datenbank.
    const z = await q(
        `SELECT source_message_id FROM blog_posts WHERE source = ? AND source_channel_id = ?
          ORDER BY CHAR_LENGTH(source_message_id) DESC, source_message_id DESC LIMIT 1`, [QUELLE, String(kanalId)]);
    return z[0]?.source_message_id || null;
}

function fuerAnzeige(zeile, sprache) {
    return {
        id: zeile.id,
        slug: zeile.slug,
        titel: text(zeile.title_translations, sprache),
        kurztext: text(zeile.excerpt_translations, sprache),
        spiel: zeile.game || '',
        quelle: zeile.source_name || '',
        original: zeile.source_url || null,
        status: zeile.status,
        zeit: zeile.published_at,
    };
}

/**
 * Die Spalte auf der Blogseite: die neuesten Meldungen, je Spiel höchstens
 * drei — sonst füllen sieben Hotfixes desselben Spiels die ganze Spalte.
 */
async function fuerSpalte(q, sprache) {
    const zeilen = await q(
        `SELECT id, slug, title_translations, excerpt_translations, game, source_name, source_url, status, published_at
           FROM blog_posts WHERE source = ? AND status = 'published'
          ORDER BY published_at DESC, id DESC LIMIT 200`, [QUELLE]);
    const jeSpiel = new Map();
    const aus = [];
    for (const z of zeilen) {
        const zahl = jeSpiel.get(z.game) || 0;
        if (zahl >= JE_SPIEL) continue;
        jeSpiel.set(z.game, zahl + 1);
        aus.push(fuerAnzeige(z, sprache));
        if (aus.length >= IN_DER_SPALTE) break;
    }
    return aus;
}

/** Die Spiele, zu denen es sichtbare Meldungen gibt, mit ihrer Zahl. */
async function spiele(q) {
    const zeilen = await q(
        `SELECT game AS spiel, COUNT(*) AS zahl FROM blog_posts
          WHERE source = ? AND status = 'published' AND game IS NOT NULL GROUP BY game ORDER BY game`, [QUELLE]);
    return zeilen.map(z => ({ spiel: z.spiel, zahl: Number(z.zahl) }));
}

/** Die ganze Rubrik, seitenweise, auf Wunsch nur ein Spiel. */
async function liste(q, { spiel = null, seite = 1, sprache = 'de-DE' } = {}) {
    const nr = Math.max(1, Math.floor(Number(seite)) || 1);
    const wo = "source = ? AND status = 'published'" + (spiel ? ' AND game = ?' : '');
    const werte = spiel ? [QUELLE, String(spiel)] : [QUELLE];
    const [{ zahl }] = await q(`SELECT COUNT(*) AS zahl FROM blog_posts WHERE ${wo}`, werte);
    const zeilen = await q(
        `SELECT id, slug, title_translations, excerpt_translations, game, source_name, source_url, status, published_at
           FROM blog_posts WHERE ${wo} ORDER BY published_at DESC, id DESC LIMIT ${JE_SEITE} OFFSET ${(nr - 1) * JE_SEITE}`, werte);
    return { eintraege: zeilen.map(z => fuerAnzeige(z, sprache)), zahl: Number(zahl), seite: nr, seiten: Math.max(1, Math.ceil(Number(zahl) / JE_SEITE)) };
}

/** Für die Verwaltung: auch Ausgeblendetes und Entferntes. */
async function fuerVerwaltung(q, sprache, hoechstens = 100) {
    const zeilen = await q(
        `SELECT id, slug, title_translations, excerpt_translations, game, source_name, source_url, status, published_at
           FROM blog_posts WHERE source = ? ORDER BY published_at DESC, id DESC LIMIT ${Math.floor(Number(hoechstens)) || 100}`, [QUELLE]);
    const [{ zahl }] = await q('SELECT COUNT(*) AS zahl FROM blog_posts WHERE source = ?', [QUELLE]);
    return { eintraege: zeilen.map(z => fuerAnzeige(z, sprache)), zahl: Number(zahl) };
}

module.exports = {
    SCHLUESSEL, STICHTAG, RUBRIK, QUELLE, GEFOLGT, ORIGINAL_WEG, STAENDE, JE_SPIEL, IN_DER_SPALTE, JE_SEITE,
    bereinige, zuHtml, klartext, titelUndRest, quelle, kennungAus, ausDiscordJs, ausRoh, beitrag,
    text, kanal, kanalSetzen, uebernimm, entfernt, sichtbar, letzteKennung,
    fuerSpalte, spiele, liste, fuerVerwaltung,
};
