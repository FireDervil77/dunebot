/**
 * Template Plugin JavaScript
 * Client-seitige Funktionalität für das Template-Plugin
 */

(function() {
    'use strict';
    
    /**
     * Template Plugin Haupt-Klasse
     */
    class TemplatePlugin {
        constructor() {
            this.initialized = false;
            this.stats = null;
            this.activities = [];
            
            this.init();
        }
        
        /**
         * Plugin initialisieren
         */
        init() {
            console.log('[Template Plugin] Initialisiere...');
            
            // Event Listener registrieren
            this.registerEventListeners();
            
            // Daten laden
            this.loadData();
            
            this.initialized = true;
            console.log('[Template Plugin] Initialisierung abgeschlossen');
        }
        
        /**
         * Event Listener registrieren
         */
        registerEventListeners() {
            // Beispiel: Button Click Handler
            document.querySelectorAll('.template-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => this.handleAction(e));
            });
            
            // Beispiel: Form Submit Handler
            const forms = document.querySelectorAll('.template-form');
            forms.forEach(form => {
                form.addEventListener('submit', (e) => this.handleFormSubmit(e));
            });
        }
        
        /**
         * Daten vom Server laden
         */
        async loadData() {
            try {
                const guildId = this.getGuildId();
                
                const response = await fetch(`/api/guild/${guildId}/template/data`);
                if (!response.ok) throw new Error('Failed to load data');
                
                const data = await response.json();
                this.stats = data.stats;
                this.activities = data.activities;
                
                this.updateUI();
            } catch (error) {
                console.error('[Template Plugin] Fehler beim Laden der Daten:', error);
                this.showError('Fehler beim Laden der Daten');
            }
        }
        
        /**
         * UI aktualisieren
         */
        updateUI() {
            // Statistiken aktualisieren
            if (this.stats) {
                document.querySelectorAll('[data-stat]').forEach(el => {
                    const stat = el.dataset.stat;
                    if (this.stats[stat] !== undefined) {
                        el.textContent = this.stats[stat];
                    }
                });
            }
            
            // Aktivitäten aktualisieren
            if (this.activities.length > 0) {
                this.renderActivities();
            }
        }
        
        /**
         * Aktivitäten rendern
         */
        renderActivities() {
            const container = document.getElementById('template-activities');
            if (!container) return;
            
            const html = this.activities.map(activity => `
                <div class="template-activity-item">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <i class="fa-solid fa-circle-dot text-primary me-2"></i>
                            ${this.escapeHtml(activity.description)}
                        </div>
                        <small class="text-muted">
                            ${this.formatDate(activity.timestamp)}
                        </small>
                    </div>
                </div>
            `).join('');
            
            container.innerHTML = html;
        }
        
        /**
         * Action Handler
         */
        async handleAction(event) {
            event.preventDefault();
            const btn = event.currentTarget;
            const action = btn.dataset.action;
            
            console.log('[Template Plugin] Action:', action);
            
            try {
                const guildId = this.getGuildId();
                const response = await fetch(`/api/guild/${guildId}/template/action`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ action })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.showSuccess(result.message || 'Aktion erfolgreich');
                    this.loadData(); // Daten neu laden
                } else {
                    this.showError(result.error || 'Aktion fehlgeschlagen');
                }
            } catch (error) {
                console.error('[Template Plugin] Fehler bei Action:', error);
                this.showError('Netzwerkfehler');
            }
        }
        
        /**
         * Form Submit Handler
         */
        async handleFormSubmit(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            const data = Object.fromEntries(formData);
            
            try {
                const response = await fetch(form.action, {
                    method: form.method,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.showSuccess(result.message || 'Gespeichert');
                } else {
                    this.showError(result.error || 'Fehler beim Speichern');
                }
            } catch (error) {
                console.error('[Template Plugin] Fehler beim Speichern:', error);
                this.showError('Netzwerkfehler');
            }
        }
        
        /**
         * Guild ID ermitteln
         */
        getGuildId() {
            const match = window.location.pathname.match(/\/guild\/(\d+)/);
            return match ? match[1] : null;
        }
        
        /**
         * Datum formatieren
         */
        formatDate(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleString('de-DE');
        }
        
        /**
         * HTML escapen
         */
        escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, m => map[m]);
        }
        
        /**
         * Erfolgs-Toast anzeigen
         */
        showSuccess(message) {
            if (typeof toastr !== 'undefined') {
                toastr.success(message);
            } else {
                alert(message);
            }
        }
        
        /**
         * Fehler-Toast anzeigen
         */
        showError(message) {
            if (typeof toastr !== 'undefined') {
                toastr.error(message);
            } else {
                alert(message);
            }
        }
    }
    
    // Plugin initialisieren wenn DOM bereit ist
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.templatePlugin = new TemplatePlugin();
        });
    } else {
        window.templatePlugin = new TemplatePlugin();
    }
})();
