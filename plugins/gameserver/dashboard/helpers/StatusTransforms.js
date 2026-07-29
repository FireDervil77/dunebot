/**
 * StatusTransforms – benannte Funktionen für die deklarative Query-Aufbereitung
 *
 * Das Addon sagt über `game_data.status.query`, *welche* Regeln greifen; hier steht,
 * *wie* sie arbeiten. Nur diese Namen sind erlaubt – ein Addon kann also keinen
 * beliebigen Code ausführen, egal wer es in den Marketplace lädt.
 *
 * @module helpers/StatusTransforms
 * @author FireBot Team
 */

'use strict';

/** @private – liest "raw.id" oder "score" aus einem Spieler-Objekt */
function pick(obj, path) {
    return String(path).split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/** @private – Tags kommen je nach Spiel als String oder Array */
function tagsOf(state) {
    const raw = state?.raw?.tags;
    if (Array.isArray(raw)) return raw.join(',');
    return typeof raw === 'string' ? raw : '';
}

// ============================================================================
// Filter: entfernen Spieler aus der Liste
// ============================================================================
const FILTERS = {
    /** Spieler mit bestimmten Namen entfernen (z.B. GOTV-Bot bei CS2) */
    drop_players_named(result, _state, args = {}) {
        const names = new Set(args.names || []);
        result.players = result.players.filter(p => !names.has(p.name));
    },

    /**
     * Phantom-Einträge entfernen: kein Name, Score 0, keine Spielzeit.
     * Source-Server melden solche Platzhalter während Spielerwechseln.
     */
    drop_empty_players(result) {
        result.players = result.players.filter(p =>
            !(!p.name && p.score === 0 && (p.time === 0 || p.time == null))
        );
    },
};

// ============================================================================
// Transforms: verändern Felder des Ergebnisses
// ============================================================================
const TRANSFORMS = {
    /** Minecraft-Farbcodes (§a, §l …) entfernen */
    strip_color_codes(value) {
        return typeof value === 'string' ? value.replace(/§[0-9a-fk-or]/gi, '') : value;
    },

    /** Leeren Namen durch "<prefix> <n>" ersetzen (Valheim liefert keine Namen) */
    fallback_name(value, { index, args }) {
        return value || `${args.prefix || 'Spieler'} ${index + 1}`;
    },

    /** Wert aus einem anderen Feld desselben Spielers übernehmen (ARK: Level = Score) */
    copy_from(_value, { player, args }) {
        return pick(player, args.from);
    },

    /** Avatar-URL aus einer Spieler-UUID bauen */
    crafthead_avatar(_value, { player, args }) {
        const id = pick(player, args.from || 'raw.id');
        return id ? `https://crafthead.net/avatar/${id}/32` : null;
    },
};

// ============================================================================
// Extras: spielspezifische Zusatzwerte (Badges, Flags)
// ============================================================================
const EXTRAS = {
    /** true, wenn die Server-Tags einen bestimmten Eintrag enthalten */
    tag_contains(result, state, args = {}) {
        return tagsOf(state).includes(args.tag);
    },

    /** Erste Regex-Gruppe aus den Server-Tags (z.B. Rust-Wipe "born1712345678") */
    tag_match(result, state, args = {}) {
        const m = tagsOf(state).match(new RegExp(args.pattern));
        return m ? (m[1] ?? m[0]) : null;
    },

    /** Reine Versionsnummer aus dem Versionsstring ziehen */
    version_number(result, state) {
        const m = (state?.raw?.version || state?.version || '').match(/[\d.]+/);
        return m ? m[0] : null;
    },

    /**
     * Bot-Anzahl ohne die genannten Namen.
     * GOTV läuft bei CS2 als Bot mit, ist aber keiner.
     */
    count_without_named(result, state, args = {}) {
        const names = new Set(args.names || []);
        const bots = state?.bots || [];
        return Math.max(0, bots.length - bots.filter(b => names.has(b.name)).length);
    },
};

/**
 * Wendet die Regeln eines Addons auf das Abfrageergebnis an.
 *
 * @param {object} result - normalisiertes Ergebnis (wird verändert)
 * @param {object} state  - Roh-Antwort von GameDig
 * @param {object} queryConfig - aufgelöster status.query-Block
 * @param {object} [Logger]
 */
function applyQueryRules(result, state, queryConfig, Logger = null) {
    const warn = (msg) => Logger?.warn?.(`[StatusTransforms] ${msg}`);

    for (const rule of queryConfig.filters || []) {
        const fn = FILTERS[rule.fn];
        if (!fn) { warn(`Unbekannter Filter "${rule.fn}" – übersprungen`); continue; }
        try { fn(result, state, rule.args || {}); }
        catch (err) { warn(`Filter "${rule.fn}" fehlgeschlagen: ${err.message}`); }
    }

    for (const rule of queryConfig.transforms || []) {
        const fn = TRANSFORMS[rule.fn];
        if (!fn) { warn(`Unbekannte Transformation "${rule.fn}" – übersprungen`); continue; }
        try {
            const match = /^players\[\]\.(.+)$/.exec(rule.field || '');
            if (match) {
                const field = match[1];
                result.players = result.players.map((player, index) => ({
                    ...player,
                    [field]: fn(player[field], { player, index, args: rule.args || {}, result, state }),
                }));
            } else {
                result[rule.field] = fn(result[rule.field], { index: 0, args: rule.args || {}, result, state });
            }
        } catch (err) {
            warn(`Transformation "${rule.fn}" fehlgeschlagen: ${err.message}`);
        }
    }

    for (const rule of queryConfig.extras || []) {
        const fn = EXTRAS[rule.fn];
        if (!fn) { warn(`Unbekannte Extra-Regel "${rule.fn}" – übersprungen`); continue; }
        try {
            const value = fn(result, state, rule.args || {});
            // "bots" ist ein Feld des Ergebnisses, alles andere landet unter extra
            if (rule.key === 'bots') result.bots = value;
            else result.extra[rule.key] = value;
        } catch (err) {
            warn(`Extra-Regel "${rule.fn}" fehlgeschlagen: ${err.message}`);
        }
    }
}

module.exports = { applyQueryRules, FILTERS, TRANSFORMS, EXTRAS };
