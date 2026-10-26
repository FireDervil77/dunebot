#!/usr/bin/env node
/**
 * Spielemeldungen — vom Discord-Kanal bis zur Spalte auf der Blogseite.
 *
 * ── Was hier gehalten wird (2026-10-12) ─────────────────────────────────────
 *
 * Der Bot liest die Ankündigungen der Spielehersteller aus dem Kanal mit den
 * Spiele-Updates und legt je Meldung einen Blogbeitrag an (Regel:
 * `packages/dunebot-core/lib/Spielemeldungen.js`). Still schiefgehen kann das
 * an fünf Stellen:
 *
 *   Fremder Text  der Blog gibt gespeichertes HTML ungefiltert aus — ein Tag
 *                 oder ein Skript-Verweis aus einer Meldung stünde auf der Seite
 *   Auswahl       Geplauder aus dem Kanal landet im Blog; oder eine Meldung fehlt
 *   Wiedererkennen eine Meldung steht doppelt da; eine ausgeblendete kommt mit
 *                 der nächsten Änderung des Herstellers zurück
 *   Nachholen     nach einer Pause des Bots fehlt, was dazwischen einging
 *   Trennung      die Meldungen begraben die eigenen Artikel; oder ein eigener
 *                 Artikel lässt sich „ausblenden" wie eine Meldung
 *   Bilder        etwas, das kein Bild ist, liegt unter unserer Domain; ein Bild
 *                 wird bei jeder Änderung neu geladen; ein kaputtes kostet die Meldung
 *
 * Datenbank: Alles läuft an TEMPORÄREN Kopien von `blog_posts`,
 * `admin_settings` und `guild_media`; Bilder landen in einem Wegwerf-Ordner. Die Verbindung verweigert jedes Schreiben und jedes
 * `ALTER` an einer Tabelle, die keine Kopie ist; am Ende wird nachgezählt.
 * Abgefragt wird mit `execute` — wie der Datenbankdienst im Betrieb.
 *
 *   node scripts/check-spielemeldungen.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager, Spielemeldungen: S } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const ejs = require('ejs');

const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const migration = require(path.join(WURZEL, 'migrations/kern/20261012_180000_blog_spielemeldungen.js'));
const ANSICHTEN = path.join(WURZEL, 'apps/dashboard/themes/default/views');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, process.env.FB_LANG ? 30 : 3).join('\n      ')}`); }
}

const ERLAUBT = ['p', 'br', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'u', 's', 'a', 'code', 'pre', 'blockquote', 'small', 'img'];
/** Jedes Tag im Ergebnis steht auf der Liste; ein `<a>` trägt genau href, target, rel — und zeigt auf http(s). */
function nurErlaubtes(html) {
    for (const t of html.matchAll(/<\/?([a-zA-Z0-9!?-]*)([^>]*)>/g)) {
        assert.ok(ERLAUBT.includes(t[1]), `fremdes Tag <${t[1]}> in: ${html.slice(0, 120)}`);
        if (t[1] === 'a' && !t[0].startsWith('</')) {
            assert.match(t[2], /^ href="https?:\/\/[^"]*" target="_blank" rel="noopener nofollow"$/, `ein Verweis mit fremden Angaben: ${t[0]}`);
        } else if (t[1] === 'img') {
            assert.match(t[2], /^ src="\/uploads\/media\/\d{17,20}\/meldung-\d{17,20}-\d{17,20}\.(jpg|png|gif|webp)" alt="[^"<>]*" loading="lazy"$/, `ein Bild, das nicht aus unserer Ablage kommt: ${t[0]}`);
        } else {
            assert.strictEqual(t[2], '', `ein Tag mit Angaben: ${t[0]}`);
        }
    }
}

const TAG = (d) => new Date(`${d}T12:00:00Z`);
let laufend = 0;
/** Eine Nachricht, wie die Schnittstelle von Discord sie liefert. */
function roh(text, mehr = {}) {
    const zeit = mehr.zeit || TAG('2026-08-01');
    return {
        id: mehr.id || (BigInt(S.kennungAus(zeit)) + BigInt(++laufend)).toString(),
        content: text,
        flags: mehr.flags ?? S.GEFOLGT,
        author: { username: mehr.absender || 'Dune: Awakening #patch-notes' },
        message_reference: mehr.ohneBezug ? undefined : { guild_id: '1006265467754790943', channel_id: '1349723749858934834', message_id: '1558202236448935998' },
        timestamp: zeit.toISOString(),
        embeds: mehr.embeds || [],
        attachments: mehr.attachments || [],
    };
}
const n = (text, mehr) => S.ausRoh(roh(text, mehr));

(async () => {
    // ═════════════════════════════════════════════════════════════
    console.log('\nFremder Text: was aus einer Meldung auf der Seite landen kann');

    await pruefe('rohes HTML wird Text; ein Skript-Verweis bleibt Text; eine Adresse kann ihr Attribut nicht verlassen', () => {
        const boese = [
            '<script>alert(1)</script>',
            '<img src=x onerror=alert(1)>',
            '[klick](javascript:alert(1))',
            '[klick](https://a.example/"onmouseover="alert(1))',
            'https://a.example/?q="><script>alert(1)</script>',
            '**<b onclick=x>fett</b>**',
            '# <iframe src=//x>',
            '```\n</code></pre><script>x</script>\n```',
            '`</code><script>x</script>`',
            '> <svg onload=x>',
            '- <a href="javascript:x">punkt</a>',
            '[<img src=x>](https://a.example/)',
            'text\u0000' + '0\u0000 und <b>',
        ];
        for (const text of boese) {
            const html = S.zuHtml(text);
            nurErlaubtes(html);
            assert.ok(!/href="(?!https?:\/\/)/.test(html), `ein Verweis, der nicht auf http(s) zeigt: ${html}`);
            assert.ok(!/<script|onerror=|onclick=(?!x&)|<svg|<iframe|<img/i.test(html.replace(/&lt;[^&]*&gt;/g, '')), `nicht entschärft: ${html}`);
        }
        assert.strictEqual(S.zuHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
        assert.strictEqual(S.zuHtml('[klick](javascript:alert(1))'), '<p>[klick](javascript:alert(1))</p>');
        // Auch Titel und Kurztext gehen später escapt durch die Ansicht — hier kommen sie roh an.
        const b = S.beitrag(n('# <b>Titel</b>\nText <i>x</i>'));
        assert.strictEqual(b.titel, '<b>Titel</b>');
        nurErlaubtes(b.inhalt);
    });

    await pruefe('Auszeichnung: Überschrift, fett, kursiv, Liste mit Unterpunkten, Code, Zitat, Verweis', () => {
        assert.strictEqual(S.zuHtml('## Fixes'), '<h3>Fixes</h3>');
        assert.strictEqual(S.zuHtml('**fett** und *kursiv* und __unter__ und ~~weg~~'),
            '<p><strong>fett</strong> und <em>kursiv</em> und <u>unter</u> und <s>weg</s></p>');
        assert.strictEqual(S.zuHtml('Zeile eins\nZeile zwei\n\nNeuer Absatz'), '<p>Zeile eins<br>Zeile zwei</p>\n<p>Neuer Absatz</p>');
        assert.strictEqual(S.zuHtml('- eins\n- zwei\n   - drunter\n- drei').replace(/\n/g, ''),
            '<ul><li>eins</li><li>zwei<ul><li>drunter</li></ul></li><li>drei</li></ul>');
        assert.strictEqual(S.zuHtml('1. eins\n2. zwei').replace(/\n/g, ''), '<ol><li>eins</li><li>zwei</li></ol>');
        assert.strictEqual(S.zuHtml('Enable via `Launcher → Settings`'), '<p>Enable via <code>Launcher → Settings</code></p>');
        assert.strictEqual(S.zuHtml('```Kia Ora!\n\nI\'m Woulfe```'), '<pre><code>Kia Ora!\n\nI&#39;m Woulfe</code></pre>');
        assert.strictEqual(S.zuHtml('> Zitat\n> weiter'), '<blockquote>Zitat<br>weiter</blockquote>');
        assert.strictEqual(S.zuHtml('[Blog](https://a.example/x_y_z)'),
            '<p><a href="https://a.example/x_y_z" target="_blank" rel="noopener nofollow">Blog</a></p>');
        // Der Unterstrich in einer Adresse ist keine Kursivschrift, das Satzzeichen dahinter gehört nicht dazu.
        assert.strictEqual(S.zuHtml('Siehe https://a.example/a_b_c?x=1&y=2.'),
            '<p>Siehe <a href="https://a.example/a_b_c?x=1&amp;y=2" target="_blank" rel="noopener nofollow">https://a.example/a_b_c?x=1&amp;y=2</a>.</p>');
    });

    await pruefe('was nur in Discord etwas bedeutet, fällt weg: Emojis, Erwähnungen, @everyone; Zeitmarken werden ein Datum', () => {
        assert.strictEqual(S.bereinige('@everyone \n\nHallo <:Goblin_Violence:1527686356590137495> Welt <@&783369538694938625>!'), 'Hallo Welt !');
        assert.strictEqual(S.bereinige('Start <t:1790000000:R> in <#123456789012345678>'), 'Start 21 September 2026 in');
        assert.strictEqual(S.zuHtml('<https://a.example/x>'), '<p><a href="https://a.example/x" target="_blank" rel="noopener nofollow">https://a.example/x</a></p>');
        assert.ok(!/everyone/.test(S.beitrag(n('@everyone\n# Update\nText')).inhalt));
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\nAuswahl: was ein Beitrag wird, und unter welchem Titel');

    await pruefe('nur gefolgte Ankündigungen — kein Geplauder, kein „X folgt jetzt", nichts Leeres', () => {
        assert.ok(S.beitrag(n('# Update 1.5\nDa ist es.')));
        assert.strictEqual(S.beitrag(n('NRW BRENNT!!!', { flags: 0, absender: 'firedervil', ohneBezug: true })), null);
        assert.strictEqual(S.beitrag(n('Windrose #│announcements', { flags: 0, absender: 'firedervil' })), null);
        assert.strictEqual(S.beitrag(n('')), null);
        assert.strictEqual(S.beitrag(n('<:nur_emoji:1527686356590137495> @everyone')), null);
        assert.strictEqual(S.beitrag(null), null);
        assert.strictEqual(S.beitrag({ ...n('Text'), id: 'keine-kennung' }), null);
    });

    await pruefe('Titel: Überschrift oder fette Zeile (fällt aus dem Text); nach einem Gruß die Zeile darunter; sonst der erste Satz', () => {
        let b = S.beitrag(n('@everyone\n# Icarus Week 253 Update | Radiation Effects\n## Kiwi Taming Fixes\nMehr unten.'));
        assert.strictEqual(b.titel, 'Icarus Week 253 Update | Radiation Effects');
        assert.ok(!b.inhalt.includes('Week 253') && b.inhalt.startsWith('<h3>Kiwi Taming Fixes</h3>'), b.inhalt);

        b = S.beitrag(n('**Pre-Release Patch Notes (October 1, 2026)**\nUpdate 7 (Part 5)'));
        assert.deepStrictEqual([b.titel, b.inhalt], ['Pre-Release Patch Notes (October 1, 2026)', '<p>Update 7 (Part 5)</p>']);

        b = S.beitrag(n('Ahoy <@&1>\nA little follow-up for the latest news.\n\n**Why we announced a release window, not a release date.**\n\nHere is the situation.'));
        assert.strictEqual(b.titel, 'Why we announced a release window, not a release date.');
        assert.ok(b.inhalt.includes('Ahoy') && !b.inhalt.includes('Why we announced'), b.inhalt);

        // Eine Zwischenüberschrift ist kein Titel — und der Text bleibt dann ganz.
        b = S.beitrag(n('The servers are coming back online, and the patch notes for **Hotfix 1.5.3.7** are available below.\n\n**FIXES**\n- Fixed a spot.'));
        assert.strictEqual(b.titel, 'The servers are coming back online, and the patch notes for Hotfix 1.5.3.7 are available below.');
        assert.ok(b.inhalt.includes('<strong>Hotfix 1.5.3.7</strong>') && b.inhalt.includes('<strong>FIXES</strong>'));

        // Fett am Anfang UND am Ende ist keine fette Zeile.
        b = S.beitrag(n('**Neu** ist heute nur der **Patch**'));
        assert.strictEqual(b.titel, 'Neu ist heute nur der Patch');
        assert.ok(b.inhalt.includes('<strong>Neu</strong>'));

        assert.ok(S.beitrag(n('Wort '.repeat(80))).titel.length <= 140);
        assert.ok(S.beitrag(n('# Titel\n' + 'Wort '.repeat(200))).kurztext.length <= 220);
    });

    await pruefe('Quelle: Spiel und Kanal aus dem Absender; Original ist die erste Adresse, sonst die Nachricht beim Hersteller', () => {
        assert.deepStrictEqual(S.quelle('Dune: Awakening #patch-notes'), { name: 'Dune: Awakening #patch-notes', spiel: 'Dune: Awakening', kanal: 'patch-notes' });
        assert.deepStrictEqual(S.quelle('Windrose #│announcements'), { name: 'Windrose #│announcements', spiel: 'Windrose', kanal: 'announcements' });
        assert.strictEqual(S.quelle('ICARUS Official #announcements').spiel, 'ICARUS');
        assert.strictEqual(S.quelle('Space|Craft #announcements').spiel, 'Space|Craft');
        assert.strictEqual(S.quelle('Ohne Raute').spiel, 'Ohne Raute');
        assert.strictEqual(S.quelle('').spiel, 'Unbekannt');

        assert.strictEqual(S.beitrag(n('# T\nNotes: https://duneawakening.com/news/x/#1537. Danke')).original, 'https://duneawakening.com/news/x/#1537');
        assert.strictEqual(S.beitrag(n('# T\nOhne Adresse')).original, 'https://discord.com/channels/1006265467754790943/1349723749858934834/1558202236448935998');
        assert.strictEqual(S.beitrag(n('# T\nOhne alles', { ohneBezug: true })).original, null);
    });

    await pruefe('eine Meldung als Einbettung zählt, der Vorschaukasten zu einer Adresse nicht; Kennung aus Zeitpunkt stimmt', () => {
        const b = S.beitrag(n('', { embeds: [{ type: 'rich', title: 'Patch 2.77', description: 'Jetzt **live**.' }] }));
        assert.deepStrictEqual([b.titel, b.inhalt], ['Patch 2.77', '<p>Jetzt <strong>live</strong>.</p>']);
        assert.strictEqual(S.beitrag(n('', { embeds: [{ type: 'link', title: 'Steam News', description: 'Vorschau' }] })), null);
        // Text geht vor: Die Einbettung ist dann nur die Vorschau dazu.
        assert.ok(!S.beitrag(n('# Echt\nText', { embeds: [{ type: 'rich', title: 'Anders', description: 'x' }] })).inhalt.includes('Anders'));

        const k = S.kennungAus(new Date('2026-07-01T00:00:00Z'));
        assert.strictEqual(new Date(Number((BigInt(k) >> 22n) + 1420070400000n)).toISOString(), '2026-07-01T00:00:00.000Z');
        // discord.js und die rohe Schnittstelle ergeben dieselbe Form.
        const r = roh('# Gleich\nText');
        const dj = { id: r.id, content: r.content, flags: { bitfield: r.flags }, author: { username: r.author.username },
            reference: { guildId: r.message_reference.guild_id, channelId: r.message_reference.channel_id, messageId: r.message_reference.message_id },
            createdAt: new Date(r.timestamp), embeds: [] };
        assert.deepStrictEqual(S.beitrag(S.ausDiscordJs(dj)), S.beitrag(S.ausRoh(r)));
    });

    const anhang = (mehr = {}) => ({ id: mehr.id || '1557193051871387759', filename: 'bild.png', size: 1593243, width: 1280, height: 720,
        content_type: 'image/png', url: 'https://cdn.discordapp.com/attachments/153236740457496577/1557193051871387759/bild.png?ex=abc&is=def&hm=123', ...mehr });

    await pruefe('Bilder: nur Rasterbilder bis 5 MB von Discords Auslieferung, höchstens vier — mit einem Namen aus den Kennungen', () => {
        const mit = (liste) => S.bildAnhaenge(n('# T\nText', { id: '1557226689023574038', attachments: liste }));
        const [b] = mit([anhang()]);
        assert.deepStrictEqual([b.name, b.typ, b.breite, b.hoehe], ['meldung-1557226689023574038-1557193051871387759.png', 'image/png', 1280, 720]);
        // Die Endung kommt aus dem Typ, nie aus dem Namen der Datei.
        assert.strictEqual(mit([anhang({ filename: 'boese.svg', content_type: 'image/jpeg' })])[0].name.slice(-4), '.jpg');
        for (const nein of [
            { content_type: 'image/svg+xml' }, { content_type: 'video/mp4' }, { content_type: 'text/html' }, { content_type: undefined },
            { size: 5 * 1024 * 1024 + 1 }, { size: 0 },
            { url: 'https://evil.example/attachments/1/2/bild.png' }, { url: 'http://cdn.discordapp.com/attachments/1/2/bild.png' },
            { url: 'https://cdn.discordapp.com.evil.example/x.png' }, { url: 'keine adresse' }, { id: '../../etc/passwd' },
        ]) assert.deepStrictEqual(mit([anhang(nein)]), [], JSON.stringify(nein));
        assert.strictEqual(mit(Array.from({ length: 7 }, (_, i) => anhang({ id: String(1557193051871387759n + BigInt(i)) }))).length, S.BILDER_JE_MELDUNG);
        assert.deepStrictEqual(S.bildAnhaenge(n('Text')), []);
    });

    await pruefe('Bilder: erkannt am Dateikopf, nicht am genannten Typ; im Beitrag nur Adressen aus unserer Ablage', () => {
        const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);
        const jpg = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(32)]);
        const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
        assert.ok(S.istBild(png, 'image/png') && S.istBild(jpg, 'image/jpeg') && S.istBild(webp, 'image/webp') && S.istBild(Buffer.from('GIF89a' + 'x'.repeat(20)), 'image/gif'));
        assert.ok(!S.istBild(png, 'image/jpeg') && !S.istBild(Buffer.from('<svg onload=alert(1)>' + ' '.repeat(20)), 'image/png'));
        assert.ok(!S.istBild(Buffer.from('<html><script>x</script></html>'), 'image/jpeg') && !S.istBild(Buffer.alloc(4), 'image/png') && !S.istBild(png, 'image/svg+xml'));
        assert.ok(!S.istBild(Buffer.concat([png, Buffer.alloc(S.BILD_HOECHSTENS)]), 'image/png'), 'zu groß');

        const gut = '/uploads/media/565123525795643393/meldung-1557226689023574038-1557193051871387759.png';
        assert.strictEqual(S.bildHtml([{ adresse: gut, alt: 'Dune: "Update" <1.5>' }]),
            `<p><img src="${gut}" alt="Dune: &quot;Update&quot; &lt;1.5&gt;" loading="lazy"></p>`);
        for (const boese of ['https://evil.example/x.png', 'javascript:alert(1)', gut + '" onerror="x', '/uploads/media/../../etc/passwd', gut.replace('.png', '.svg'), '']) {
            assert.strictEqual(S.bildHtml([{ adresse: boese, alt: 'x' }]), '', boese);
        }
        const b = S.beitrag(n('# Mit Bild\nText'), [{ adresse: gut, alt: 'x' }]);
        assert.ok(b.inhalt.startsWith('<p>Text</p>') && b.inhalt.endsWith('loading="lazy"></p>'), 'das Bild steht unter dem Text');
        nurErlaubtes(b.inhalt);
        assert.strictEqual(S.beitrag(n('# Ohne Bild\nText')).inhalt, '<p>Text</p>');
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\nDatenbank: an Kopien von blog_posts, admin_settings und guild_media');

    const zugang = {
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    };
    const c = await mysql.createConnection(zugang);
    const aussen = await mysql.createConnection(zugang);
    const echt = async () => JSON.stringify({
        beitraege: (await aussen.query('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM blog_posts'))[0][0],
        spalten: (await aussen.query('SHOW COLUMNS FROM blog_posts'))[0].map(z => z.Field).join(','),
        kanal: (await aussen.query('SELECT `value` FROM admin_settings WHERE `key` = ?', [S.SCHLUESSEL]))[0].map(z => z.value).join('|'),
        medien: (await aussen.query('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM guild_media'))[0][0],
    });
    const vorher = await echt();

    for (const tab of ['blog_posts', 'admin_settings', 'guild_media']) {
        await c.query(`CREATE TEMPORARY TABLE fb_k LIKE \`${tab}\``);
        await c.query(`CREATE TEMPORARY TABLE \`${tab}\` LIKE fb_k`);
        await c.query('DROP TEMPORARY TABLE fb_k');
    }
    const istKopie = async (tab) => /^CREATE TEMPORARY TABLE/.test((await c.query(`SHOW CREATE TABLE \`${tab}\``))[0][0]['Create Table']);

    // Nach dem Rollout trägt die echte Tabelle die neuen Spalten schon, die Kopie
    // also auch. Für die Prüfung der Migration kommen sie an der Kopie wieder weg.
    assert.ok(await istKopie('blog_posts'));
    {
        const da = new Set((await c.query('SHOW COLUMNS FROM blog_posts'))[0].map(z => z.Field));
        const schluessel = new Set((await c.query('SHOW INDEX FROM blog_posts'))[0].map(z => z.Key_name));
        for (const [name] of migration.SCHLUESSEL) if (schluessel.has(name)) await c.query(`ALTER TABLE blog_posts DROP KEY ${name}`);
        for (const [name] of migration.SPALTEN) if (da.has(name)) await c.query(`ALTER TABLE blog_posts DROP COLUMN ${name}`);
    }

    const geprueft = new Set();
    let luege = null;   // gibt an Stelle einer Abfrage eine erfundene Antwort
    const db = {
        query: async (sql, p = []) => {
            if (luege) { const antwort = luege(sql); if (antwort) return antwort; }
            assert.ok(!/^\s*(DROP|CREATE|TRUNCATE)\s/i.test(sql), `der Wächter legt nichts an und wirft nichts weg: ${sql.trim().slice(0, 60)}`);
            const greift = /^\s*(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE)\s+`?(\w+)`?/i.exec(sql);
            if (greift && !geprueft.has(greift[1])) {
                assert.ok(await istKopie(greift[1]), `${greift[1]} ist in dieser Verbindung keine Kopie — abgebrochen, bevor etwas geschrieben wird`);
                geprueft.add(greift[1]);
            }
            return (await c.execute(sql, p))[0];
        },
    };
    const q = (sql, p) => db.query(sql, p);
    const zahl = async (sql, p) => Number((await q(sql, p))[0].n);
    const zeile = async (kennung) => (await q('SELECT * FROM blog_posts WHERE source_message_id = ?', [String(kennung)]))[0];

    await pruefe('Migration: ein vorhandener Beitrag ist danach ein eigener; ein zweiter Lauf ändert nichts', async () => {
        await q(`INSERT INTO blog_posts (title_translations, content_translations, excerpt_translations, slug, author, status, published_at)
                 VALUES (?, ?, ?, 'eigener-artikel', 'firedervil', 'published', '2026-08-10 10:00:00')`,
            [JSON.stringify({ 'de-DE': 'Eigener Artikel', 'en-GB': '' }), JSON.stringify({ 'de-DE': '<p>Text</p>' }), JSON.stringify({ 'de-DE': 'Kurz' })]);
        await migration.up(db);
        const spalten = (await q('SHOW COLUMNS FROM blog_posts')).map(z => z.Field);
        for (const [name] of migration.SPALTEN) assert.ok(spalten.includes(name), `Spalte ${name} fehlt`);
        const schluessel = (await q('SHOW INDEX FROM blog_posts')).map(z => z.Key_name);
        for (const [name] of migration.SCHLUESSEL) assert.ok(schluessel.includes(name), `Schlüssel ${name} fehlt`);
        assert.strictEqual((await q("SELECT source FROM blog_posts WHERE slug = 'eigener-artikel'"))[0].source, 'own');
        await migration.up(db);
        assert.strictEqual((await q('SHOW COLUMNS FROM blog_posts')).length, spalten.length);
    });

    const KANAL = '890627216399040583';
    await pruefe('Kanal: gespeichert und gelesen; eine falsche Kennung wird abgewiesen; leer heißt „nichts einlesen"', async () => {
        assert.strictEqual(await S.kanal(q), null);
        await assert.rejects(S.kanalSetzen(q, { channel_id: 'abc', channel_name: 'x' }), /keine Kanal-Kennung/);
        assert.strictEqual(await S.kanalSetzen(q, { channel_id: KANAL, channel_name: '📡-game-updates' }), KANAL);
        assert.deepStrictEqual(await S.kanal(q), { channel_id: KANAL, channel_name: '📡-game-updates' });
        assert.strictEqual(await S.kanalSetzen(q, { channel_id: '', channel_name: 'egal' }), null);
        assert.strictEqual(await S.kanal(q), null);
        await S.kanalSetzen(q, { channel_id: KANAL, channel_name: '📡-game-updates' });
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM admin_settings WHERE `key` = ?', [S.SCHLUESSEL]), 1);
    });

    const erste = roh('# Update 1.5\nSingle-player ist da: https://duneawakening.com/news/x', { zeit: TAG('2026-09-17') });
    await pruefe('Übernehmen: neu → sichtbar, mit Spiel, Quelle und Original; dieselbe Meldung noch einmal → nichts doppelt', async () => {
        assert.strictEqual(await S.uebernimm(q, S.ausRoh(erste), KANAL), 'neu');
        const z = await zeile(erste.id);
        assert.deepStrictEqual(
            [z.status, z.source, z.category, z.game, z.author, z.source_name, z.source_url, z.source_channel_id, z.tags],
            ['published', 'discord', 'spiele-updates', 'Dune: Awakening', 'Dune: Awakening', 'Dune: Awakening #patch-notes', 'https://duneawakening.com/news/x', KANAL, 'Dune: Awakening']);
        assert.strictEqual(new Date(z.published_at).toISOString().slice(0, 10), '2026-09-17');
        assert.match(z.slug, /^dune-awakening-update-1-5-[a-z0-9]+$/);
        assert.strictEqual(S.text(z.title_translations, 'de-DE'), 'Update 1.5', 'ohne deutsche Fassung zeigt die Seite die englische');

        assert.strictEqual(await S.uebernimm(q, S.ausRoh(erste), KANAL), 'gleich');
        assert.strictEqual(await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE source = 'discord'"), 1);
        // Geplauder im selben Kanal wird nichts.
        assert.strictEqual(await S.uebernimm(q, n('Was spielen wir heute?', { flags: 0, absender: 'firedervil' }), KANAL), null);
        assert.strictEqual(await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE source = 'discord'"), 1);
    });

    await pruefe('Nachholen und Mithören bringen dieselbe Meldung gleichzeitig: keine zweite, kein Fehler', async () => {
        // Die Nachfrage „gibt es sie schon?" sieht die Zeile des anderen noch nicht.
        luege = (sql) => (/SELECT id, status, title_translations/.test(sql) ? [] : null);
        try { assert.strictEqual(await S.uebernimm(q, S.ausRoh(erste), KANAL), 'gleich'); }
        finally { luege = null; }
        assert.strictEqual(await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE source = 'discord'"), 1);
    });

    await pruefe('der Hersteller ändert seinen Text: der Beitrag zieht nach — Adresse und Stand bleiben', async () => {
        const vor = await zeile(erste.id);
        const geaendert = { ...erste, content: '# Update 1.5 ist live\nJetzt mit Liste:\n- eins\n- zwei' };
        assert.strictEqual(await S.uebernimm(q, S.ausRoh(geaendert), KANAL), 'geaendert');
        const nach = await zeile(erste.id);
        assert.strictEqual(S.text(nach.title_translations, 'en-GB'), 'Update 1.5 ist live');
        assert.ok(S.text(nach.content_translations, 'en-GB').includes('<li>eins'));
        assert.deepStrictEqual([nach.id, nach.slug, nach.status], [vor.id, vor.slug, 'published']);

        // Ausgeblendet bleibt ausgeblendet, auch wenn der Hersteller wieder ändert.
        assert.strictEqual(await S.sichtbar(q, nach.id, false), true);
        assert.strictEqual(await S.uebernimm(q, S.ausRoh({ ...erste, content: '# Update 1.5\nNoch eine Fassung' }), KANAL), 'geaendert');
        assert.strictEqual((await zeile(erste.id)).status, 'hidden');
        assert.strictEqual(await S.sichtbar(q, nach.id, true), true);
        assert.strictEqual((await zeile(erste.id)).status, 'published');
    });

    await pruefe('ausblenden gilt nur für Meldungen — ein eigener Artikel bleibt, wie er ist', async () => {
        const eigener = (await q("SELECT id FROM blog_posts WHERE slug = 'eigener-artikel'"))[0].id;
        assert.strictEqual(await S.sichtbar(q, eigener, false), false);
        assert.strictEqual((await q('SELECT status FROM blog_posts WHERE id = ?', [eigener]))[0].status, 'published');
        assert.strictEqual(await S.sichtbar(q, 999999, false), false);
        // Zweimal ausblenden ist beim zweiten Mal keine Änderung.
        const id = (await zeile(erste.id)).id;
        assert.strictEqual(await S.sichtbar(q, id, false), true);
        assert.strictEqual(await S.sichtbar(q, id, false), false);
        await S.sichtbar(q, id, true);
    });

    await pruefe('Original gelöscht oder Nachricht aus dem Kanal entfernt: der Beitrag verschwindet und lässt sich nicht zurückholen', async () => {
        const a = roh('# Wird vom Hersteller gelöscht\nText', { zeit: TAG('2026-09-18') });
        const b = roh('# Wird aus dem Kanal gelöscht\nText', { zeit: TAG('2026-09-19') });
        await S.uebernimm(q, S.ausRoh(a), KANAL);
        await S.uebernimm(q, S.ausRoh(b), KANAL);

        assert.strictEqual(await S.uebernimm(q, S.ausRoh({ ...a, flags: S.GEFOLGT | S.ORIGINAL_WEG }), KANAL), 'entfernt');
        assert.strictEqual((await zeile(a.id)).status, 'removed');
        assert.strictEqual(await S.entfernt(q, b.id), true);
        assert.strictEqual((await zeile(b.id)).status, 'removed');
        assert.strictEqual(await S.entfernt(q, b.id), false);
        assert.strictEqual(await S.sichtbar(q, (await zeile(a.id)).id, true), false, 'eine gelöschte Meldung darf nicht wieder erscheinen');

        // Eine schon beim Einlesen gelöschte Meldung wird gar nicht erst angelegt.
        const vorher2 = await zahl('SELECT COUNT(*) AS n FROM blog_posts');
        assert.strictEqual(await S.uebernimm(q, n('# Schon weg\nText', { flags: S.GEFOLGT | S.ORIGINAL_WEG }), KANAL), null);
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM blog_posts'), vorher2);
    });

    await pruefe('die jüngste Kennung je Kanal — auch über die Grenze von 18 zu 19 Stellen', async () => {
        const kurz = roh('# Alt\nText', { id: '999999999999999999', zeit: TAG('2026-07-02') });      // 18 Stellen
        const lang = roh('# Neu\nText', { id: '1000000000000000001', zeit: TAG('2026-10-09') });     // 19 Stellen, als Text „kleiner"
        await S.uebernimm(q, S.ausRoh(kurz), 'anderer-kanal-1');
        await S.uebernimm(q, S.ausRoh(lang), 'anderer-kanal-1');
        assert.strictEqual(await S.letzteKennung(q, 'anderer-kanal-1'), '1000000000000000001');
        assert.strictEqual(await S.letzteKennung(q, 'gibt-es-nicht'), null);
        await q("DELETE FROM blog_posts WHERE source_channel_id = 'anderer-kanal-1'");
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\nDer Bot: mithören und nachholen');

    ServiceManager.register('dbService', db);
    const Bot = require(path.join(WURZEL, 'apps/bot/helpers/SpieleUpdates.js'));
    /** Eine Nachricht, wie discord.js sie reicht. */
    const dj = (r, mehr = {}) => ({
        id: r.id, channelId: mehr.kanal || KANAL, content: r.content, flags: { bitfield: r.flags }, partial: false,
        author: { username: r.author.username },
        reference: r.message_reference && { guildId: r.message_reference.guild_id, channelId: r.message_reference.channel_id, messageId: r.message_reference.message_id },
        createdAt: new Date(r.timestamp), embeds: [], ...mehr.dazu,
    });

    await pruefe('eine Ankündigung im Kanal wird ein Beitrag; dieselbe in einem anderen Kanal nicht; eine unvollständige wird nachgeladen', async () => {
        Bot.vergiss();
        const fremd = roh('# Falscher Kanal\nText', { zeit: TAG('2026-09-20') });
        await Bot.beiNachricht(dj(fremd, { kanal: '111111111111111111' }));
        assert.strictEqual(await zeile(fremd.id), undefined);

        const hier = roh('# Richtiger Kanal\nText', { zeit: TAG('2026-09-21'), absender: 'Hytale #patch-notes' });
        await Bot.beiNachricht(dj(hier));
        assert.strictEqual((await zeile(hier.id)).game, 'Hytale');

        const spaet = roh('# Kam unvollständig\nText', { zeit: TAG('2026-09-22'), absender: 'Hytale #patch-notes' });
        let geholt = 0;
        await Bot.beiNachricht({ id: spaet.id, channelId: KANAL, partial: true, fetch: async () => { geholt++; return dj(spaet); } });
        assert.strictEqual(geholt, 1);
        assert.strictEqual(S.text((await zeile(spaet.id)).title_translations, 'en-GB'), 'Kam unvollständig');

        await Bot.beiLoeschung({ id: spaet.id, channelId: KANAL, partial: true });
        assert.strictEqual((await zeile(spaet.id)).status, 'removed');
        // Ein Fehler beim Übernehmen darf den Bot nicht umwerfen.
        await Bot.beiNachricht({ id: '1', channelId: KANAL, partial: true, fetch: async () => { throw new Error('Unknown Message'); } });
    });

    await pruefe('Nachholen: beim ersten Mal ab dem Stichtag, danach ab der jüngsten Meldung — auch über mehrere Abrufe', async () => {
        await q("DELETE FROM blog_posts WHERE source = 'discord'");
        // 250 Nachrichten im Kanal: drei vor dem Stichtag, dann abwechselnd Ankündigung und Geplauder.
        const kanalInhalt = [];
        for (let i = 0; i < 3; i++) kanalInhalt.push(roh(`# Vor dem Stichtag ${i}\nText`, { zeit: new Date(Date.UTC(2026, 5, 20 + i)) }));
        for (let i = 0; i < 247; i++) {
            const zeit = new Date(Date.UTC(2026, 6, 1, 0, 0, 1) + i * 3600_000);
            kanalInhalt.push(i % 2 ? roh(`plauder ${i}`, { zeit, flags: 0, absender: 'firedervil' })
                : roh(`# Meldung ${i}\nText`, { zeit, absender: i % 4 ? 'Hytale #patch-notes' : 'ICARUS Official #announcements' }));
        }
        const abrufe = [];
        const client = { channels: { fetch: async (id) => (id !== KANAL ? null : { messages: { fetch: async ({ after, limit }) => {
            abrufe.push(after);
            // Wie Discord: die `limit` Nachrichten direkt NACH der Kennung, neueste zuerst.
            const teil = kanalInhalt.filter(m => BigInt(m.id) > BigInt(after)).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).slice(0, limit).reverse();
            return { size: teil.length, values: () => teil.map(m => dj(m)) };
        } } }) } };

        Bot.vergiss();
        let e = await Bot.nachholen(client);
        assert.deepStrictEqual([e.aktiv, e.gelesen, e.neu, e.geaendert], [true, 247, 124, 0]);
        assert.strictEqual(abrufe[0], S.kennungAus(new Date(`${S.STICHTAG}T00:00:00Z`)));
        assert.strictEqual(abrufe.length, 3, 'drei Abrufe für 247 Nachrichten');
        assert.strictEqual(await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE source = 'discord'"), 124);
        assert.strictEqual(await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE source = 'discord' AND title_translations LIKE '%Stichtag%'"), 0);

        // Zwei neue Ankündigungen, während der Bot aus war.
        const letzte = kanalInhalt[kanalInhalt.length - 1];
        kanalInhalt.push(roh('plauder danach', { id: (BigInt(letzte.id) + 1n).toString(), zeit: TAG('2026-10-10'), flags: 0, absender: 'firedervil' }));
        for (let i = 1; i <= 2; i++) kanalInhalt.push(roh(`# Während der Pause ${i}\nText`, { id: (BigInt(letzte.id) + BigInt(i) * 4194304n).toString(), zeit: TAG('2026-10-10') }));
        e = await Bot.nachholen(client);
        assert.deepStrictEqual([e.gelesen, e.neu], [3, 2], 'gelesen wird nur, was nach der jüngsten eingelesenen Meldung steht (das Geplauder dahinter zählt mit)');
        assert.strictEqual(await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE source = 'discord'"), 126);

        // Kanal nicht lesbar: eine Auskunft, kein Absturz. Kein Kanal eingestellt: nichts tun.
        assert.match((await Bot.nachholen({ channels: { fetch: async () => null } })).fehler, /nicht lesen/);
        await S.kanalSetzen(q, { channel_id: '', channel_name: '' });
        Bot.vergiss();
        assert.deepStrictEqual(await Bot.nachholen(client), { aktiv: false });
        await Bot.beiNachricht(dj(roh('# Abgeschaltet\nText')));
        assert.strictEqual(await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE title_translations LIKE '%Abgeschaltet%'"), 0);
        await S.kanalSetzen(q, { channel_id: KANAL, channel_name: '📡-game-updates' });
        Bot.vergiss();
    });

    await pruefe('Nachholen vom Dashboard aus liest ab dem Stichtag: nichts doppelt, Geändertes zieht nach', async () => {
        const vorher3 = await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE source = 'discord'");
        // Älter als die jüngste eingelesene Meldung (die Nachrichten der Prüfung davor reichen bis zum 11. Juli).
        const eine = roh('# Erst so\nText', { zeit: TAG('2026-07-05'), absender: 'Hytale #patch-notes' });
        const inhalt = [eine];
        const client = { channels: { fetch: async () => ({ messages: { fetch: async ({ after, limit }) => {
            const teil = inhalt.filter(m => BigInt(m.id) > BigInt(after)).slice(0, limit);
            return { size: teil.length, values: () => teil.map(m => dj(m)) };
        } } }) } };
        Bot.vergiss();
        // Ohne `vonVorn` läge diese Nachricht VOR der jüngsten eingelesenen und käme nie an.
        assert.deepStrictEqual((({ gelesen, neu }) => [gelesen, neu])(await Bot.nachholen(client)), [0, 0]);
        assert.deepStrictEqual((({ gelesen, neu }) => [gelesen, neu])(await Bot.nachholen(client, { vonVorn: true })), [1, 1]);
        eine.content = '# Jetzt anders\nText';
        assert.deepStrictEqual((({ gelesen, neu, geaendert }) => [gelesen, neu, geaendert])(await Bot.nachholen(client, { vonVorn: true })), [1, 0, 1]);
        assert.strictEqual(await zahl("SELECT COUNT(*) AS n FROM blog_posts WHERE source = 'discord'"), vorher3 + 1);
        await q('DELETE FROM blog_posts WHERE source_message_id = ?', [eine.id]);
    });

    await pruefe('Bilder holen: in den Ordner „spiele-updates" der Medienablage, einmal je Anhang — und ein kaputtes Bild kostet nicht die Meldung', async () => {
        const Bilder = require(path.join(WURZEL, 'apps/bot/helpers/SpieleBilder.js'));
        const os = require('os');
        const ablage = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-meldungsbilder-'));
        const GUILD = '565123525795643393';
        const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 7)]);
        const echtesFetch = global.fetch;
        const geholt = [];
        global.fetch = async (adresse) => {
            geholt.push(adresse);
            const daten = /kaputt/.test(adresse) ? Buffer.from('<html>Not an image</html>   ') : (/weg/.test(adresse) ? null : png);
            return { ok: daten !== null, status: daten ? 200 : 404, headers: { get: () => String(daten ? daten.length : 0) },
                arrayBuffer: async () => daten.buffer.slice(daten.byteOffset, daten.byteOffset + daten.length) };
        };
        try {
            const basis = 'https://cdn.discordapp.com/attachments/1/';
            const nachricht = n('# Update 1.5\nText', { id: '1557226689023574038', attachments: [
                anhang({ id: '1557193051871387001', url: basis + 'gut.png' }),
                anhang({ id: '1557193051871387002', url: basis + 'kaputt.png' }),
                anhang({ id: '1557193051871387003', url: basis + 'weg.png' }),
            ] });
            let bilder = await Bilder.sichere(nachricht, GUILD, '1400171310918795334', 'Dune: Awakening: Update 1.5', ablage);
            assert.deepStrictEqual(bilder, [{ adresse: `/uploads/media/${GUILD}/meldung-1557226689023574038-1557193051871387001.png`, alt: 'Dune: Awakening: Update 1.5' }]);
            assert.deepStrictEqual(fs.readdirSync(path.join(ablage, GUILD)), ['meldung-1557226689023574038-1557193051871387001.png'], 'nur das echte Bild liegt auf der Platte');
            const zeilen = await q('SELECT * FROM guild_media');
            assert.strictEqual(zeilen.length, 1);
            assert.deepStrictEqual(
                [zeilen[0].guild_id, zeilen[0].folder, zeilen[0].stored_name, zeilen[0].mime_type, zeilen[0].file_size, zeilen[0].width, zeilen[0].uploaded_by, zeilen[0].title],
                [GUILD, 'spiele-updates', 'meldung-1557226689023574038-1557193051871387001.png', 'image/png', png.length, 1280, '1400171310918795334', 'Dune: Awakening: Update 1.5']);

            // Noch einmal (der Hersteller ändert den Text): nichts wird neu geladen oder doppelt eingetragen.
            const vorher4 = geholt.filter(a => /gut/.test(a)).length;
            bilder = await Bilder.sichere(nachricht, GUILD, '1400171310918795334', 'x', ablage);
            assert.strictEqual(bilder.length, 1);
            assert.strictEqual(geholt.filter(a => /gut/.test(a)).length, vorher4, 'das Bild wurde ein zweites Mal geladen');
            assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM guild_media'), 1);

            // Der Betreiber hat die Datei in der Medienablage gelöscht: Beim nächsten Durchgang ist sie wieder da.
            await q('DELETE FROM guild_media');
            fs.unlinkSync(path.join(ablage, GUILD, 'meldung-1557226689023574038-1557193051871387001.png'));
            assert.strictEqual((await Bilder.sichere(nachricht, GUILD, '1', 'x', ablage)).length, 1);
            assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM guild_media'), 1);

            assert.deepStrictEqual(await Bilder.sichere(nachricht, '../../etc', '1', 'x', ablage), [], 'eine Guild-Kennung, die keine ist');
            // Der Beitrag trägt das Bild — und die Meldung mit dem kaputten Bild ist trotzdem da.
            assert.strictEqual(await S.uebernimm(q, nachricht, KANAL, bilder), 'neu');
            assert.ok(S.text((await zeile(nachricht.id)).content_translations, 'en-GB').includes(bilder[0].adresse));
            await q('DELETE FROM blog_posts WHERE source_message_id = ?', [nachricht.id]);
            assert.ok(!Bilder.ABLAGE.startsWith(ablage) && Bilder.ABLAGE.endsWith(path.join('apps', 'dashboard', 'uploads', 'media')));
        } finally {
            global.fetch = echtesFetch;
            fs.rmSync(ablage, { recursive: true, force: true });
        }
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\nAnzeige: Spalte, Rubrik und Beitrag');

    await pruefe('Spalte: je Spiel höchstens drei, höchstens zwölf, die neuesten zuerst, nur Sichtbares', async () => {
        const spalte = await S.fuerSpalte(q, 'de-DE');
        const jeSpiel = {};
        for (const m of spalte) jeSpiel[m.spiel] = (jeSpiel[m.spiel] || 0) + 1;
        assert.ok(Object.values(jeSpiel).every(z => z <= S.JE_SPIEL), JSON.stringify(jeSpiel));
        assert.ok(spalte.length <= S.IN_DER_SPALTE && spalte.length === 8, `Dune 2 + Hytale 3 + ICARUS 3, nicht ${spalte.length}`);
        assert.strictEqual(spalte[0].titel, 'Während der Pause 2');
        assert.deepStrictEqual(spalte.map(m => +new Date(m.zeit)), spalte.map(m => +new Date(m.zeit)).sort((a, b) => b - a));

        const erster = spalte[0];
        await S.sichtbar(q, erster.id, false);
        assert.ok(!(await S.fuerSpalte(q, 'de-DE')).some(m => m.id === erster.id));
        await S.sichtbar(q, erster.id, true);
    });

    await pruefe('Rubrik: seitenweise, nach Spiel gefiltert, mit der Zahl je Spiel; ein Platzhalter im Namen ist Text', async () => {
        const alle = await S.liste(q, { sprache: 'de-DE' });
        assert.deepStrictEqual([alle.zahl, alle.seite, alle.seiten, alle.eintraege.length], [126, 1, 5, S.JE_SEITE]);
        const letzteSeite = await S.liste(q, { seite: 5 });
        assert.strictEqual(letzteSeite.eintraege.length, 6);
        assert.strictEqual((await S.liste(q, { seite: 'abc' })).seite, 1);
        assert.strictEqual((await S.liste(q, { seite: -3 })).seite, 1);

        const spiele = await S.spiele(q);
        assert.deepStrictEqual(spiele.map(s => s.spiel), ['Dune: Awakening', 'Hytale', 'ICARUS']);
        assert.strictEqual(spiele.reduce((s, x) => s + x.zahl, 0), 126);
        const hytale = await S.liste(q, { spiel: 'Hytale' });
        assert.ok(hytale.zahl === spiele.find(s => s.spiel === 'Hytale').zahl && hytale.eintraege.every(m => m.spiel === 'Hytale'));
        assert.strictEqual((await S.liste(q, { spiel: '%' })).zahl, 0);
        assert.strictEqual((await S.liste(q, { spiel: "x' OR '1'='1" })).zahl, 0);

        const verwaltung = await S.fuerVerwaltung(q, 'de-DE', 100);
        assert.deepStrictEqual([verwaltung.zahl, verwaltung.eintraege.length], [126, 100]);
    });

    const zeichne = (ansicht, daten) => ejs.renderFile(path.join(ANSICHTEN, ansicht + '.ejs'), { theme: { asset: (x) => x }, ...daten });
    const eigene = [{ slug: 'eigener-artikel', title: 'Eigener Artikel', category: 'gaming', excerptText: 'Kurz', formattedDate: '10. August 2026', author: 'firedervil' }];

    await pruefe('Blogseite: links die eigenen Artikel, rechts die Meldungen — ohne Meldungen einspaltig wie vorher', async () => {
        const spalte = (await S.fuerSpalte(q, 'de-DE')).map(m => ({ ...m, datum: '9. Oktober 2026' }));
        spalte[0].titel = '<b>Titel</b> mit Tag';
        const html = await zeichne('frontend/blog', { blogPosts: eigene, rubriken: ['gaming'], spieleUpdates: spalte, currentCategory: null });
        const links = html.slice(html.indexOf('col-lg-8'), html.indexOf('<aside'));
        const rechts = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
        assert.ok(links.includes('Eigener Artikel') && !links.includes('blog-meldung"'), 'links stehen nur die eigenen Artikel');
        assert.strictEqual((rechts.match(/class="blog-meldung"/g) || []).length, spalte.length);
        assert.ok(!rechts.includes('Eigener Artikel'));
        assert.ok(rechts.includes('&lt;b&gt;Titel&lt;/b&gt; mit Tag') && !rechts.includes('<b>Titel</b>'), 'der Titel einer Meldung wird escapt ausgegeben');
        assert.ok(rechts.includes('href="/blog/spiele-updates"') && rechts.includes(`href="/blog/${spalte[1].slug}"`));

        const ohne = await zeichne('frontend/blog', { blogPosts: eigene, rubriken: ['gaming'], spieleUpdates: [], currentCategory: null });
        assert.ok(!ohne.includes('<aside') && ohne.includes('col-lg-4 col-md-6') && ohne.includes('Eigener Artikel'));
        // Der laufende Prozess von vor dem Umbau gibt die neuen Werte nicht mit — die Ansicht muss damit leben.
        const alt = await zeichne('frontend/blog', { blogPosts: eigene, currentCategory: null });
        assert.ok(!alt.includes('<aside') && alt.includes('Eigener Artikel'));
        const leer = await zeichne('frontend/blog', { blogPosts: [], rubriken: [], spieleUpdates: spalte, currentCategory: null });
        assert.ok(leer.includes('Noch keine Blog-Posts') && leer.includes('<aside'));
    });

    await pruefe('Rubrikseite: Filter je Spiel mit Zahl, Blättern behält das Spiel, Leerfall hat einen Satz', async () => {
        const erg = await S.liste(q, { spiel: 'Hytale', seite: 1 });
        const daten = { spiele: await S.spiele(q), spiel: 'Hytale', eintraege: erg.eintraege.map(m => ({ ...m, datum: 'x' })), zahl: erg.zahl, seite: 1, seiten: erg.seiten };
        const html = await zeichne('frontend/blog-updates', daten);
        assert.ok(html.includes('href="/blog/spiele-updates?spiel=Dune%3A%20Awakening"'), 'der Name des Spiels steht kodiert in der Adresse');
        assert.ok(html.includes('href="/blog/spiele-updates?spiel=Hytale&amp;seite=2"') || html.includes('href="/blog/spiele-updates?spiel=Hytale&seite=2"'));
        assert.strictEqual((html.match(/blog-meldung-gross/g) || []).length, erg.eintraege.length);
        assert.match(await zeichne('frontend/blog-updates', { ...daten, spiel: 'Gibt es nicht', eintraege: [], zahl: 0, seiten: 1 }), /Zu diesem Spiel gibt es keine Meldungen/);
        assert.match(await zeichne('frontend/blog-updates', { spiele: [], spiel: null, eintraege: [], zahl: 0, seite: 1, seiten: 1 }), /Noch keine Meldungen vorhanden/);
    });

    await pruefe('Beitrag: eine Meldung nennt Quelle und Original; ein eigener Artikel sieht aus wie vorher', async () => {
        const z = (await q("SELECT * FROM blog_posts WHERE source = 'discord' AND status = 'published' ORDER BY id LIMIT 1"))[0];
        const post = { ...z, title: S.text(z.title_translations, 'de-DE'), content: S.text(z.content_translations, 'de-DE'), formattedDate: 'x',
            source_url: 'https://a.example/"><script>x</script>' };
        const html = await zeichne('frontend/blog-detail', { post });
        assert.ok(html.includes('class="blog-quelle') && html.includes('ICARUS Official #announcements') && html.includes('Zum Original'));
        assert.ok(html.includes('href="/blog/spiele-updates"') && !html.includes('<script>x</script>'));
        assert.ok(html.includes(post.content), 'der gespeicherte Inhalt steht unverändert da');

        const eigen = await zeichne('frontend/blog-detail', { post: { title: 'Eigen', content: '<p>Mein <em>Text</em></p>', formattedDate: 'x', author: 'firedervil', category: 'gaming', tags: 'a, b' } });
        assert.ok(!eigen.includes('class="blog-quelle') && eigen.includes('<p>Mein <em>Text</em></p>') && eigen.includes('Zurück zum Blog') && eigen.includes('bi-tag'));
    });

    await pruefe('Verwaltung: die Liste der Meldungen zeichnet sich; ohne den neuen Wert bleibt die Seite heil', async () => {
        // Nur der neue Abschnitt wird gezeichnet — die Seite drumherum braucht das halbe Dashboard.
        const quelle = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/admin/content.ejs'));
        const a = quelle.indexOf('<% const meldungen = locals.spieleMeldungen');
        const e = quelle.indexOf('id="tab-changelogs"', a);
        assert.ok(a > 0 && e > a, 'der Abschnitt mit den Meldungen steht nicht mehr im Reiter „Blog"');
        const abschnitt = quelle.slice(a, quelle.lastIndexOf('<div', e)).replace(/<\/div>\s*$/, '');
        const v = await S.fuerVerwaltung(q, 'de-DE', 5);
        await S.sichtbar(q, v.eintraege[1].id, false);
        const v2 = await S.fuerVerwaltung(q, 'de-DE', 5);
        const html = ejs.render(abschnitt, { spieleMeldungen: { ...v2, eintraege: v2.eintraege.map(m => ({ ...m, datum: 'x' })), kanal: await S.kanal(q) } });
        assert.strictEqual((html.match(/data-sichtbar="0"/g) || []).length, 4);
        assert.strictEqual((html.match(/data-sichtbar="1"/g) || []).length, 1);
        assert.ok(html.includes('📡-game-updates') && html.includes('neuesten 5 von 126'));
        assert.match(ejs.render(abschnitt, {}), /kein Kanal eingestellt[\s\S]*Noch keine Meldungen eingelesen/);
        await S.sichtbar(q, v.eintraege[1].id, true);
    });

    await pruefe('der Wächter hat an den echten Tabellen nichts geändert', async () => {
        assert.strictEqual(await echt(), vorher);
    });
    await c.end();
    await aussen.end();

    // ═════════════════════════════════════════════════════════════
    console.log('\nVerdrahtung');

    await pruefe('der Bot hört neu, geändert und gelöscht, holt beim Start nach, und das Dashboard kann ihn anstoßen', () => {
        for (const [datei, aufruf] of [['messageCreate', 'beiNachricht(message)'], ['messageUpdate', 'beiNachricht(neu)'], ['messageDelete', 'beiLoeschung(message)']]) {
            assert.ok(ohneKommentare(lies(`apps/bot/events/${datei}.js`)).includes(`SpieleUpdates.${aufruf}`), `${datei} ruft den Leser nicht`);
        }
        assert.ok(ohneKommentare(lies('apps/bot/events/clientReady.js')).includes('SpieleUpdates.nachholen(client)'));
        const anstoss = require(path.join(WURZEL, 'apps/bot/ipc/SPIELE_UPDATES_NACHHOLEN.js'));
        assert.strictEqual(typeof anstoss, 'function');
        assert.ok(ohneKommentare(lies('apps/dashboard/routes/admin/content.router.js')).includes("broadcastOne('dashboard:SPIELE_UPDATES_NACHHOLEN'"),
            'das Dashboard ruft den Handler nicht unter dem Namen seiner Datei');
        // Der Bot braucht den Inhalt der Nachrichten — ohne dieses Recht kommt `content` leer an.
        assert.ok(ohneKommentare(lies('apps/bot/extenders/BotClient.js')).includes('GatewayIntentBits.MessageContent'));
    });

    await pruefe('der Toast nach dem Nachholen nennt die Zahlen des Bots; scheitert der Bot, wird er gelb', async () => {
        // Am 2026-10-25 stand dort „undefined Nachrichten gelesen" in Grün: Die
        // Route las die Zahlen aus der Hülle statt aus `data`.
        assert.ok(/kernIpcHandlers[\s\S]{0,300}message\.reply\(\{ success: true, data \}\)/.test(ohneKommentare(lies('apps/bot/helpers/IPCClient.js'))),
            'der Bot verpackt die Antwort seiner Kern-Handler nicht mehr in { success, data } — die Fälle unten stimmen nicht mehr');
        const route = require(path.join(WURZEL, 'apps/dashboard/routes/admin/content.router.js')).stack
            .find(l => l.route?.path === '/settings/spiele-updates/save' && l.route.methods.post).route.stack[0].handle;
        const vorherDb = ServiceManager.has('dbService') ? ServiceManager.get('dbService') : null;
        const vorherIpc = ServiceManager.has('ipcServer') ? ServiceManager.get('ipcServer') : null;
        ServiceManager.register('dbService', { query: async () => [] });
        const sende = async (huelle) => {
            ServiceManager.register('ipcServer', { broadcastOne: async () => huelle });
            let antwort;
            await route({ body: { channel_id: '123456789012345678', channel_name: 'game-updates' } }, { status() { return this; }, json(a) { antwort = a; } });
            return antwort;
        };
        try {
            const gut = await sende({ success: true, data: { success: true, gelesen: 7, neu: 2, geaendert: 1 } });
            assert.ok(!gut.warnung && gut.message.includes('7 Nachrichten gelesen, 2 neue Meldungen im Blog, 1 geändert'), gut.message);
            const bot = await sende({ success: true, data: { success: false, error: 'Kanal nicht lesbar' } });
            assert.ok(bot.warnung && bot.message.includes('Kanal nicht lesbar'), bot.message);
            const weg = await sende({ success: false, data: null, error: 'Timed out' });
            assert.ok(weg.warnung && weg.message.includes('Timed out'), weg.message);
        } finally {
            if (vorherDb) ServiceManager.register('dbService', vorherDb);
            if (vorherIpc) ServiceManager.register('ipcServer', vorherIpc);
        }
    });

    await pruefe('die Regel steht an einer Stelle: Bot und Dashboard wandeln nichts selbst um', () => {
        for (const p of ['apps/bot/helpers/SpieleUpdates.js', 'apps/dashboard/routes/frontend.router.js', 'apps/dashboard/routes/admin/content.router.js']) {
            const code = ohneKommentare(lies(p));
            assert.ok(/Spielemeldungen\./.test(code), `${p} nutzt die Regel nicht`);
            assert.ok(!/INSERT INTO blog_posts[\s\S]{0,400}source_message_id/.test(code), `${p} legt selbst Meldungen an`);
        }
        assert.ok(!/status\s*=\s*'(hidden|removed)'/.test(ohneKommentare(lies('apps/dashboard/routes/admin/content.router.js'))),
            'der Stand einer Meldung wird nur in der Regel gesetzt');
    });

    await pruefe('Trennung: die Blogseite und der Editor fassen nur eigene Artikel an; die Rubrik steht vor /blog/:slug', () => {
        const front = ohneKommentare(lies('apps/dashboard/routes/frontend.router.js'));
        const liste = front.slice(front.indexOf("router.get('/blog', "), front.indexOf("router.get('/blog/' + Spielemeldungen.RUBRIK"));
        assert.ok(liste.length > 200 && (liste.match(/FROM blog_posts WHERE/g) || []).length === (liste.match(/source = 'own'/g) || []).length,
            'eine Abfrage der Blogseite holt auch Meldungen in die linke Spalte');
        assert.ok(front.indexOf("router.get('/blog/' + Spielemeldungen.RUBRIK") > 0
            && front.indexOf("router.get('/blog/' + Spielemeldungen.RUBRIK") < front.indexOf("router.get('/blog/:slug'"),
            '„spiele-updates" würde als Beitrag gesucht');

        const admin = ohneKommentare(lies('apps/dashboard/routes/admin/content.router.js'));
        assert.ok(/SELECT \* FROM blog_posts WHERE id = \? AND source = 'own'/.test(admin), 'eine Meldung ließe sich im Editor öffnen');
        assert.ok(/DELETE FROM blog_posts WHERE id = \? AND source = 'own'/.test(admin), 'eine Meldung ließe sich löschen (und käme beim Nachholen nicht wieder)');
        assert.ok(/WHERE id=\? AND source='own'/.test(admin), 'der Editor könnte eine Meldung überschreiben');
        assert.ok(admin.includes('finalSlug === Spielemeldungen.RUBRIK'), 'ein eigener Artikel könnte die Adresse der Rubrik belegen');
    });

    await pruefe('roh ausgegeben wird auf den Blogseiten nur der gespeicherte Inhalt des Beitrags', () => {
        for (const ansicht of ['frontend/blog', 'frontend/blog-updates']) {
            assert.ok(!/<%-/.test(ohneKommentareEjs(lies(`apps/dashboard/themes/default/views/${ansicht}.ejs`))), `${ansicht} gibt etwas unescapt aus`);
        }
        const detail = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/frontend/blog-detail.ejs'));
        assert.deepStrictEqual(detail.match(/<%-[^%]*%>/g), ['<%- post.content %>']);
    });

    console.log(`\n${fehler ? '❌' : '✅'} ${bestanden} bestanden, ${fehler} gescheitert`);
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error('\n❌ Der Wächter selbst ist gescheitert:', e); process.exit(1); });
