/**
 * Musik - Quellen aufloesen
 *
 * Wandelt das, was jemand in `/play` eingibt, in eine Liste abspielbarer
 * Titel. Die eigentliche Tonspur holt spaeter `strom.js`.
 *
 * Was hier zu wissen ist:
 *
 * - **Spotify liefert keinen Ton.** Ueber die Spotify-API kommen nur
 *   Titel, Kuenstler, Dauer und Bild. Der Bot sucht den Titel danach auf
 *   YouTube und spielt von dort. Genau so arbeiten alle bekannten Musik-Bots.
 * - Bei einer Spotify-Liste mit 50 Titeln waere es unzumutbar, 50 YouTube-
 *   Suchen vor dem ersten Ton zu machen. Deshalb bekommt so ein Titel nur
 *   eine `suchbegriff`-Angabe und wird erst aufgeloest, wenn er an der Reihe
 *   ist (`aufloesenZumAbspielen`).
 * - SoundCloud braucht eine Client-ID. `play-dl` kann sich selbst eine
 *   besorgen; das passiert einmal beim ersten Zugriff.
 * - **Freie Suchbegriffe laufen erst ueber Spotify.** "sandstorm darude"
 *   wird dort zu "Darude - Sandstorm", und erst das geht an die YouTube-
 *   Suche. Ohne Spotify-Zugangsdaten faellt der Schritt lautlos weg und der
 *   Rohtext geht direkt an YouTube.
 *
 * @module music/bot/quellen
 */

const play = require('play-dl');
const { ServiceManager } = require('dunebot-core');

/** Direkte Tonspuren, die `play-dl` gar nicht erst anfasst. */
const DIREKT_ENDUNGEN = /\.(mp3|ogg|opus|m4a|aac|flac|wav|webm)(\?.*)?$/i;

/** Internetradio liefert einen endlosen Datenstrom ohne Dateiendung. */
const RADIO_HINWEISE = /(stream|radio|listen|icecast|shoutcast|:\d{4,5}\/)/i;

let soundcloudBereit = false;
let spotifyBereit = false;

/**
 * SoundCloud einmalig freischalten.
 *
 * `play-dl` holt sich eine oeffentliche Client-ID. Klappt das nicht, bleibt
 * SoundCloud eben aus - der Rest funktioniert weiter.
 *
 * @returns {Promise<boolean>} Ob SoundCloud nutzbar ist
 */
async function soundcloudVorbereiten() {
    if (soundcloudBereit) return true;

    try {
        const id = await play.getFreeClientID();
        await play.setToken({ soundcloud: { client_id: id } });
        soundcloudBereit = true;
        return true;
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] SoundCloud nicht verfuegbar: ${err.message}`);
        return false;
    }
}

/**
 * Spotify freischalten, sofern Zugangsdaten hinterlegt sind.
 *
 * Ohne `SPOTIFY_CLIENT_ID` und `SPOTIFY_CLIENT_SECRET` in der Umgebung bleibt
 * Spotify aus. Der Bot sagt das dann auch statt still nichts zu tun.
 *
 * @returns {Promise<boolean>} Ob Spotify nutzbar ist
 */
async function spotifyVorbereiten() {
    const id = process.env.SPOTIFY_CLIENT_ID;
    const geheimnis = process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !geheimnis) return false;

    try {
        if (!spotifyBereit) {
            await play.setToken({
                spotify: {
                    client_id: id,
                    client_secret: geheimnis,
                    refresh_token: process.env.SPOTIFY_REFRESH_TOKEN || '',
                    market: process.env.SPOTIFY_MARKET || 'DE'
                }
            });
            spotifyBereit = true;
        }
        // Der Zugang laeuft nach einer Stunde ab
        if (play.is_expired()) await play.refreshToken();
        return true;
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Spotify nicht verfuegbar: ${err.message}`);
        spotifyBereit = false;
        return false;
    }
}

/**
 * Einen Titel in die Form bringen, die Warteschlange und Verlauf erwarten.
 *
 * @param {Object} roh Rohdaten
 * @returns {Object} Titel
 */
function titel(roh) {
    return {
        title: roh.title || 'Unbekannter Titel',
        url: roh.url || null,
        source: roh.source,
        durationSec: roh.durationSec || null,
        thumbnail: roh.thumbnail || null,
        artist: roh.artist || null,
        // Nur gesetzt, wenn die Adresse erst beim Abspielen gesucht wird
        suchbegriff: roh.suchbegriff || null,
        // Bei Spotify die urspruengliche Adresse, sonst dieselbe wie url
        herkunftUrl: roh.herkunftUrl || roh.url || null,
        requestedBy: roh.requestedBy || null
    };
}

/** Sekunden aus einer Millisekunden-Angabe, ohne Nachkommastellen. */
const sekunden = (ms) => (ms ? Math.round(ms / 1000) : null);

/** Aus einem YouTube-Video einen Titel machen. */
function ausYouTubeVideo(video, angefordertVon) {
    return titel({
        title: video.title,
        url: video.url,
        source: 'youtube',
        durationSec: video.durationInSec || null,
        thumbnail: video.thumbnails?.[video.thumbnails.length - 1]?.url || null,
        artist: video.channel?.name || null,
        requestedBy: angefordertVon
    });
}

/**
 * Text auf das Vergleichbare herunterbrechen.
 *
 * Kleinschreibung, Umlaute aufgeloest, Satzzeichen weg - damit
 * "Björk – Army Of Me (Remaster)" und "bjoerk army of me" zusammenfinden.
 *
 * @param {string} text Beliebiger Text
 * @returns {Array<string>} Einzelne Woerter
 * @private
 */
function woerter(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
}

/**
 * Passt der Spotify-Treffer ueberhaupt zur Anfrage?
 *
 * Der Wachhund gegen stille Vertauschungen: Wer "bohemian rhapsody muse
 * cover" sucht, soll nicht Queens Original bekommen, nur weil Spotify das
 * fuer den bekannteren Titel haelt. Spotify darf den Wunsch praezisieren,
 * nicht ersetzen.
 *
 * @param {string} anfrage Was jemand eingegeben hat
 * @param {string} kandidat Kuenstler und Titel des Spotify-Treffers
 * @returns {boolean} Ob der Treffer uebernommen werden darf
 * @private
 */
function aehnlichGenug(anfrage, kandidat) {
    const gesucht = woerter(anfrage);
    if (gesucht.length === 0) return false;

    const gefunden = new Set(woerter(kandidat));
    const gedeckt = gesucht.filter(w => gefunden.has(w)).length;

    // Zwei Drittel der eingegebenen Woerter muessen im Treffer vorkommen.
    // Ein einzelnes Wort mehr in der Anfrage ("live", "cover", "remix") kippt
    // das Ergebnis damit, und genau so soll es sein.
    return gedeckt / gesucht.length >= 0.67;
}

/**
 * Einen freien Suchbegriff ueber Spotify aufraeumen.
 *
 * Wer "sandstorm darude" tippt, meint "Darude - Sandstorm". Spotify kennt
 * Kuenstler, Titel und Dauer sauber getrennt; YouTube-Titel dagegen tragen
 * Zusaetze wie "(Official Video)" oder "[4K Remaster]" mit sich herum.
 * Deshalb fragen wir erst Spotify und schicken erst das aufgeraeumte
 * Ergebnis an die YouTube-Suche.
 *
 * Spotify liefert weiterhin keinen Ton - nur die Angaben.
 *
 * @param {string} text Der eingegebene Suchbegriff
 * @param {Object} e Einstellungen der Guild
 * @returns {Promise<Object|null>} Aufgeraeumte Angaben oder null
 * @private
 */
async function ueberSpotifyVerfeinern(text, e) {
    // Ausdrueckliches Abschalten gilt auch fuer die reine Abfrage von Angaben
    if (e.allow_spotify === false) return null;
    // Ohne Zugangsdaten passiert hier gar nichts - dann bleibt es beim rohen Begriff
    if (!(await spotifyVorbereiten())) return null;

    try {
        const treffer = await play.search(text, { limit: 1, source: { spotify: 'track' } });
        const s = treffer?.[0];
        if (!s || !s.name) return null;

        const kuenstler = (s.artists || []).map(a => a.name).join(', ');
        const voll = kuenstler ? `${kuenstler} ${s.name}` : s.name;

        if (!aehnlichGenug(text, voll)) return null;

        return {
            suchbegriff: voll,
            title: kuenstler ? `${kuenstler} - ${s.name}` : s.name,
            artist: kuenstler || null,
            durationSec: s.durationInSec || sekunden(s.durationInMs),
            thumbnail: s.thumbnail?.url || null
        };
    } catch (err) {
        // Verfeinern ist Kuer - faellt sie aus, sucht YouTube eben mit dem Rohtext
        ServiceManager.get('Logger').debug(`[Musik] Spotify-Verfeinerung fuer "${text}" fehlgeschlagen: ${err.message}`);
        return null;
    }
}

/**
 * Eingabe aufloesen.
 *
 * @param {string} eingabe Adresse oder Suchbegriff
 * @param {Object} optionen { angefordertVon, einstellungen }
 * @returns {Promise<{titel: Array, quelle: string, hinweis: string|null}>}
 */
async function aufloesen(eingabe, optionen = {}) {
    const Logger = ServiceManager.get('Logger');
    const angefordertVon = optionen.angefordertVon || null;
    const e = optionen.einstellungen || {};
    const text = String(eingabe || '').trim();

    if (!text) return { titel: [], quelle: 'leer', hinweis: 'KEINE_EINGABE' };

    // --- Direkte Tonspur oder Internetradio ---
    // `play-dl` meldet dafuer schlicht `false`, also pruefen wir selbst.
    if (/^https?:\/\//i.test(text) && (DIREKT_ENDUNGEN.test(text) || RADIO_HINWEISE.test(text))) {
        if (e.allow_direct === false) return { titel: [], quelle: 'direct', hinweis: 'QUELLE_AUS' };

        const istRadio = !DIREKT_ENDUNGEN.test(text);
        return {
            quelle: 'direct',
            hinweis: null,
            titel: [titel({
                title: istRadio ? 'Internetradio' : decodeURIComponent(text.split('/').pop().split('?')[0]),
                url: text,
                source: 'direct',
                // Radio laeuft endlos - keine Dauer angeben
                durationSec: null,
                requestedBy: angefordertVon
            })]
        };
    }

    let art;
    try {
        art = await play.validate(text);
    } catch {
        art = false;
    }

    // --- SoundCloud ---
    if (art === false && /soundcloud\.com/i.test(text)) {
        if (await soundcloudVorbereiten()) {
            try {
                art = await play.validate(text);
            } catch {
                art = false;
            }
        }
    }

    try {
        // --- YouTube: einzelnes Video ---
        if (art === 'yt_video') {
            if (e.allow_youtube === false) return { titel: [], quelle: 'youtube', hinweis: 'QUELLE_AUS' };
            const info = await play.video_info(text);
            return { titel: [ausYouTubeVideo(info.video_details, angefordertVon)], quelle: 'youtube', hinweis: null };
        }

        // --- YouTube: Wiedergabeliste ---
        if (art === 'yt_playlist') {
            if (e.allow_youtube === false) return { titel: [], quelle: 'youtube', hinweis: 'QUELLE_AUS' };
            const liste = await play.playlist_info(text, { incomplete: true });
            const videos = await liste.all_videos();
            return {
                quelle: 'youtube',
                hinweis: null,
                titel: videos.map(v => ausYouTubeVideo(v, angefordertVon))
            };
        }

        // --- SoundCloud ---
        if (art === 'so_track' || art === 'so_playlist') {
            if (e.allow_soundcloud === false) return { titel: [], quelle: 'soundcloud', hinweis: 'QUELLE_AUS' };
            if (!(await soundcloudVorbereiten())) {
                return { titel: [], quelle: 'soundcloud', hinweis: 'SOUNDCLOUD_UNVERFUEGBAR' };
            }

            const ergebnis = await play.soundcloud(text);

            if (art === 'so_playlist') {
                const spuren = await ergebnis.all_tracks();
                return {
                    quelle: 'soundcloud',
                    hinweis: null,
                    titel: spuren.map(s => titel({
                        title: s.name,
                        url: s.url,
                        source: 'soundcloud',
                        durationSec: sekunden(s.durationInMs),
                        thumbnail: s.thumbnail || null,
                        artist: s.user?.name || null,
                        requestedBy: angefordertVon
                    }))
                };
            }

            return {
                quelle: 'soundcloud',
                hinweis: null,
                titel: [titel({
                    title: ergebnis.name,
                    url: ergebnis.url,
                    source: 'soundcloud',
                    durationSec: sekunden(ergebnis.durationInMs),
                    thumbnail: ergebnis.thumbnail || null,
                    artist: ergebnis.user?.name || null,
                    requestedBy: angefordertVon
                })]
            };
        }

        // --- Spotify: liefert nur Angaben, keinen Ton ---
        if (art === 'sp_track' || art === 'sp_album' || art === 'sp_playlist') {
            if (e.allow_spotify === false) return { titel: [], quelle: 'spotify', hinweis: 'QUELLE_AUS' };
            if (!(await spotifyVorbereiten())) {
                return { titel: [], quelle: 'spotify', hinweis: 'SPOTIFY_UNVERFUEGBAR' };
            }

            const ergebnis = await play.spotify(text);

            /** Aus einem Spotify-Titel einen noch nicht aufgeloesten Eintrag machen. */
            const ausSpotify = (s) => {
                const kuenstler = (s.artists || []).map(a => a.name).join(', ');
                return titel({
                    title: kuenstler ? `${kuenstler} - ${s.name}` : s.name,
                    // Bewusst leer: die YouTube-Adresse wird erst gesucht,
                    // wenn der Titel an der Reihe ist.
                    url: null,
                    suchbegriff: kuenstler ? `${kuenstler} ${s.name}` : s.name,
                    source: 'spotify',
                    durationSec: s.durationInSec || sekunden(s.durationInMs),
                    thumbnail: s.thumbnail?.url || null,
                    artist: kuenstler || null,
                    herkunftUrl: s.url,
                    requestedBy: angefordertVon
                });
            };

            if (art === 'sp_track') {
                return { titel: [ausSpotify(ergebnis)], quelle: 'spotify', hinweis: null };
            }

            const spuren = await ergebnis.all_tracks();
            return { titel: spuren.map(ausSpotify), quelle: 'spotify', hinweis: null };
        }

        // --- Suchbegriff: erst bei Spotify aufraeumen, dann auf YouTube nachschlagen ---
        if (e.allow_youtube === false) return { titel: [], quelle: 'youtube', hinweis: 'QUELLE_AUS' };

        const verfeinert = await ueberSpotifyVerfeinern(text, e);
        if (verfeinert) {
            Logger.debug(`[Musik] "${text}" ueber Spotify praezisiert zu "${verfeinert.suchbegriff}"`);
        }

        const treffer = await play.search(verfeinert ? verfeinert.suchbegriff : text, {
            limit: 1,
            source: { youtube: 'video' }
        });
        if (!treffer || treffer.length === 0) {
            return { titel: [], quelle: 'suche', hinweis: 'NICHTS_GEFUNDEN' };
        }

        const gefunden = ausYouTubeVideo(treffer[0], angefordertVon);

        // Die Angaben von Spotify sind die besseren: sauber getrennter
        // Kuenstler, Titel ohne "(Official Video)", verlaessliche Dauer.
        // Die Adresse bleibt die von YouTube - von dort kommt der Ton.
        if (verfeinert) {
            gefunden.title = verfeinert.title;
            gefunden.artist = verfeinert.artist || gefunden.artist;
            gefunden.durationSec = verfeinert.durationSec || gefunden.durationSec;
            gefunden.thumbnail = verfeinert.thumbnail || gefunden.thumbnail;
        }

        return { titel: [gefunden], quelle: 'youtube', hinweis: null };

    } catch (err) {
        Logger.error(`[Musik] Aufloesen von "${text}" fehlgeschlagen:`, err);
        return { titel: [], quelle: String(art || 'unbekannt'), hinweis: 'AUFLOESEN_FEHLGESCHLAGEN' };
    }
}

/**
 * Einen Titel abspielbereit machen.
 *
 * Bei Spotify steht hier noch keine Adresse - erst jetzt wird auf YouTube
 * gesucht. Alle anderen Titel gehen unveraendert durch.
 *
 * @param {Object} t Titel aus `aufloesen`
 * @returns {Promise<Object|null>} Titel mit Adresse, oder null wenn nichts zu finden war
 */
async function aufloesenZumAbspielen(t) {
    if (t.url) return t;
    if (!t.suchbegriff) return null;

    try {
        const treffer = await play.search(t.suchbegriff, { limit: 1, source: { youtube: 'video' } });
        if (!treffer || treffer.length === 0) return null;

        return {
            ...t,
            url: treffer[0].url,
            durationSec: t.durationSec || treffer[0].durationInSec || null,
            thumbnail: t.thumbnail || treffer[0].thumbnails?.[treffer[0].thumbnails.length - 1]?.url || null
        };
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Suche nach "${t.suchbegriff}" fehlgeschlagen: ${err.message}`);
        return null;
    }
}

/**
 * Fuer Autoplay einen passenden naechsten Titel finden.
 *
 * YouTube liefert ueber `play-dl` keine verwandten Videos mehr - das Feld
 * `related_videos` kommt seit einer Umstellung leer zurueck. Deshalb suchen
 * wir stattdessen nach Kuenstler beziehungsweise Titel und nehmen den ersten
 * Treffer, der nicht gerade schon lief.
 *
 * @param {Object} letzter Der zuletzt gelaufene Titel
 * @param {Array<string>} gemieden Adressen, die nicht nochmal kommen sollen
 * @returns {Promise<Object|null>} Titel oder null
 */
async function aehnlichenFinden(letzter, gemieden = []) {
    if (!letzter) return null;

    // Der Kuenstler traegt weiter als der volle Titel, der oft Zusaetze wie
    // "(Official Video)" enthaelt.
    const begriff = letzter.artist
        ? `${letzter.artist} mix`
        : String(letzter.title || '').replace(/\(.*?\)|\[.*?\]/g, '').trim();

    if (!begriff) return null;

    try {
        const treffer = await play.search(begriff, { limit: 10, source: { youtube: 'video' } });
        if (!treffer || treffer.length === 0) return null;

        const gemiedenMenge = new Set(gemieden.filter(Boolean));
        const passend = treffer.find(v => v.url && !gemiedenMenge.has(v.url));
        if (!passend) return null;

        return ausYouTubeVideo(passend, letzter.requestedBy);
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Autoplay-Suche fehlgeschlagen: ${err.message}`);
        return null;
    }
}

module.exports = {
    aufloesen, aufloesenZumAbspielen, aehnlichenFinden,
    soundcloudVorbereiten, spotifyVorbereiten,
    // Nach aussen nur zum Pruefen - der Suchweg benutzt sie selbst
    aehnlichGenug, ueberSpotifyVerfeinern
};
