'use strict';

/**
 * Logging: Discord-Ereignisse (Termine, 3.11; LG-1b Teil 2, K382, 2026-11-16).
 *
 * `guildScheduledEventCreate/Update/Delete/UserAdd/UserRemove` (Intent
 * GuildScheduledEvents seit G-13). Name, Ort, Zeiten, Kanal, Art und Status;
 * die Beschreibung bleibt draußen (freier Text des Anlegers). Ein
 * Statuswechsel ist eine eigene Art (gestartet, beendet, abgesagt).
 *
 * Termine der Plugins (G-19, `kern.termin.*`) kommen später als Fachereignisse
 * über LG-1e, nicht hier.
 *
 * @module logging/bot/termine
 */

const { GuildScheduledEventStatus } = require('discord.js');
const { erfasse, nameVon } = require('./erfasser');
const V = require('../shared/vergleich');

const FELDER = ['name', 'start', 'ende', 'kanal', 'ort', 'typ', 'sichtbarkeit'];
const iso = (t) => (t ? new Date(t).toISOString() : null);

const STATUS_ART = {
    [GuildScheduledEventStatus.Active]: 'termin.gestartet',
    [GuildScheduledEventStatus.Completed]: 'termin.beendet',
    [GuildScheduledEventStatus.Canceled]: 'termin.abgesagt',
};

function werte(e) {
    return {
        name: e?.name ?? null, start: iso(e?.scheduledStartTimestamp), ende: iso(e?.scheduledEndTimestamp),
        kanal: e?.channelId ?? null, ort: e?.entityMetadata?.location ?? null, typ: e?.entityType ?? null,
        sichtbarkeit: e?.privacyLevel ?? null, status: e?.status ?? null,
    };
}

const objekt = (e) => ({ typ: 'termin', id: e.id, name: e.name });

function angelegt(e) {
    return [{ art: 'termin.angelegt', schwere: 'info', akteur: e.creatorId || null, zuordnung: 'sicher',
        kanal: e.channelId || null, objekt: objekt(e), nachher: werte(e) }];
}

function geloescht(e) {
    return [{ art: 'termin.geloescht', schwere: 'info', kanal: e.channelId || null, objekt: objekt(e), vorher: werte(e) }];
}

function geaendert(alt, neu) {
    if (!alt) return [];
    const aus = [];
    if (alt.status !== neu.status && STATUS_ART[neu.status]) {
        aus.push({ art: STATUS_ART[neu.status], schwere: 'info', kanal: neu.channelId || null, objekt: objekt(neu),
            vorher: { status: alt.status ?? null }, nachher: { status: neu.status ?? null } });
    }
    const d = V.unterschied(werte(alt), werte(neu), FELDER);
    if (d) aus.push({ art: 'termin.geaendert', schwere: 'info', kanal: neu.channelId || null, objekt: objekt(neu), ...d });
    return aus;
}

function interesse(e, user, dabei) {
    if (!user?.id) return [];
    return [{ art: dabei ? 'termin.interessiert' : 'termin.nicht_interessiert', schwere: 'info',
        akteur: user.id, zuordnung: 'sicher', betroffen: user.id, kanal: e.channelId || null, objekt: objekt(e) }];
}

async function melde(guildId, ereignisse, user) {
    const n = nameVon(user);
    const kontext = { kanaele: [], akteurIstBot: Boolean(user?.bot), namen: n ? [n] : [] };
    await Promise.all(ereignisse.map((e) => erfasse(guildId, e, { ...kontext, kanaele: e.kanal ? [String(e.kanal)] : [] })));
}

module.exports = { angelegt, geloescht, geaendert, interesse, melde };
