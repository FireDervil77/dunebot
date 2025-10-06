/**
 * DuneMap Admin - Marker-Editor mit Leaflet
 * @author FireDervil
 */

let map;
let markers = [];
let currentMarker = null;
let tempMarker = null;

// Initialisierung nach DOM-Ready
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initEventListeners();
    loadMarkers();
});

/**
 * Leaflet-Karte initialisieren
 */
function initMap() {
    // Karte erstellen (Standard: Zentrum von Deutschland)
    map = L.map('map').setView([51.1657, 10.4515], 6);

    // OpenStreetMap Tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    // Click-Event für neue Marker
    map.on('click', onMapClick);

    // Mousemove für Koordinaten-Anzeige
    map.on('mousemove', (e) => {
        const coordsDisplay = document.getElementById('coordsDisplay');
        if (coordsDisplay) {
            coordsDisplay.textContent = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
        }
    });
}

/**
 * Event-Listener registrieren
 */
function initEventListeners() {
    // Formular Submit
    const markerForm = document.getElementById('markerForm');
    if (markerForm) {
        markerForm.addEventListener('submit', handleMarkerSave);
    }

    // Abbrechen-Button
    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', cancelEditing);
    }

    // Karte zentrieren
    const centerBtn = document.getElementById('centerMapBtn');
    if (centerBtn) {
        centerBtn.addEventListener('click', () => {
            map.setView([51.1657, 10.4515], 6);
        });
    }

    // Farb-Picker Live-Update
    const colorInput = document.getElementById('markerColor');
    const colorDisplay = document.getElementById('colorDisplay');
    if (colorInput && colorDisplay) {
        colorInput.addEventListener('input', (e) => {
            colorDisplay.value = e.target.value;
        });
    }

    // Marker-Liste Click-Events (Event-Delegation)
    const markerList = document.getElementById('markerList');
    if (markerList) {
        markerList.addEventListener('click', (e) => {
            const listItem = e.target.closest('.marker-item');
            if (!listItem) return;

            if (e.target.closest('.edit-marker-btn')) {
                const markerId = listItem.dataset.markerId;
                editMarker(markerId);
            } else if (e.target.closest('.delete-marker-btn')) {
                const markerId = listItem.dataset.markerId;
                deleteMarker(markerId);
            } else {
                // Zoom zur Marker-Position
                const lat = parseFloat(listItem.dataset.lat);
                const lng = parseFloat(listItem.dataset.lng);
                map.setView([lat, lng], 12);
            }
        });
    }
}

/**
 * Marker aus MARKERS_DATA auf Karte laden
 */
function loadMarkers() {
    if (typeof MARKERS_DATA === 'undefined' || !MARKERS_DATA) return;

    MARKERS_DATA.forEach(markerData => {
        addMarkerToMap(markerData);
    });

    // Karte an Marker anpassen (wenn vorhanden)
    if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

/**
 * Marker auf Karte hinzufügen
 */
function addMarkerToMap(markerData) {
    const { id, title, description, latitude, longitude, icon, color } = markerData;

    // Custom HTML-Icon mit FontAwesome
    const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<i class="${icon}" style="color: ${color}; font-size: 2rem; text-shadow: 0 0 3px #000;"></i>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    const marker = L.marker([latitude, longitude], { icon: customIcon })
        .addTo(map)
        .bindPopup(`
            <div class="marker-popup">
                <h6 class="mb-1">${title}</h6>
                ${description ? `<p class="mb-1 small">${description}</p>` : ''}
                <div class="text-muted small">
                    <i class="fa-solid fa-location-dot"></i>
                    ${latitude.toFixed(4)}, ${longitude.toFixed(4)}
                </div>
            </div>
        `);

    marker.markerId = id;
    markers.push(marker);
}

/**
 * Karten-Click: Neuen Marker setzen
 */
function onMapClick(e) {
    // Entferne temporären Marker
    if (tempMarker) {
        map.removeLayer(tempMarker);
    }

    // Temporärer Marker (graue Farbe)
    const tempIcon = L.divIcon({
        className: 'custom-marker',
        html: `<i class="${DEFAULT_ICON}" style="color: #999; font-size: 2rem; text-shadow: 0 0 3px #000;"></i>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    tempMarker = L.marker(e.latlng, { icon: tempIcon }).addTo(map);

    // Editor-Panel öffnen
    showEditor({
        latitude: e.latlng.lat,
        longitude: e.latlng.lng,
        icon: DEFAULT_ICON,
        color: DEFAULT_COLOR
    });
}

/**
 * Editor-Panel anzeigen
 */
function showEditor(data = {}) {
    const editorPanel = document.getElementById('editorPanel');
    const editorTitle = document.getElementById('editorTitle');

    if (data.id) {
        editorTitle.textContent = 'Marker bearbeiten';
    } else {
        editorTitle.textContent = 'Neuen Marker erstellen';
    }

    // Formular füllen
    document.getElementById('markerId').value = data.id || '';
    document.getElementById('markerTitle').value = data.title || '';
    document.getElementById('markerDescription').value = data.description || '';
    document.getElementById('markerLat').value = data.latitude || '';
    document.getElementById('markerLng').value = data.longitude || '';
    document.getElementById('markerIcon').value = data.icon || DEFAULT_ICON;
    document.getElementById('markerColor').value = data.color || DEFAULT_COLOR;
    document.getElementById('colorDisplay').value = data.color || DEFAULT_COLOR;
    document.getElementById('markerCategory').value = data.category || '';

    editorPanel.style.display = 'block';
    editorPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Editor schließen
 */
function cancelEditing() {
    document.getElementById('editorPanel').style.display = 'none';
    document.getElementById('markerForm').reset();

    // Temporären Marker entfernen
    if (tempMarker) {
        map.removeLayer(tempMarker);
        tempMarker = null;
    }
}

/**
 * Marker bearbeiten
 */
function editMarker(markerId) {
    const markerData = MARKERS_DATA.find(m => m.id == markerId);
    if (!markerData) return;

    showEditor(markerData);

    // Zoom zum Marker
    map.setView([markerData.latitude, markerData.longitude], 12);
}

/**
 * Marker speichern (AJAX)
 */
async function handleMarkerSave(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);

    try {
        const response = await fetch(`/guild/${GUILD_ID}/plugins/dunemap/admin/marker`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            showToast('success', result.message);
            
            // Seite neu laden um Marker-Liste zu aktualisieren
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            showToast('error', result.message || 'Fehler beim Speichern');
        }
    } catch (error) {
        showToast('error', 'Netzwerkfehler beim Speichern');
        console.error(error);
    }
}

/**
 * Marker löschen (AJAX)
 */
async function deleteMarker(markerId) {
    if (!confirm('Möchtest du diesen Marker wirklich löschen?')) return;

    try {
        const response = await fetch(`/guild/${GUILD_ID}/plugins/dunemap/admin/marker/${markerId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
            }
        });

        const result = await response.json();

        if (result.success) {
            showToast('success', result.message);
            
            // Marker von Karte entfernen
            const marker = markers.find(m => m.markerId == markerId);
            if (marker) {
                map.removeLayer(marker);
                markers = markers.filter(m => m.markerId != markerId);
            }

            // Marker aus Liste entfernen
            const listItem = document.querySelector(`.marker-item[data-marker-id="${markerId}"]`);
            if (listItem) {
                listItem.remove();
            }

            // Marker-Count aktualisieren
            updateMarkerCount();
        } else {
            showToast('error', result.message || 'Fehler beim Löschen');
        }
    } catch (error) {
        showToast('error', 'Netzwerkfehler beim Löschen');
        console.error(error);
    }
}

/**
 * Marker-Anzahl aktualisieren
 */
function updateMarkerCount() {
    const count = document.querySelectorAll('.marker-item').length;
    document.getElementById('markerCount').textContent = `${count} Marker`;
    document.getElementById('markerListCount').textContent = count;
}

/**
 * Bootstrap Toast anzeigen
 */
function showToast(type, message) {
    // Nutze GuildAjaxHandler falls verfügbar
    if (typeof GuildAjaxHandler !== 'undefined' && GuildAjaxHandler.showToast) {
        GuildAjaxHandler.showToast(type, message);
    } else {
        // Fallback: Alert
        alert(message);
    }
}
