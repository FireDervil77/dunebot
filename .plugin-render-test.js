#!/usr/bin/env node
/**
 * Rendert die Seiten eines umgebauten Plugins wirklich durch - einmal mit
 * gefuellten, einmal mit leeren Daten. Kompilieren sagt nichts darueber, ob
 * eine Schleife ueber `undefined` laeuft.
 *
 * Aufruf: node .plugin-render-test.js <plugin>
 */
'use strict';
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const plugin = process.argv[2];
if (!plugin) { console.error('Plugin angeben'); process.exit(1); }

const VIEWS = path.join(__dirname, 'plugins', plugin, 'dashboard/views/guild');
const guildId = '123456789';
const tr = (k, o) => { let s = k.split(':').pop(); if (o) for (const [n, v] of Object.entries(o)) s += ` ${n}=${v}`; return s; };

const kanaele = [{ id: '111', name: 'allgemein', parentName: null }, { id: '222', name: 'team', parentName: 'Intern' }];
const rollen = [{ id: '900', name: 'Moderator' }, { id: '901', name: 'Admin' }];

const FAELLE = {
  moderation: {
    'moderation-dashboard.ejs': {
      voll: {
        guildId, tr,
        settings: { modlog_channel: '111', max_warn_limit: 5, max_warn_action: 'KICK' },
        channels: kanaele,
        letzteFaelle: [{ case_number: 7, type: 'WARN', member_id: '5', created_at: new Date() }],
        zaehler: [{ type: 'WARN', anzahl: 4 }, { type: 'BAN', anzahl: 1 }],
        anzahl: { faelleGesamt: 42, geschuetzteRollen: 2, kanalregeln: 3, notizen: 9 }
      },
      leer: {
        guildId, tr, settings: {}, channels: [], letzteFaelle: [], zaehler: [],
        anzahl: { faelleGesamt: 0, geschuetzteRollen: 0, kanalregeln: 0, notizen: 0 }
      }
    },
    'moderation-settings.ejs': {
      voll: {
        guildId, tr, channels: kanaele,
        settings: {
          modlog_channel: '111', max_warn_limit: 5, max_warn_action: 'KICK',
          modlog_events: '["WARN","BAN"]', dm_on_warn: 1, dm_on_kick: 0, dm_on_ban: 1,
          dm_on_timeout: 1, default_reason: 'Regelverstoss', dm_embed_description: 'Hallo'
        }
      },
      leer: { guildId, tr, channels: [], settings: {} }
    },
    'moderation-logs.ejs': {
      voll: {
        guildId, tr, art: 'WARN',
        faelle: [{ case_number: 7, type: 'WARN', member_id: '5', admin_id: '6', reason: 'Spam', created_at: new Date() }],
        seiten: { aktuell: 2, proSeite: 25, gesamt: 60, anzahl: 3 }
      },
      leer: { guildId, tr, art: null, faelle: [], seiten: { aktuell: 1, proSeite: 25, gesamt: 0, anzahl: 0 } }
    },
    'moderation-notes.ejs': {
      voll: { guildId, tr, notizen: [{ id: 1, user_id: '5', note: 'Vorsicht', author_id: '6', created_at: new Date() }] },
      leer: { guildId, tr, notizen: [] }
    },
    'moderation-channel-rules.ejs': {
      voll: {
        guildId, tr, channels: kanaele,
        kanalregeln: [{ id: 1, channel_id: '111', max_warn_limit: 3, max_warn_action: 'KICK', automod_exempt: 1, notes: 'Testkanal' }]
      },
      leer: { guildId, tr, channels: [], kanalregeln: [] }
    },
    'moderation-protected.ejs': {
      voll: { guildId, tr, roles: rollen, geschuetzteRollen: [{ role_id: '900', created_at: new Date() }] },
      leer: { guildId, tr, roles: [], geschuetzteRollen: [] }
    }
  }
};

const faelle = FAELLE[plugin];
if (!faelle) { console.error(`Keine Testdaten fuer ${plugin}`); process.exit(1); }

let fehler = 0;
for (const [datei, varianten] of Object.entries(faelle)) {
  for (const [name, kontext] of Object.entries(varianten)) {
    const p = path.join(VIEWS, datei);
    try {
      const html = ejs.render(fs.readFileSync(p, 'utf8'), kontext, { filename: p });
      const auf = (html.match(/<div\b/g) || []).length;
      const zu = (html.match(/<\/div>/g) || []).length;
      const bilanz = auf === zu ? '' : `  ⚠ Div-Bilanz ${auf}/${zu}`;
      console.log(`OK      ${datei} (${name})${bilanz}`);
      if (auf !== zu) fehler++;
    } catch (e) {
      console.log(`FEHLER  ${datei} (${name}): ${e.message.split('\n')[0]}`);
      fehler++;
    }
  }
}
process.exit(fehler ? 1 : 0);
