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
      console.error('[DuneMap] Grid nicht gefunden!');
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
      addBtn.disabled = sectorMarkers.length >= 4;
      
      if (sectorMarkers.length >= 4) {
        addBtn.innerHTML = '<i class="fa-solid fa-ban me-1"></i>Limit erreicht (4/4)';
      } else {
        addBtn.innerHTML = `<i class="fa-solid fa-plus me-1"></i>Marker hinzufügen (${sectorMarkers.length}/4)`;
      }
    }
    
    // Marker-Typ Auswahl
    document.getElementById('markerTypeSelect').addEventListener('change', function() {
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
          showToast('success', result.message || 'Marker hinzugefügt!');
          setTimeout(() => location.reload(), 500);
        } else {
          showToast('danger', result.message || 'Fehler beim Hinzufügen');
        }
      } catch (error) {
        console.error('[DuneMap] Fehler:', error);
        showToast('danger', 'Netzwerkfehler');
      }
    });
    
    // Marker entfernen (global für inline onclick)
    window.removeMarker = async function(markerId) {
      const confirmMsg = DATA?.i18n?.confirmDelete || 'Marker wirklich entfernen?';
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
          const successMsg = DATA?.i18n?.success || 'Marker entfernt!';
          showToast('success', result.message || successMsg);
          setTimeout(() => location.reload(), 500);
        } else {
          const errorMsg = DATA?.i18n?.error || 'Fehler beim Entfernen';
          showToast('danger', result.message || errorMsg);
        }
      } catch (error) {
        console.error('[DuneMap] Fehler:', error);
        showToast('danger', DATA?.i18n?.error || 'Netzwerkfehler');
      }
    };
    
    // Editor schließen
    document.getElementById('closeEditorBtn').addEventListener('click', function() {
      document.getElementById('markerEditor').style.display = 'none';
      document.getElementById('markerTypeSelect').value = '';
      document.getElementById('iconPreview').style.display = 'none';
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
