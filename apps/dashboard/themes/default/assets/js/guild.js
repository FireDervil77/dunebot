/**
 * Guild-AJAX-Handler
 * Universeller Handler für alle AJAX-Aktionen im Guild-Dashboard
 * @author FireDervil
 */
class GuildAjaxHandler {
    static init() {
        // Toast-Container initialisieren
        if (!document.getElementById('toast-container')) {
            const container = document.createElement('div');
            container.id = 'toast-container';
            // Neue Position: Oben mittig
            container.className = 'position-fixed top-0 start-50 translate-middle-x p-3';
            // Optional: Z-Index um sicherzustellen dass der Toast über allem liegt
            container.style.zIndex = '9999';
            document.body.appendChild(container);
        }

        // Alle AJAX-Formulare im Guild-Bereich abfangen
        const forms = document.querySelectorAll('.guild-ajax-form');
        console.log('[GuildAjax] Gefundene Forms:', forms.length);
        
        forms.forEach(form => {
            console.log('[GuildAjax] Registriere Form:', form.dataset.formType);
            form.addEventListener('submit', e => {
                console.log('[GuildAjax] Form submitted:', form.dataset.formType);
                e.preventDefault();
                GuildAjaxHandler.handleForm(form);
            });
        });
    }

    static async handleForm(form) {
        console.log('[GuildAjax] handleForm called for:', form.dataset.formType);
        try {
            const formData = new FormData(form);
            const formType = form.dataset.formType || 'default';

            // Korrekte URL aus form.action (String!)
            const url = typeof form.action === 'string' ? form.action : form.getAttribute('action');
            console.log('[GuildAjax] Submitting to:', url, 'Type:', formType);
            
            // HTTP-Methode aus Form oder data-method Attribut
            const method = form.dataset.method || form.method || 'POST';

            const response = await fetch(url, {
                method: method.toUpperCase(),
                headers: {
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: new URLSearchParams(formData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            // Form-spezifische Aktionen basierend auf data-attributes
            switch(formType) {
                case 'plugin':
                    await this.handlePluginResponse(form, result);
                    break;
                    
                case 'locale':
                    await this.handleLocaleResponse(form, result);
                    break;
                    
                case 'settings':
                    await this.handleSettingsResponse(form, result);
                    break;
                    
                case 'widget':
                    await this.handleWidgetResponse(form, result);
                    break;
                
                case 'news':
                    await this.handleNewsResponse(form, result);
                    break;
                
                case 'news-delete':
                    await this.handleNewsDeleteResponse(form, result);
                    break;
                
                case 'notification':
                    await this.handleNotificationResponse(form, result);
                    break;
                
                case 'core-settings':
                    await this.handleCoreSettingsResponse(form, result);
                    break;
                
                case 'dunemap-settings':
                    await this.handleDuneMapSettingsResponse(form, result);
                    break;
                    
                default:
                    // Generische Behandlung
                    if (result.success) {
                        this.showToast('success', result.message || 'Aktion erfolgreich!');
                    } else {
                        this.showToast('error', result.message || 'Fehler bei der Aktion');
                    }
            }

            // Button-Status und UI aktualisieren
            await this.updateUI(form, result);

        } catch (error) {
            this.showToast('error', window.i18n?.COMMON?.NETWORK_ERROR || 'Netzwerkfehler oder Serverfehler');
            console.error(error);
        }
    }

    static async handlePluginResponse(form, result) {
        const pluginName = form.querySelector('input[name="plugins[]"]')?.value;
        const action = form.querySelector('input[name="action"]')?.value;
        
        if (result.success) {
            const message = action === 'enable' 
                ? (window.i18n?.TOAST_MESSAGES?.PLUGIN_ENABLED || `Plugin "${pluginName}" aktiviert`)
                : (window.i18n?.TOAST_MESSAGES?.PLUGIN_DISABLED || `Plugin "${pluginName}" deaktiviert`);
            this.showToast('success', message);
            if (result.requiresReload) {
                setTimeout(() => window.location.reload(), 1500);
            }
        } else {
            this.showToast('error', 
                result.message || (window.i18n?.TOAST_MESSAGES?.PLUGIN_ERROR || 'Fehler bei Plugin-Operation')
            );
        }
    }

    static async handleLocaleResponse(form, result) {
        if (result.success) {
            this.showToast('success', window.i18n?.TOAST_MESSAGES?.LOCALE_UPDATED || 'Spracheinstellungen wurden aktualisiert');
            if (result.requiresReload) {
                setTimeout(() => window.location.reload(), 1500);
            }
        } else {
            this.showToast('error', 
                result.message || (window.i18n?.TOAST_MESSAGES?.LOCALE_ERROR || 'Fehler beim Speichern der Spracheinstellungen')
            );
        }
    }

    static async handleSettingsResponse(form, result) {
        if (result.success) {
            this.showToast('success', window.i18n?.TOAST_MESSAGES?.SETTINGS_SAVED || 'Einstellungen wurden gespeichert');
        } else {
            this.showToast('error', 
                result.message || (window.i18n?.TOAST_MESSAGES?.SETTINGS_ERROR || 'Fehler beim Speichern der Einstellungen')
            );
        }
    }

    static async handleNewsResponse(form, result) {
        if (result.success) {
            this.showToast('success', result.message || (window.i18n?.TOAST_MESSAGES?.NEWS_UPDATED || 'News erfolgreich gespeichert'));
            // Nach 1 Sekunde zur News-Übersicht weiterleiten
            setTimeout(() => {
                const guildId = window.location.pathname.split('/')[2];
                window.location.href = `/guild/${guildId}/plugins/superadmin/news`;
            }, 1000);
        } else {
            this.showToast('error', result.message || (window.i18n?.TOAST_MESSAGES?.NEWS_ERROR || 'Fehler beim Speichern der News'));
        }
    }

    static async handleNewsDeleteResponse(form, result) {
        if (result.success) {
            this.showToast('success', result.message || (window.i18n?.TOAST_MESSAGES?.NEWS_DELETED || 'News erfolgreich gelöscht'));
            // Tabellenzeile entfernen (visuelle Sofort-Aktualisierung)
            const row = form.closest('tr');
            if (row) {
                row.style.opacity = '0';
                setTimeout(() => row.remove(), 300);
            }
        } else {
            this.showToast('error', result.message || (window.i18n?.TOAST_MESSAGES?.NEWS_ERROR || 'Fehler beim Löschen der News'));
        }
    }

    static async handleNotificationResponse(form, result) {
        if (result.success) {
            this.showToast('success', result.message || (window.i18n?.TOAST_MESSAGES?.NOTIFICATION_SENT || 'Notification erfolgreich versendet'));
            // Formular zurücksetzen
            form.reset();
        } else {
            this.showToast('error', result.message || (window.i18n?.TOAST_MESSAGES?.NOTIFICATION_ERROR || 'Fehler beim Versenden der Notification'));
        }
    }

    static async handleCoreSettingsResponse(form, result) {
        if (result.success) {
            this.showToast('success', result.message || (window.i18n?.TOAST_MESSAGES?.CORE_SETTINGS_SAVED || 'Einstellungen erfolgreich gespeichert'));
            // Optional: Seite nach 1,5s neu laden um Änderungen sichtbar zu machen
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            this.showToast('error', result.message || (window.i18n?.TOAST_MESSAGES?.CORE_SETTINGS_ERROR || 'Fehler beim Speichern der Einstellungen'));
        }
    }

    static async handleDuneMapSettingsResponse(form, result) {
        console.log('[GuildAjax] handleDuneMapSettingsResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || (window.i18n?.TOAST_MESSAGES?.DUNEMAP_SETTINGS_SAVED || 'DuneMap-Einstellungen gespeichert'));
            // Seite nach 1,5s neu laden um Änderungen (z.B. Channel-Auswahl) sichtbar zu machen
            console.log('[GuildAjax] Scheduling page reload in 1.5s...');
            setTimeout(() => {
                console.log('[GuildAjax] Reloading page now!');
                window.location.reload();
            }, 1500);
        } else {
            this.showToast('error', result.message || (window.i18n?.TOAST_MESSAGES?.DUNEMAP_SETTINGS_ERROR || 'Fehler beim Speichern der DuneMap-Einstellungen'));
        }
    }

    static async updateUI(form, result) {
        // Button-Status aktualisieren
        const button = form.querySelector('button[type="submit"]');
        if (button) {
            button.disabled = false;
            
            // Success-Animation
            if (result.success) {
                button.classList.add('btn-success');
                setTimeout(() => button.classList.remove('btn-success'), 1000);
            }
        }

        // Form-spezifische UI Updates
        const formType = form.dataset.formType;
        const updateTarget = form.dataset.updateTarget;
        
        if (result.success && result.data) {
            if (updateTarget) {
                const target = document.querySelector(updateTarget);
                if (target) {
                    // Partial Update wenn möglich
                    if (result.html) {
                        target.innerHTML = result.html;
                    }
                }
            }
        }
    }

    static updateButtonState(form, success) {
        // Optional: Button-Status anpassen
        const button = form.querySelector('button[type="submit"]');
        if (button) {
            button.disabled = success;
            // Weitere UI-Anpassungen je nach Aktion
        }
    }

    static showToast(type, message) {
        const toast = document.createElement('div');
        // Toast-spezifische Styles für zentrierte Position
        toast.className = `toast toast-${type} align-items-center`;
        toast.innerHTML = `
            <div class="toast-header">
                <i class="fas ${this.getIconForType(type)} me-2"></i>
                <strong class="me-auto">${this.getTextForType(type)}</strong>
                <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
            </div>
            <div class="toast-body">${message}</div>
        `;
        
        document.getElementById('toast-container').appendChild(toast);
        
        // Bootstrap 5 Toast mit angepassten Optionen
        const bsToast = new bootstrap.Toast(toast, { 
            delay: 3000,
            animation: true,
            // Optional: Automatisches Ausblenden deaktivieren
            // autohide: false
        });
        
        bsToast.show();
        toast.addEventListener('hidden.bs.toast', () => toast.remove());
    }

    static getIconForType(type) {
        return {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        }[type] || 'fa-info-circle';
    }

    static getTextForType(type) {
        return {
            success: 'Erfolg',
            error: 'Fehler',
            warning: 'Warnung',
            info: 'Info'
        }[type] || 'Info';
    }
}

// Initialisierung nach DOM-Load
document.addEventListener('DOMContentLoaded', () => GuildAjaxHandler.init());