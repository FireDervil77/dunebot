#!/usr/bin/env node
/**
 * Prueft die Bruecke, ueber die fremde Lose in eine Verlosung kommen.
 *
 * # Was hier auf dem Spiel steht
 *
 * Der Betreiber hat entschieden: Twitch haengt an den bestehenden Plugins
 * dran, statt sie umzubauen. Das Verlosungs-Plugin erfuellt seine
 * Discord-Aufgabe seit jeher, und das darf diese Erweiterung **nicht**
 * antasten. Die halbe Pruefung hier besteht deshalb aus dem Nachweis, dass
 * sich am Discord-Weg nichts geaendert hat: `teilnahme` steht per Vorgabe auf
 * `discord`, und dann wird keine Quelle auch nur gefragt.
 *
 * Die andere Haelfte ist die Stelle, an der es leise falsch werden koennte.
 * `giveaway_winners.user_id` hielt bis heute nur Discord-Kennungen. Eine
 * Twitch-Kennung dort, in `<@id>` gerendert, ergibt eine kaputte Erwaehnung -
 * im schlechtesten Fall zeigt sie auf ein unbeteiligtes Mitglied. In einer
 * Direktnachricht ergibt sie ein fremdes Konto, das eine Gewinnbenachrichtigung
 * bekommt, die ihm nicht gehoert. Beides stuerzt nicht ab.
 *
 * Geprueft wird am **echten** `GiveawayManager` und an der echten Registry.
 * Datenbank und Discord sind Attrappen; die Discord-Attrappe schreibt mit,
 * was gesendet wurde - denn genau der Text ist der Pruefgegenstand.
 *
 *   node scripts/check-giveaway-losquellen.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const { ServiceManager } = require('dunebot-core');
const { LosquellenRegistry } = require('dunebot-sdk');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

// ---------------------------------------------------------------------------
// Attrappen
// ---------------------------------------------------------------------------

const protokoll = [];
ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, success: () => {},
    warn: (...a) => protokoll.push(a.map(String).join(' ')),
    error: (...a) => protokoll.push(a.map(String).join(' '))
});

const unbekannteAbfragen = [];
const daten = { verlosung: null, eintraege: [], gewinner: [], geschrieben: [], angelegt: [] };

ServiceManager.register('dbService', {
    async query(sql, werte = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        if (s.startsWith('SELECT * FROM giveaways WHERE id')) {
            return daten.verlosung ? [daten.verlosung] : [];
        }
        if (s.startsWith('SELECT user_id, entry_count FROM giveaway_entries')) {
            return daten.eintraege;
        }
        if (s.startsWith('SELECT user_id, quelle FROM giveaway_winners')) {
            return daten.gewinner;
        }
        if (s.startsWith('SELECT * FROM giveaway_requirements')) {
            // `_updateEmbedActive` zeigt die Bedingungen in der Einbettung an.
            // Keine hier - die Discord-Bedingungen sind nicht Gegenstand
            // dieser Pruefung, sie bleiben unangetastet.
            return [];
        }
        if (s.startsWith('INSERT INTO giveaways')) {
            daten.angelegt.push(werte);
            return { insertId: 42 };
        }
        if (s.startsWith('INSERT INTO giveaway_winners')) {
            daten.geschrieben.push(werte);
            daten.gewinner.push({ user_id: werte[1], quelle: werte[2] });
            return [];
        }
        if (s.startsWith('SELECT COALESCE(SUM(entry_count)')) {
            return [{ total: daten.eintraege.length }];
        }
        if (s.startsWith('UPDATE giveaways') || s.startsWith('SELECT id FROM giveaway_blacklist')) {
            return [];
        }

        if (/^(SELECT|INSERT|UPDATE|DELETE)/i.test(s)) unbekannteAbfragen.push(s.slice(0, 90));
        return [];
    }
});

/** Was Discord zu sehen bekaeme. */
const discord = { gesendet: [], dms: [] };

const kanal = {
    id: 'k1',
    send: async (o) => { discord.gesendet.push(String(o.content || '')); return {}; },
    messages: { fetch: async () => ({ edit: async (o) => { discord.gesendet.push(JSON.stringify(o.embeds?.[0]?.data || {})); } }) }
};

const client = {
    guilds: { cache: { get: () => ({ id: 'g1', name: 'Testgilde', channels: { cache: { get: () => kanal } } }) } },
    channels: { cache: { get: () => kanal } },
    // **Die Attrappe wirft hier absichtlich nicht.** Der erste Entwurf liess
    // `users.fetch` bei kurzen Kennungen scheitern - dann bestand der Fall
    // "kein DM an fremde Gewinner" aus dem falschen Grund, naemlich weil die
    // Attrappe es verhinderte statt der Code. Aufgefallen bei der Gegenprobe:
    // Die Sabotage "Direktnachricht an jeden" liess ihn gruen.
    users: {
        fetch: async (id) => ({ id, send: async () => { discord.dms.push(String(id)); } })
    }
};

const GiveawayManager = require('../plugins/giveaway/bot/managers/GiveawayManager');
const manager = new GiveawayManager(client);

/** Eine Quelle, die mitschreibt, ob und wie oft sie gefragt wurde. */
const twitch = {
    gefragt: 0, verkuendet: [],
    label: 'Twitch-Chat',
    lose: async () => { twitch.gefragt++; return [{ kennung: '77001', name: 'ZuschauerA', anzahl: 1 }]; },
    nennung: (los) => `${los.name || los.kennung} (Twitch)`,
    verkuenden: async (g, los) => { twitch.verkuendet.push(los.kennung); }
};

/**
 * Lage herstellen.
 *
 * @param {string} teilnahme Weg der Verlosung
 * @param {Array} eintraege Discord-Eintraege
 * @returns {void}
 */
function lage(teilnahme, eintraege) {
    daten.verlosung = {
        id: 1, guild_id: 'g1', channel_id: 'k1', message_id: 'm1',
        prize: 'Ein Preis', winner_count: 1, status: 'active',
        teilnahme, claim_duration_ms: null
    };
    daten.eintraege = eintraege;
    daten.gewinner = [];
    daten.geschrieben = [];
    discord.gesendet = []; discord.dms = [];
    twitch.gefragt = 0; twitch.verkuendet = [];
}

(async () => {
    // -----------------------------------------------------------------------
    console.log('\nDie Registry laesst nicht alles herein');
    // -----------------------------------------------------------------------
    LosquellenRegistry.leeren();

    let geworfen = null;
    try { LosquellenRegistry.register('discord', twitch); } catch (e) { geworfen = e.message; }
    pruefe(Boolean(geworfen), '"discord" ist als Quellenname gesperrt — es ist die eigene Herkunft');

    geworfen = null;
    try { LosquellenRegistry.register('halb', { lose: async () => [] }); } catch (e) { geworfen = e.message; }
    pruefe(/nennung/.test(String(geworfen)), 'eine Quelle ohne "nennung" wird abgewiesen',
        'sonst faellt es erst beim Verkuenden auf');

    pruefe(LosquellenRegistry.register('streaming', twitch) === true, 'eine vollstaendige Quelle wird eingetragen');

    // -----------------------------------------------------------------------
    console.log('\nDer Discord-Weg bleibt unangetastet');
    // -----------------------------------------------------------------------
    lage('discord', [{ user_id: '111111111111111111', entry_count: 1 }]);

    let ergebnis = await manager.endGiveaway(1);
    pruefe(twitch.gefragt === 0, 'bei teilnahme=discord wird KEINE Quelle gefragt',
        'auch wenn eine eingetragen ist');
    pruefe(ergebnis.winners.length === 1 && ergebnis.winners[0].kennung === '111111111111111111',
        'der Discord-Teilnehmer gewinnt');
    pruefe(discord.gesendet.some(t => t.includes('<@111111111111111111>')),
        'und wird als Erwaehnung genannt');
    pruefe(discord.dms.includes('111111111111111111'), 'er bekommt seine Direktnachricht');
    pruefe(daten.geschrieben[0]?.[2] === 'discord', 'die Herkunft wird als "discord" mitgeschrieben');

    // Gewichtung: wer mehr Lose hat, steht oefter im Topf.
    lage('discord', [
        { user_id: '111111111111111111', entry_count: 1 },
        { user_id: '222222222222222222', entry_count: 99 }
    ]);
    let treffer = 0;
    for (let i = 0; i < 40; i++) {
        const lose = await manager._drawWinners(1, 1);
        if (lose[0]?.kennung === '222222222222222222') treffer++;
    }
    pruefe(treffer > 30, 'die Gewichtung nach entry_count wirkt weiter', `${treffer}/40`);

    // -----------------------------------------------------------------------
    console.log('\nDer Stream-Weg');
    // -----------------------------------------------------------------------
    lage('beide', [{ user_id: '111111111111111111', entry_count: 1 }]);
    const lose = await manager._drawWinners(1, 5);
    pruefe(twitch.gefragt === 1, 'bei teilnahme=beide wird die Quelle gefragt');
    pruefe(lose.length === 2, 'eigene und fremde Lose liegen in einem Topf', `${lose.length} Lose`);
    pruefe(lose.some(l => l.quelle === 'streaming' && l.kennung === '77001'),
        'das fremde Los traegt seine Herkunft mit');

    // **Vollzaehligkeit.** Bis 2026-09-07 warf die Ziehung und verwarf, mit
    // hoechstens `pool.length * 2` Wuerfen - bei zehn Teilnehmern und zehn
    // Preisen kam sie in 78 % der Faelle zu kurz. Der Fall lief damals rot.
    // Kennungen als Zeichenkette bauen, nicht rechnen: Discord-Kennungen
    // liegen jenseits von `Number.MAX_SAFE_INTEGER`, und `1111…110 + 3` ergibt
    // dieselbe Zahl wie `+ 0`. Der erste Anlauf hier hatte deshalb zehnmal
    // denselben Teilnehmer und meldete 0/60 - ein Messfehler, kein Befund.
    lage('discord', Array.from({ length: 10 },
        (_, i) => ({ user_id: `11111111111111111${i}`, entry_count: 1 })));
    let vollzaehlig = 0;
    for (let i = 0; i < 60; i++) {
        const alle = await manager._drawWinners(1, 10);
        if (alle.length === 10) vollzaehlig++;
    }
    pruefe(vollzaehlig === 60, '10 Teilnehmer, 10 Gewinner: immer vollzaehlig',
        `${vollzaehlig}/60`);

    lage('stream', []);
    const abgewiesen = await manager.addEntry(1, '111111111111111111');
    pruefe(abgewiesen.error === 'nur_stream',
        'bei teilnahme=stream weist der Discord-Knopf ab', String(abgewiesen.error));

    // -----------------------------------------------------------------------
    console.log('\nEin fremder Gewinner bekommt nie eine Discord-Behandlung');
    // -----------------------------------------------------------------------
    lage('stream', []);
    ergebnis = await manager.endGiveaway(1);
    pruefe(ergebnis.winners[0]?.quelle === 'streaming', 'der Twitch-Zuschauer gewinnt');
    pruefe(!discord.gesendet.some(t => t.includes('<@77001>')),
        'er wird NICHT als <@kennung> erwaehnt — das traefe ein fremdes Mitglied');
    pruefe(discord.gesendet.some(t => t.includes('ZuschauerA (Twitch)')),
        'sondern so, wie seine Quelle ihn nennt');
    pruefe(discord.dms.length === 0, 'er bekommt KEINE Direktnachricht');
    pruefe(twitch.verkuendet.includes('77001'), 'stattdessen verkuendet seine Quelle');
    pruefe(daten.geschrieben[0]?.[2] === 'streaming' && daten.geschrieben[0]?.[3] === 'ZuschauerA',
        'Herkunft und Name stehen in der Gewinnerzeile');

    // -----------------------------------------------------------------------
    console.log('\nWenn etwas fehlt oder kaputt ist');
    // -----------------------------------------------------------------------
    LosquellenRegistry.leeren();
    pruefe(LosquellenRegistry.nennung({ quelle: 'streaming', kennung: '77001', name: 'ZuschauerA' })
        === 'ZuschauerA', 'eine unbekannte Quelle ergibt den Namen, nie eine Erwaehnung',
        'Plugin abgeschaltet, seit die Verlosung lief');
    pruefe(!LosquellenRegistry.nennung({ quelle: 'weg', kennung: '9', name: null }).includes('<@'),
        'auch ohne Namen entsteht kein <@…>');

    LosquellenRegistry.register('kaputt', {
        lose: async () => { throw new Error('Datenbank weg'); },
        nennung: (l) => String(l.kennung)
    });
    lage('beide', [{ user_id: '111111111111111111', entry_count: 1 }]);
    const trotzdem = await manager._drawWinners(1, 1);
    pruefe(trotzdem.length === 1, 'eine werfende Quelle verhindert die Ziehung nicht');
    pruefe(protokoll.some(z => z.includes('kaputt')), 'aber sie steht im Protokoll');

    // -----------------------------------------------------------------------
    console.log('\nAusschluss trifft das Los, nicht die Zahl');
    // -----------------------------------------------------------------------
    LosquellenRegistry.leeren();
    LosquellenRegistry.register('streaming', {
        lose: async () => [{ kennung: '111111111111111111', name: 'Namensvetter', anzahl: 1 }],
        nennung: (l) => `${l.name} (Twitch)`
    });
    lage('beide', [{ user_id: '111111111111111111', entry_count: 1 }]);
    const beide = await manager._drawWinners(1, 5, [{ quelle: 'discord', kennung: '111111111111111111' }]);
    pruefe(beide.length === 1 && beide[0].quelle === 'streaming',
        'dieselbe Zahl in zwei Namensraeumen sind zwei Lose',
        'der Discord-Gewinner ist raus, das Twitch-Los nicht');

    // -----------------------------------------------------------------------
    console.log('\nDer Teilnahmeweg wird nicht geraten');
    // -----------------------------------------------------------------------
    const GiveawayManagerKlasse = require('../plugins/giveaway/bot/managers/GiveawayManager');
    const anleger = new GiveawayManagerKlasse(client);

    /**
     * @param {Object} zusatz Angaben zum Weg
     * @returns {Promise<Array>} Die geschriebenen Werte
     */
    async function anlegen(zusatz) {
        daten.angelegt.length = 0;
        // Signatur ist (guildId, channelId, options) - nicht ein Objekt.
        await anleger.createGiveaway('g1', 'k1', { prize: 'P', duration: 3600000, ...zusatz })
            .catch(e => console.log('    [Grund] ' + e.message));
        return daten.angelegt[0] || [];
    }

    let werte = await anlegen({});
    pruefe(werte[15] === 'discord', 'ohne Angabe bleibt es beim Discord-Weg', String(werte[15]));

    werte = await anlegen({ teilnahme: 'beide' });
    pruefe(werte[15] === 'beide', 'ein gueltiger Weg wird uebernommen', String(werte[15]));

    // **Der wichtigste Fall.** Ein kaputtes Formularfeld darf keine Verlosung
    // aufmachen, an der plötzlich jeder im Chat mitmacht.
    werte = await anlegen({ teilnahme: 'irgendwas' });
    pruefe(werte[15] === 'discord', 'ein unbekannter Weg faellt auf discord zurueck, nicht auf beide',
        String(werte[15]));

    werte = await anlegen({ teilnahme: 'stream', streamNurAbonnenten: true });
    pruefe(werte[16] === 1, 'die Abonnenten-Bedingung wird mitgeschrieben', String(werte[16]));

    // -----------------------------------------------------------------------
    console.log('\nHat die Attrappe alles gesehen?');
    // -----------------------------------------------------------------------
    pruefe(unbekannteAbfragen.length === 0, 'keine Abfrage lief an der Attrappe vorbei',
        unbekannteAbfragen.slice(0, 3).join(' | '));

    console.log(`\n${faelle} Faelle, ${abweichungen} Abweichung(en)\n`);
    process.exit(abweichungen ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
