/**
 * Coriolis Storm Konfiguration
 * 
 * Basisdaten für die wöchentlichen Coriolis-Stürme in Dune: Awakening
 * Referenzdatum: Montag, 23. Juni 2025
 * 
 * @module coriolisStormConfig
 * @author FireBot Team
 */

/**
 * Referenz-Montag für die Storm-Berechnung
 * Jeder Montag ist ein Storm-Reset-Tag
 * @constant {Date}
 */
const REFERENCE_MONDAY = new Date('2025-06-23T00:00:00Z');

/**
 * Storm-Timings für alle Server-Regionen
 * Offizielle Daten vom Dune: Awakening Discord Bot (Peter APP)
 * 
 * Jede Region hat einen 10-Stunden Storm-Zyklus
 * Start: Montag oder Dienstag (je nach Region)
 * Reset: 7 Tage später
 * 
 * WICHTIG: Zeiten sind in UTC gespeichert!
 * 
 * @constant {Object}
 */
const STORM_TIMINGS = {
    EU: {
        displayName: 'Europe',
        displayNameShort: 'EU',
        // Montag 19:00 CEST = Montag 17:00 UTC
        startHourUTC: 17,
        startMinuteUTC: 0,
        startDayOffset: 0,  // Montag
        // Dienstag 05:00 CEST = Dienstag 03:00 UTC
        endHourUTC: 3,
        endMinuteUTC: 0,
        endDayOffset: 1,    // Dienstag (nächster Tag)
        timezone: 'Europe/Berlin',
        localStartTime: '19:00',
        localEndTime: '05:00',
        flag: '🇪🇺'
    },
    NA: {
        displayName: 'North America',
        displayNameShort: 'NA',
        // Dienstag 02:00 EDT = Dienstag 06:00 UTC
        startHourUTC: 6,
        startMinuteUTC: 0,
        startDayOffset: 1,  // Dienstag
        // Dienstag 12:00 EDT = Dienstag 16:00 UTC
        endHourUTC: 16,
        endMinuteUTC: 0,
        endDayOffset: 1,    // Dienstag (selber Tag)
        timezone: 'America/New_York',
        localStartTime: '02:00',
        localEndTime: '12:00',
        flag: '��'
    },
    SA: {
        displayName: 'South America',
        displayNameShort: 'SA',
        // Dienstag 00:00 BRT = Dienstag 03:00 UTC
        startHourUTC: 3,
        startMinuteUTC: 0,
        startDayOffset: 1,  // Dienstag
        // Dienstag 10:00 BRT = Dienstag 13:00 UTC
        endHourUTC: 13,
        endMinuteUTC: 0,
        endDayOffset: 1,    // Dienstag (selber Tag)
        timezone: 'America/Sao_Paulo',
        localStartTime: '00:00',
        localEndTime: '10:00',
        flag: '��'
    },
    AS: {
        displayName: 'Asia',
        displayNameShort: 'AS',
        // Montag 13:00 CST = Montag 05:00 UTC
        startHourUTC: 5,
        startMinuteUTC: 0,
        startDayOffset: 0,  // Montag
        // Montag 23:00 CST = Montag 15:00 UTC
        endHourUTC: 15,
        endMinuteUTC: 0,
        endDayOffset: 0,    // Montag (selber Tag)
        timezone: 'Asia/Shanghai',
        localStartTime: '13:00',
        localEndTime: '23:00',
        flag: '🇨🇳'
    },
    OCE: {
        displayName: 'Oceania',
        displayNameShort: 'OCE',
        // Montag 11:00 NZDT = Sonntag 22:00 UTC
        startHourUTC: 22,
        startMinuteUTC: 0,
        startDayOffset: -1, // Sonntag (Tag VOR Montag!)
        // Montag 21:00 NZDT = Montag 08:00 UTC
        endHourUTC: 8,
        endMinuteUTC: 0,
        endDayOffset: 0,    // Montag
        timezone: 'Pacific/Auckland',
        localStartTime: '11:00',
        localEndTime: '21:00',
        flag: '🇦🇺'
    }
};

/**
 * Storm-Dauer in Tagen (6-Tage-Zyklus, Reset jeden Montag)
 * @constant {number}
 */
const STORM_CYCLE_DAYS = 7; // 7 Tage = wöchentlich

/**
 * Berechnet das nächste Storm-Start-Datum für eine Region
 * Basierend auf wöchentlichem Reset-Zyklus (jeden Montag/Dienstag je nach Region)
 * 
 * @param {string} region - Region-Code (EU, NA, SA, AS, OCE)
 * @param {Date} [fromDate=new Date()] - Ausgangsdatum für Berechnung
 * @returns {Object} { nextStormStart: Date, nextStormEnd: Date, daysUntil, hoursUntil, minutesUntil, isActive }
 * @author FireBot Team
 */
function getNextStormTiming(region, fromDate = new Date()) {
    const config = STORM_TIMINGS[region];
    if (!config) {
        throw new Error(`Unknown region: ${region}`);
    }

    const now = new Date(fromDate);
    const nowUTC = now.getTime();
    
    // Finde nächsten Montag in UTC
    const dayOfWeek = now.getUTCDay(); // 0 = Sonntag, 1 = Montag
    let daysUntilMonday;
    
    if (dayOfWeek === 0) {
        daysUntilMonday = 1; // Sonntag → Montag
    } else if (dayOfWeek === 1) {
        daysUntilMonday = 0; // Schon Montag, prüfen wir später ob Storm vorbei ist
    } else {
        daysUntilMonday = (8 - dayOfWeek); // Di-Sa → nächster Montag
    }
    
    // Berechne Storm-Start (Montag + dayOffset)
    let nextStormStart = new Date(now);
    nextStormStart.setUTCDate(now.getUTCDate() + daysUntilMonday + config.startDayOffset);
    nextStormStart.setUTCHours(config.startHourUTC, config.startMinuteUTC, 0, 0);
    
    // Berechne Storm-End
    let nextStormEnd = new Date(now);
    nextStormEnd.setUTCDate(now.getUTCDate() + daysUntilMonday + config.endDayOffset);
    nextStormEnd.setUTCHours(config.endHourUTC, config.endMinuteUTC, 0, 0);
    
    // Wenn Storm-Start in der Vergangenheit liegt, nimm nächste Woche
    if (nextStormStart.getTime() <= nowUTC) {
        nextStormStart.setUTCDate(nextStormStart.getUTCDate() + 7);
        nextStormEnd.setUTCDate(nextStormEnd.getUTCDate() + 7);
    }
    
    // Berechne Countdown
    const msUntilStorm = nextStormStart.getTime() - nowUTC;
    const daysUntil = Math.floor(msUntilStorm / (1000 * 60 * 60 * 24));
    const hoursUntil = Math.floor((msUntilStorm % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutesUntil = Math.floor((msUntilStorm % (1000 * 60 * 60)) / (1000 * 60));
    
    // Prüfe ob Storm gerade aktiv ist
    const isActive = nowUTC >= nextStormStart.getTime() - (7 * 24 * 60 * 60 * 1000) && 
                     nowUTC <= nextStormEnd.getTime() - (7 * 24 * 60 * 60 * 1000);
    
    return {
        nextStormStart,
        nextStormEnd,
        daysUntil,
        hoursUntil,
        minutesUntil,
        isActive,
        config
    };
}

/**
 * Gibt alle verfügbaren Regionen zurück
 * @returns {Array<string>} Region-Codes
 */
function getAvailableRegions() {
    return Object.keys(STORM_TIMINGS);
}

/**
 * Gibt Region-Config zurück
 * @param {string} region - Region-Code
 * @returns {Object} Storm-Config für die Region
 */
function getRegionConfig(region) {
    return STORM_TIMINGS[region] || null;
}

module.exports = {
    REFERENCE_MONDAY,
    STORM_TIMINGS,
    STORM_CYCLE_DAYS,
    getNextStormTiming,
    getAvailableRegions,
    getRegionConfig
};
