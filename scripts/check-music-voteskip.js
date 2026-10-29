#!/usr/bin/env node
/**
 * `/music voteskip` stimmt immer ab (Betreiber 2026-10-29, F26).
 *
 * Die DJ-Rolle gilt für die Grundsteuerung (play, skip, shuffle, loop …).
 * Vorher übersprang voteskip sofort, wer steuern darf — und ohne DJ-Rolle darf
 * das jeder, also wurde nie abgestimmt. Geprüft wird der echte Befehl mit
 * Attrappen für utils und Einstellungen, dazu die echte Zählung aus GuildPlayer.
 *
 *   node scripts/check-music-voteskip.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const WURZEL = path.join(__dirname, '..');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

const BEFEHL = path.join(WURZEL, 'plugins/music/bot/commands/sub/_voteskip.js');
const UTILS = path.join(WURZEL, 'plugins/music/bot/utils.js');
const MODELLE = path.join(WURZEL, 'plugins/music/shared/models/index.js');

let einstellungen = { vote_skip_enabled: true, vote_skip_percent: 50, dj_role_id: null };
let darf = true;
let uebersprungen = 0;
const stimmen = new Set();
const abspieler = {
    aktuell: { title: 'Titel' },
    ueberspringen: () => { uebersprungen++; },
    // Die echte Zählung aus GuildPlayer, nicht nachgebaut.
    abstimmen: (id, zuhoerer, prozent) => require(path.join(WURZEL, 'plugins/music/bot/managers/GuildPlayer.js'))
        .prototype.abstimmen.call({ stimmen }, id, zuhoerer, prozent),
};
require.cache[UTILS] = { id: UTILS, filename: UTILS, loaded: true, exports: {
    antwort: (text, art) => ({ text, art }),
    titelZeile: (t) => t.title,
    pruefen: async () => ({ ok: true, abspieler, manager: { darfSteuern: async () => darf } }),
} };
require.cache[MODELLE] = { id: MODELLE, filename: MODELLE, loaded: true, exports: {
    MusicSettings: { getSettings: async () => einstellungen },
} };

const mitglied = (id, menschen) => ({
    id, guild: { id: 'g1' },
    voice: { channel: { members: { filter: () => ({ size: menschen }) } } },
});

(async () => {
    const voteskip = require(BEFEHL);
    console.log('\n/music voteskip (F26)');

    await pruefe('ohne DJ-Rolle (jeder darf steuern) wird trotzdem abgestimmt', async () => {
        stimmen.clear(); uebersprungen = 0; darf = true;
        const r = await voteskip(mitglied('a', 4));
        assert.strictEqual(uebersprungen, 0, 'sofort übersprungen statt abgestimmt');
        assert.match(r.text, /Stimme gezählt: \*\*1\/2\*\*/);
        await voteskip(mitglied('b', 4));
        assert.strictEqual(uebersprungen, 1, 'mit genug Stimmen wird übersprungen');
    });

    await pruefe('allein im Kanal reicht die eigene Stimme', async () => {
        stimmen.clear(); uebersprungen = 0;
        const r = await voteskip(mitglied('a', 1));
        assert.strictEqual(uebersprungen, 1);
        assert.match(r.text, /Genug Stimmen \(\*\*1\/1\*\*\)/);
    });

    await pruefe('doppelt gestimmt zählt einmal; abgeschaltet heißt abgeschaltet', async () => {
        stimmen.clear(); uebersprungen = 0;
        await voteskip(mitglied('a', 5));
        const r = await voteskip(mitglied('a', 5));
        assert.match(r.text, /schon gestimmt/);
        assert.strictEqual(uebersprungen, 0);
        einstellungen = { ...einstellungen, vote_skip_enabled: false };
        const aus = await voteskip(mitglied('c', 5));
        assert.match(aus.text, /abgeschaltet/);
        einstellungen = { ...einstellungen, vote_skip_enabled: true };
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ voteskip stimmt immer ab');
    process.exit(fehler ? 1 : 0);
})();
