'use strict';

/**
 * Wie ein Image-Tag zu lesen ist — an EINER Stelle (2026-10-09).
 *
 * `images/bauen.sh` (Daemon-Repo) vergibt zwei Sorten Tags je Bau:
 *
 *   2026.10, 2026.10-GE-Proton10-32    die KALENDERFASSUNG: der Name dieses
 *                                      Standes. Sie steht im Paket, neben dem
 *                                      Digest, und im Etikett des Images.
 *   latest, latest-GE-Proton10-32      der NEUESTE Bau dieser Ausprägung. Der
 *                                      Tag wandert mit jedem Bau.
 *
 * Die Ausprägung (GE-Proton10-32, 8) gehört zur Wahl des Images: proton
 * GE-Proton10-32 und GE-Proton11-5 sind zwei Images, nicht zwei Stände von
 * einem. Der Monat gehört NICHT zur Wahl — er ist nur der Name eines Standes.
 *
 * Gebraucht von der Werkbank (eine Sitzung fragt den neuesten Bau) und von der
 * Image-Übersicht im Adminbereich (gibt es zu einem Paket einen neueren Bau?).
 * Zwei Fassungen dieser Regeln wären zwei Wahrheiten darüber, was „dasselbe
 * Image" heisst.
 */

const RE_KALENDERTAG = /^\d{4}\.\d{2}(?:-(.+))?$/;
const RE_NEUESTER_TAG = /^latest(?:-(.+))?$/;

/** Die Ausprägung eines Tags ('' = keine) — null, wenn er weder Kalenderfassung noch „latest" ist. */
function imageVariante(tag) {
    const t = String(tag || '');
    const m = RE_KALENDERTAG.exec(t) || RE_NEUESTER_TAG.exec(t);
    return m ? (m[1] || '') : null;
}

/** Der Tag des neuesten Baus derselben Ausprägung. Ein Tag anderer Art bleibt, wie er ist. */
function neuesterTag(tag) {
    const v = imageVariante(tag);
    if (v === null) return tag;
    return v ? `latest-${v}` : 'latest';
}

/** Ist das eine Kalenderfassung (2026.10, 2026.10-8) — also ein Name, der ins Paket darf? */
function istKalendertag(tag) { return RE_KALENDERTAG.test(String(tag || '')); }

/** Wie ein Image auf der Seite heisst: „steamcmd", „proton GE-Proton10-32" — ohne Monat, er wechselt. */
function imageName(image) {
    const kurz = String(image?.ref || '').replace(/^.*\//, '');
    const v = imageVariante(image?.tag);
    if (v === null) return kurz + (image?.tag ? `:${image.tag}` : '');
    return v ? `${kurz} ${v}` : kurz;
}

/**
 * Löst eine neuere Ausprägung die des Pakets ab? (2026-10-15)
 *
 * Anlass: Enshrouded brauchte GE-Proton11-9 statt 10-32 („No SteamUtils011").
 * Für die Wahl sind das zwei Images — ein Umzug fragte nur `latest-GE-Proton10-32`
 * und blieb dort. Die Regel:
 *
 *   Genommen wird der ZULETZT GEBAUTE `latest…`-Tag desselben Images (Daemon,
 *   `image.auspraegungen`, nach Baudatum) — nicht die höchste Nummer: In der
 *   Registry liegt ein `latest-GE-Proton11-5` vom August, das auf Debian 12 nie
 *   lief. Er löst nur ab, wenn sein Bau es SAGT (`auspraegung: nachfolge`,
 *   Etikett im Image). dotnet 8 und 9 sind eine Wahl und tragen es nicht.
 *
 * @param {string} tag  Tag des Pakets (2026.10-GE-Proton10-32)
 * @param {object[]} auspraegungen  [{ tag, variante, digest, fassung, gebaut, art, fehler }]
 * @returns {{von: string, nach: string, tag: string, fassung: string|null, digest: string|null}|null}
 */
function nachfolger(tag, auspraegungen) {
    const von = imageVariante(tag);
    if (!von) return null;   // ohne Ausprägung gibt es nichts abzulösen
    const gebaut = (auspraegungen || []).filter(a => a && !a.fehler && a.gebaut && a.variante)
        .sort((a, b) => String(b.gebaut).localeCompare(String(a.gebaut)));
    const neu = gebaut[0];
    if (!neu || neu.art !== 'nachfolge' || neu.variante === von) return null;
    return { von, nach: neu.variante, tag: neu.tag, fassung: neu.fassung || null, digest: neu.digest || null };
}

module.exports = { imageVariante, neuesterTag, istKalendertag, imageName, nachfolger };
