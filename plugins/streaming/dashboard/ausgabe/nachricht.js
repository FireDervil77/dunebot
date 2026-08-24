'use strict';

/**
 * Streaming - wie eine Ankuendigung aussieht.
 *
 * Reine Funktionen: Werte herein, fertige Discord-Nutzlast heraus. Kein
 * Datenbankzugriff, kein Versand - das macht sie pruefbar und haelt das
 * Aussehen an einer Stelle.
 *
 * **Warum die Erwaehnung im Klartext steht und nicht im Embed:** Discord loest
 * Erwaehnungen **innerhalb eines Embeds nicht als Benachrichtigung aus**. Eine
 * Rollen-Erwaehnung, die nur im Embed steht, sieht aus wie ein Ping und ist
 * keiner - ein Fehler, den man im Betrieb kaum findet, weil die Nachricht ja
 * richtig aussieht.
 *
 * Der Aufbau ist festgelegt (docs/streamer-plugin/FUNKTIONSUMFANG.md,
 * Abschnitt 2) und nicht frei formatierbar. Wer das oeffnet, baut einen
 * Embed-Editor - und der ist ein eigenes Vorhaben.
 *
 * @module streaming/dashboard/ausgabe/nachricht
 */

const { parsePlaceholders } = require('dunebot-core/lib/PlaceholderParser');

/** Farben je Plattform. */
const FARBEN = { twitch: 0x9146FF, kick: 0x53FC18, youtube: 0xFF0000 };

/** Die Rueckschau ist bewusst stumpf - sie soll nicht mehr nach "jetzt" aussehen. */
const FARBE_VORBEI = 0x6C757D;

// Die Vorgabetexte stehen bei den uebrigen Vorlagenregeln, damit Router,
// Ausgabe und Pruefskript dieselben lesen.
const { VORGABE_LIVE: VORGABE_VORLAGE, VORGABE_RUECKSCHAU } = require('../../shared/vorlagen');

/**
 * Adresse des Kanals bei der Plattform.
 *
 * @param {string} plattform Plattform
 * @param {string} login Kanalname
 * @returns {string} Adresse
 */
function kanalAdresse(plattform, login) {
    switch (plattform) {
        case 'kick':    return `https://kick.com/${login}`;
        case 'youtube': return `https://youtube.com/@${login}`;
        default:        return `https://twitch.tv/${login}`;
    }
}

/**
 * Dauer in Klartext: "2 h 14 min".
 *
 * @param {Date|string|null} von Beginn
 * @param {Date|string|null} bis Ende
 * @returns {string|null} Klartext oder null
 */
function dauerText(von, bis) {
    if (!von) return null;
    const a = new Date(von).getTime();
    const b = bis ? new Date(bis).getTime() : Date.now();
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;

    const min = Math.round((b - a) / 60000);
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * Platzhalter der Vorlage fuellen.
 *
 * Nutzt den **gemeinsamen** Parser aus dunebot-core mit seinem `extra`-Kanal
 * statt einer eigenen Kopie. (Dass `greeting` eine wortgleiche Kopie fuehrt,
 * ist ein eigener Befund - siehe Baustelle 63d.)
 *
 * @param {string} vorlage Reintext mit Platzhaltern
 * @param {Object} werte Werte
 * @returns {string} gefuellter Text
 */
function textFuellen(vorlage, werte) {
    return parsePlaceholders(String(vorlage || VORGABE_VORLAGE), { extra: werte }).trim();
}

/**
 * Die Ankuendigung, waehrend gesendet wird.
 *
 * @param {Object} daten Alles, was gebraucht wird
 * @param {Object} daten.streamer { plattform, login, anzeigename, avatar_url }
 * @param {Object} daten.zustand { titel, kategorie, zuschauer, vorschaubild, begonnen_am }
 * @param {Object} daten.ziel { rolle_id, vorlage, onair_channel, eigenes_bild }
 *   `vorlage` ist bereits aufgeloest - der Aufrufer entscheidet, ob die eigene
 *   Vorlage des Ziels oder der Standard der Guild gilt.
 * @returns {{content: string, embeds: Array, components: Array}} Discord-Nutzlast
 */
function live({ streamer, zustand = {}, ziel = {} }) {
    const url = kanalAdresse(streamer.plattform, streamer.login);
    const name = streamer.anzeigename || streamer.login;
    const erwaehnung = ziel.rolle_id ? `<@&${ziel.rolle_id}>` : '';

    const content = textFuellen(ziel.vorlage, {
        streamer: name,
        titel: zustand.titel || '',
        kategorie: zustand.kategorie || '',
        url,
        zuschauer: zustand.zuschauer ?? '',
        rolle: erwaehnung,
        plattform: streamer.plattform === 'twitch' ? 'Twitch'
                 : streamer.plattform === 'kick' ? 'Kick' : 'YouTube',
        dauer: ''
    });

    const felder = [];
    if (zustand.kategorie)              felder.push({ name: 'Kategorie', value: String(zustand.kategorie), inline: true });
    if (typeof zustand.zuschauer === 'number') felder.push({ name: 'Zuschauer', value: String(zustand.zuschauer), inline: true });

    const embed = {
        color: FARBEN[streamer.plattform] ?? FARBEN.twitch,
        author: { name, url, icon_url: streamer.avatar_url || undefined },
        // Ohne Titel bleibt das Feld leer statt "undefined" - die Anreicherung
        // holt ihn Sekunden spaeter nach.
        title: zustand.titel || name,
        url,
        fields: felder,
        image: (ziel.eigenes_bild || zustand.vorschaubild)
            ? { url: ziel.eigenes_bild || zustand.vorschaubild }
            : undefined,
        footer: { text: `${streamer.plattform === 'twitch' ? 'Twitch' : streamer.plattform}` },
        timestamp: zustand.begonnen_am ? new Date(zustand.begonnen_am).toISOString() : undefined
    };

    // **Nur ein Knopf, und zwar bewusst.**
    //
    // Hier stand bis zum 2026-08-24 ein zweiter Knopf "Beitreten" auf den
    // On-Air-Sprachkanal (K-1). Das war falsch verstanden: Der On-Air-Kanal ist
    // in einem echten Streaming-Discord **privat** - er gehoert der Rolle, die
    // nur wer mitstreamt bekommt. Ein Knopf dorthin steht in einer
    // oeffentlichen Ankuendigung und fuehrt fuer fast jeden ins Leere; er laedt
    // zum Mitreden ein, wo niemand mitreden soll.
    //
    // `ziel.onair_channel` wird weiter gespeichert - es wird fuer die
    // Live-Rolle gebraucht (Stufe 9). Es wirkt nur nicht mehr in der
    // Ankuendigung. `scripts/check-streaming-vorlagen.js` haelt das fest, damit
    // der Knopf nicht unbemerkt zurueckkommt.
    const knoepfe = [{ type: 2, style: 5, label: 'Zum Stream', url }];

    return { content, embeds: [embed], components: [{ type: 1, components: knoepfe }] };
}

/**
 * Dieselbe Nachricht nach dem Streamende - als Rueckschau.
 *
 * Kein Ping mehr (die Erwaehnung faellt weg), stumpfe Farbe, Dauer, und der
 * Link zur Aufzeichnung, falls es schon einen gibt.
 *
 * @param {Object} daten wie bei live(), zusaetzlich vodUrl
 * @returns {{content: string, embeds: Array, components: Array}} Discord-Nutzlast
 */
function rueckschau({ streamer, zustand = {}, ziel = {}, vodUrl = null }) {
    const url = kanalAdresse(streamer.plattform, streamer.login);
    const name = streamer.anzeigename || streamer.login;
    const dauer = dauerText(zustand.begonnen_am, zustand.beendet_am);

    const felder = [];
    if (dauer)             felder.push({ name: 'Dauer', value: dauer, inline: true });
    if (zustand.kategorie) felder.push({ name: 'Kategorie', value: String(zustand.kategorie), inline: true });
    if (vodUrl)            felder.push({ name: 'Aufzeichnung', value: `[ansehen](${vodUrl})`, inline: true });

    const embed = {
        color: FARBE_VORBEI,
        author: { name, url, icon_url: streamer.avatar_url || undefined },
        title: zustand.titel ? `war live: ${zustand.titel}` : `${name} war live`,
        url,
        fields: felder,
        footer: { text: `${streamer.plattform === 'twitch' ? 'Twitch' : streamer.plattform}` }
    };

    const knoepfe = [{ type: 2, style: 5, label: vodUrl ? 'Aufzeichnung' : 'Zum Kanal', url: vodUrl || url }];

    // Die Erwaehnung faellt weg: Eine bearbeitete Nachricht pingt zwar nicht
    // erneut, aber der Text soll auch nicht mehr danach aussehen. `{rolle}`
    // wird deshalb mit Leer gefuellt, nicht stehengelassen.
    const content = textFuellen(ziel.vorlage_rueckschau || VORGABE_RUECKSCHAU, {
        streamer: name,
        titel: zustand.titel || '',
        kategorie: zustand.kategorie || '',
        url,
        zuschauer: '',
        rolle: '',
        plattform: streamer.plattform === 'twitch' ? 'Twitch'
                 : streamer.plattform === 'kick' ? 'Kick' : 'YouTube',
        dauer: dauer || 'unbekannt lange'
    });

    return {
        content,
        embeds: [embed],
        components: [{ type: 1, components: knoepfe }]
    };
}

module.exports = { FARBEN, FARBE_VORBEI, VORGABE_VORLAGE, VORGABE_RUECKSCHAU, kanalAdresse, dauerText, textFuellen, live, rueckschau };
