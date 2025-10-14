/**
 * DuneMap Admin - Interaktive Sektor-Karte
 * Client-Side JavaScript für Marker-Verwaltung
 * @author FireDervil
 */

(function() {
  'use strict';
  
  console.log('[DuneMap] 🚀 Script geladen!');
  
  // Prüfe ob Daten via AssetManager localize verfügbar sind
  const DATA = window.dunemap_admin_data_data || null;
  
  if (DATA) {
    console.log('[DuneMap] ✅ AssetManager-Daten gefunden!', {
      guildId: DATA.guildId,
      markers: DATA.markers.length,
      ajaxUrl: DATA.ajaxUrl
    });
  }
  
  // Warte auf DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  function init() {
    console.log('[DuneMap] ✅ Initialisierung gestartet');
    
    const grid = document.getElementById('sectorGrid');
    if (!grid) {
      // Kein Fehler loggen, da Script auf allen Seiten geladen wird
      console.log('[DuneMap] ℹ️ Grid nicht auf dieser Seite (normal für Nicht-Admin-Seiten)');
      return;
    }
    
    // Daten aus AssetManager ODER Fallback zu data-Attributen
    const GUILD_ID = DATA?.guildId || grid.dataset.guildId;
    const markers = DATA?.markers || JSON.parse(grid.dataset.markers || '[]');
    const AJAX_URL = DATA?.ajaxUrl || `/guild/${GUILD_ID}/plugins/dunemap/admin/marker`;
    
    console.log('[DuneMap] Guild ID:', GUILD_ID);
    console.log('[DuneMap] Marker:', markers.length);
    console.log('[DuneMap] Ajax URL:', AJAX_URL);
    
    const sectorCells = document.querySelectorAll('.sector-cell');
    console.log('[DuneMap] Sector Cells:', sectorCells.length);
    
    let currentSectorX = null;
    let currentSectorY = null;
    
    // Click-Handler für Sektoren
    sectorCells.forEach(cell => {
      cell.addEventListener('click', function() {
        const sectorX = this.dataset.sectorX;
        const sectorY = parseInt(this.dataset.sectorY);
        
        console.log('[DuneMap] 🖱️ Sektor geklickt:', sectorX + sectorY);
        openEditor(sectorX, sectorY);
      });
      
      // Hover-Effekte
      cell.addEventListener('mouseenter', function() {
        const hasMarkers = this.querySelector('img');
        this.style.borderColor = hasMarkers ? '#17a2b8' : '#007bff';
        this.style.transform = 'scale(1.05)';
      });
      
      cell.addEventListener('mouseleave', function() {
        const hasMarkers = this.querySelector('img');
        const isPvE = ['A','B','C','D','E'].includes(this.dataset.sectorX);
        this.style.borderColor = isPvE ? '#28a745' : '#dee2e6';
        this.style.transform = 'scale(1)';
      });
    });
    
    // Editor öffnen
    function openEditor(sectorX, sectorY) {
      currentSectorX = sectorX;
      currentSectorY = sectorY;
      
      const sectorId = sectorX + sectorY;
      document.getElementById('currentSector').textContent = sectorId;
      document.getElementById('markerEditor').style.display = 'block';
      
      loadSectorMarkers(sectorX, sectorY);
    }
    
    // Marker für Sektor laden
    function loadSectorMarkers(sectorX, sectorY) {
      const sectorMarkers = markers.filter(m => m.sector_x === sectorX && m.sector_y === sectorY);
      const markerList = document.getElementById('markerList');
      
      if (sectorMarkers.length === 0) {
        markerList.innerHTML = '<p class="text-muted small">Keine Marker</p>';
      } else {
        markerList.innerHTML = sectorMarkers.map(m => `
          <div class="d-flex align-items-center justify-content-between mb-2 p-2 bg-light rounded">
            <div class="d-flex align-items-center gap-2">
              <img src="/assets/plugins/dunemap/icons/${m.marker_type}.png" style="width: 24px; height: 24px;">
              <small><strong>${m.marker_type}</strong></small>
            </div>
            <button class="btn btn-danger btn-sm" onclick="window.removeMarker(${m.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        `).join('');
      }
      
      // Add-Button Status
      const addBtn = document.getElementById('addMarkerBtn');
      addBtn.disabled = sectorMarkers.length >= 6;
      
      if (sectorMarkers.length >= 6) {
        addBtn.innerHTML = '<i class="fa-solid fa-ban me-1"></i>Limit erreicht (6/6)';
      } else {
        addBtn.innerHTML = `<i class="fa-solid fa-plus me-1"></i>Marker hinzufügen (${sectorMarkers.length}/6)`;
      }
    }
    
    // Custom Marker Select Dropdown
    const markerSelectDisplay = document.getElementById('markerSelectDisplay');
    const markerSelectDropdown = document.getElementById('markerSelectDropdown');
    const markerTypeInput = document.getElementById('markerTypeSelect');
    const markerOptions = document.querySelectorAll('.marker-option');
    
    if (!markerSelectDisplay || !markerSelectDropdown || !markerTypeInput) {
      console.error('[DuneMap] Custom Dropdown Elemente nicht gefunden!');
      return;
    }
    
    // Toggle Dropdown
    markerSelectDisplay.addEventListener('click', function(e) {
      e.stopPropagation();
      const isActive = markerSelectDropdown.style.display === 'block';
      markerSelectDropdown.style.display = isActive ? 'none' : 'block';
      markerSelectDisplay.classList.toggle('active', !isActive);
    });
    
    // Select Option
    markerOptions.forEach(option => {
      option.addEventListener('click', function() {
        const value = this.dataset.value;
        const icon = this.querySelector('img').cloneNode(true);
        const text = this.querySelector('span').textContent;
        
        // Update hidden input
        markerTypeInput.value = value;
        
        // Update display
        markerSelectDisplay.innerHTML = '';
        markerSelectDisplay.appendChild(icon);
        const textSpan = document.createElement('span');
        textSpan.textContent = text;
        markerSelectDisplay.appendChild(textSpan);
        const chevron = document.createElement('i');
        chevron.className = 'fa-solid fa-chevron-down float-end mt-1';
        markerSelectDisplay.appendChild(chevron);
        
        // Highlight selected option
        markerOptions.forEach(opt => opt.classList.remove('selected'));
        this.classList.add('selected');
        
        // Close dropdown
        markerSelectDropdown.style.display = 'none';
        markerSelectDisplay.classList.remove('active');
        
        // Trigger change event
        const event = new Event('change');
        markerTypeInput.dispatchEvent(event);
      });
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
      if (!markerSelectDisplay.contains(e.target) && !markerSelectDropdown.contains(e.target)) {
        markerSelectDropdown.style.display = 'none';
        markerSelectDisplay.classList.remove('active');
      }
    });
    
    // Marker-Typ Auswahl (behält die alte Logik für Icon-Vorschau)
    markerTypeInput.addEventListener('change', function() {
      const iconPreview = document.getElementById('iconPreview');
      const previewImg = document.getElementById('previewImg');
      const addBtn = document.getElementById('addMarkerBtn');
      
      if (this.value) {
        previewImg.src = `/assets/plugins/dunemap/icons/${this.value}.png`;
        previewImg.alt = this.value;
        iconPreview.style.display = 'block';
        addBtn.disabled = false;
      } else {
        iconPreview.style.display = 'none';
        addBtn.disabled = true;
      }
    });
    
    // Marker hinzufügen
    document.getElementById('addMarkerBtn').addEventListener('click', async function() {
      const markerType = document.getElementById('markerTypeSelect').value;
      if (!markerType || !currentSectorX || !currentSectorY) return;
      
      try {
        const response = await fetch(AJAX_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add',
            sectorX: currentSectorX,
            sectorY: currentSectorY,
            markerType: markerType
          })
        });
        
        const result = await response.json();
        if (result.success) {
          showToast('success', result.message || DATA?.i18n?.markerAdded || 'Marker added!');
          
          // Marker zur lokalen Liste hinzufügen (statt Reload)
          if (result.marker) {
            markers.push(result.marker);
            
            // Grid-Zelle aktualisieren
            const cell = document.querySelector(`[data-sector-x="${currentSectorX}"][data-sector-y="${currentSectorY}"]`);
            if (cell) {
              const img = document.createElement('img');
              img.src = `/assets/plugins/dunemap/icons/${result.marker.marker_type}.png`;
              img.alt = result.marker.marker_type;
              img.style.cssText = 'width: 32px; height: 32px; object-fit: contain;';
              cell.appendChild(img);
            }
            
            // Editor aktualisieren
            loadSectorMarkers(currentSectorX, currentSectorY);
          } else {
            // Fallback: Reload wenn Server keinen Marker zurückgibt
            setTimeout(() => location.reload(), 500);
          }
        } else {
          showToast('danger', result.message || DATA?.i18n?.errorAdd || 'Error adding marker');
        }
      } catch (error) {
        console.error('[DuneMap] Fehler:', error);
        showToast('danger', DATA?.i18n?.networkError || 'Network error');
      }
    });
    
    // Marker entfernen (global für inline onclick)
    window.removeMarker = async function(markerId) {
      const confirmMsg = DATA?.i18n?.confirmDelete || 'Really remove this marker?';
      if (!confirm(confirmMsg)) return;
      
      try {
        const response = await fetch(AJAX_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'remove',
            markerId: markerId
          })
        });
        
        const result = await response.json();
        if (result.success) {
          const successMsg = DATA?.i18n?.markerRemoved || 'Marker removed!';
          showToast('success', result.message || successMsg);
          
          // Marker aus lokaler Liste entfernen (statt Reload)
          const markerIndex = markers.findIndex(m => m.id === markerId);
          if (markerIndex > -1) {
            const removedMarker = markers[markerIndex];
            markers.splice(markerIndex, 1);
            
            // Grid-Zelle komplett neu rendern mit allen verbleibenden Markern
            const cell = document.querySelector(`[data-sector-x="${removedMarker.sector_x}"][data-sector-y="${removedMarker.sector_y}"]`);
            if (cell) {
              // Alle Marker-Bilder aus der Zelle entfernen
              const existingMarkers = cell.querySelectorAll('img');
              existingMarkers.forEach(img => img.remove());
              
              // Verbleibende Marker für diesen Sektor finden und neu rendern
              const sectorMarkers = markers.filter(m => 
                m.sector_x === removedMarker.sector_x && 
                m.sector_y === removedMarker.sector_y
              );
              
              // Alle verbleibenden Marker wieder einfügen
              sectorMarkers.forEach(marker => {
                const img = document.createElement('img');
                img.src = `/assets/plugins/dunemap/icons/${marker.marker_type}.png`;
                img.alt = marker.marker_type;
                img.style.cssText = 'width: 32px; height: 32px; object-fit: contain;';
                cell.appendChild(img);
              });
            }
            
            // Editor aktualisieren wenn noch offen
            if (currentSectorX && currentSectorY) {
              loadSectorMarkers(currentSectorX, currentSectorY);
            }
          } else {
            // Fallback: Reload
            setTimeout(() => location.reload(), 500);
          }
        } else {
          const errorMsg = DATA?.i18n?.errorRemove || 'Error removing marker';
          showToast('danger', result.message || errorMsg);
        }
      } catch (error) {
        console.error('[DuneMap] Fehler:', error);
        showToast('danger', DATA?.i18n?.networkError || 'Network error');
      }
    };
    
    // Editor schließen
    document.getElementById('closeEditorBtn').addEventListener('click', function() {
      document.getElementById('markerEditor').style.display = 'none';
      markerTypeInput.value = '';
      document.getElementById('iconPreview').style.display = 'none';
      
      // Reset Custom Dropdown
      markerSelectDisplay.innerHTML = '<span class="placeholder-text">' + 
        (DATA?.i18n?.selectType || 'Marker-Typ wählen') + 
        '</span><i class="fa-solid fa-chevron-down float-end mt-1"></i>';
      markerOptions.forEach(opt => opt.classList.remove('selected'));
    });
    
    // Coriolis Storm Timer
    let stormTimerData = null;
    
    /**
     * Lädt Storm-Timer-Daten vom Backend
     * @returns {Promise<void>}
     */
    async function loadStormTimerData() {
      try {
        const guildId = DATA?.guildId || window.location.pathname.split('/')[2];
        const response = await fetch(`/guild/${guildId}/plugins/dunemap/api/storm-timer`);
        const data = await response.json();
        
        if (data.success) {
          stormTimerData = data;
          console.log('[DuneMap] Storm-Timer-Daten geladen:', data);
        } else {
          console.error('[DuneMap] Storm-Timer-API Fehler:', data.message);
        }
      } catch (error) {
        console.error('[DuneMap] Fehler beim Laden der Storm-Timer-Daten:', error);
      }
    }
    
    /**
     * Aktualisiert den Storm-Timer basierend auf Region-Config
     */
    function updateStormTimer() {
      if (!stormTimerData) {
        console.warn('[DuneMap] Keine Storm-Timer-Daten verfügbar');
        return;
      }
      
      const now = new Date();
      // WICHTIG: Zähle zum Storm-ENDE (Reset-Zeit), nicht zum START!
      const nextStormEnd = new Date(stormTimerData.stormData.nextStormEnd);
      const timeUntilStorm = nextStormEnd - now;
      
      // Berechne Tage, Stunden, Minuten
      const daysUntil = Math.floor(timeUntilStorm / (1000 * 60 * 60 * 24));
      const hoursUntil = Math.floor((timeUntilStorm % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutesUntil = Math.floor((timeUntilStorm % (1000 * 60 * 60)) / (1000 * 60));
      const secondsUntil = Math.floor((timeUntilStorm % (1000 * 60)) / 1000);
      
      // Update Countdown
      const countdownEl = document.getElementById('countdown');
      if (countdownEl) {
        // Format: "5d 0h 24m 12s"
        const parts = [];
        if (daysUntil > 0) parts.push(`${daysUntil}d`);
        if (hoursUntil > 0 || daysUntil > 0) parts.push(`${hoursUntil}h`);
        parts.push(`${minutesUntil}m`);
        parts.push(`${String(secondsUntil).padStart(2, '0')}s`);
        
        countdownEl.textContent = parts.join(' ');
      }
      
      // Update Region-Name
      const regionNameEl = document.getElementById('storm-region-name');
      if (regionNameEl && stormTimerData.regionConfig) {
        const config = stormTimerData.regionConfig;
        regionNameEl.textContent = `${config.flag} ${config.displayName}`;
      }
      
      // Update Storm-Zeit
      const stormTimeEl = document.getElementById('storm-time');
      if (stormTimeEl && stormTimerData.regionConfig) {
        const config = stormTimerData.regionConfig;
        stormTimeEl.textContent = `${config.localStartTime} - ${config.localEndTime}`;
      }
      
      // Wenn Storm aktiv ist, Badge anzeigen
      const badgeEl = document.getElementById('storm-active-badge');
      if (badgeEl) {
        if (stormTimerData.stormData.isActive) {
          badgeEl.style.display = 'inline-block';
          badgeEl.textContent = '⚡ AKTIV';
        } else {
          badgeEl.style.display = 'none';
        }
      }
    }
    
    // Storm Timer initialisieren
    loadStormTimerData().then(() => {
      updateStormTimer();
      setInterval(updateStormTimer, 1000); // Jede Sekunde aktualisieren
    });

    
    // Toast Helper
    function showToast(type, message) {
      if (typeof GuildAjaxHandler !== 'undefined') {
        GuildAjaxHandler.showToast(type === 'success' ? 'success' : 'danger', message);
      } else {
        alert(message);
      }
    }
    
    console.log('[DuneMap] ✅ Initialisierung abgeschlossen');
  }
})();
