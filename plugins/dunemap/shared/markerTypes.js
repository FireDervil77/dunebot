/**
 * Zentrale Definition aller verfügbaren Marker-Typen für DuneMap
 * Wird von Bot, Dashboard und MapGenerator verwendet
 * 
 * @author firedervil
 */

const MARKER_TYPES = [
    { id: 'titan', name: 'Titan', category: 'resources', color: '#FFC107' },
    { id: 'spice', name: 'Spice', category: 'resources', color: '#FF9800' },
    { id: 'stravidium', name: 'Stravidium', category: 'resources', color: '#9C27B0' },
    { id: 'aluminium', name: 'Aluminium', category: 'resources', color: '#607D8B' },
    { id: 'eisen', name: 'Eisen', category: 'resources', color: '#795548' },
    { id: 'basalt', name: 'Basalt', category: 'other', color: '#424242' },
    { id: 'karbon', name: 'Karbon', category: 'other', color: '#212121' },
    { id: 'hoele', name: 'Höhle', category: 'other', color: '#5D4037' },
    { id: 'hole', name: 'Loch', category: 'other', color: '#3E2723' },
    { id: 'base', name: 'Basis', category: 'tactical', color: '#4CAF50' },
    { id: 'wrack', name: 'Wrack', category: 'tactical', color: '#F44336' },
    { id: 'kontrollpunkt', name: 'Kontrollpunkt', category: 'tactical', color: '#2196F3' },
    { id: 'taxi', name: 'Taxi', category: 'tactical', color: '#FFEB3B' },
    { id: 'test', name: 'Test', category: 'other', color: '#E91E63' }
];

/**
 * Gruppiert Marker-Typen nach Kategorie
 * @returns {Object} { resources: [], tactical: [], other: [] }
 */
function getMarkerTypesByCategory() {
    return {
        resources: MARKER_TYPES.filter(m => m.category === 'resources'),
        tactical: MARKER_TYPES.filter(m => m.category === 'tactical'),
        other: MARKER_TYPES.filter(m => m.category === 'other')
    };
}

/**
 * Holt einen Marker-Typ nach ID
 * @param {string} id - Marker-ID (z.B. 'titan')
 * @returns {Object|null} Marker-Type-Objekt oder null
 */
function getMarkerTypeById(id) {
    return MARKER_TYPES.find(m => m.id === id.toLowerCase()) || null;
}

/**
 * Liste aller verfügbaren Marker-IDs
 * @returns {string[]} Array von IDs
 */
function getMarkerTypeIds() {
    return MARKER_TYPES.map(m => m.id);
}

module.exports = {
    MARKER_TYPES,
    getMarkerTypesByCategory,
    getMarkerTypeById,
    getMarkerTypeIds
};
