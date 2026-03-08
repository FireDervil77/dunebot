/**
 * Guild-AJAX-Handler
 * Universeller Handler für alle AJAX-Aktionen im Guild-Dashboard
 * @author FireDervil
 */
class GuildAjaxHandler {
    static _initialized = false; // Guard gegen Doppel-Initialisierung
    
    static init() {
        // Verhindere doppelte Initialisierung
        if (this._initialized) {
            console.log('[GuildAjax] Already initialized, skipping...');
            return;
        }
        this._initialized = true;
        
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
        
        forms.forEach((form, index) => {
            console.log('[GuildAjax] Registriere Form:', form.dataset.formType, 'Index:', index);
            
            // Event-Listener direkt auf dem Formular registrieren (kein Klonen nötig!)
            form.addEventListener('submit', e => {
                console.log('[GuildAjax] Form submitted:', form.dataset.formType);
                e.preventDefault();
                GuildAjaxHandler.handleForm(form);
            });
        });
    }

    static async handleForm(form) {
        console.log('[GuildAjax] handleForm called for:', form.dataset.formType);
        
        // Submit-Button finden und Loading-State setzen
        const submitBtn = ButtonLoader.findSubmitButton(form);
        const loadingText = form.dataset.loadingText || 'Bitte warten...';
        const originalBtnState = submitBtn ? ButtonLoader.setLoading(submitBtn, loadingText) : null;
        
        // Optional: Loading-Toast für lange Operationen
        const showLoadingToast = form.dataset.loadingToast === 'true';
        if (showLoadingToast) {
            const toastMessage = form.dataset.loadingToastMessage || 'Vorgang wird ausgeführt...';
            this.showToast('info', toastMessage);
        }
        
        try {
            const formData = new FormData(form);
            const formType = form.dataset.formType || 'default';

            // Korrekte URL aus form.action (String!)
            const url = typeof form.action === 'string' ? form.action : form.getAttribute('action');
            console.log('[GuildAjax] Submitting to:', url, 'Type:', formType);
            
            // HTTP-Methode aus Form oder data-method Attribut
            const method = form.dataset.method || form.method || 'POST';

            // ========================================
            // SPEZIAL-BEHANDLUNG: Group-Edit/Create
            // Problem: Checkboxen werden nur als FormData aufgenommen wenn checked!
            // Lösung: Alle Checkboxen manuell sammeln (checked = true, unchecked = false)
            // ========================================
            console.log('[GuildAjax] DEBUG: formType =', formType, 'checking if edit-group or create-group...');
            if (formType === 'edit-group' || formType === 'create-group') {
                console.log('[GuildAjax] DEBUG: Inside group edit block, searching for checkboxes...');
                const allCheckboxes = form.querySelectorAll('.permission-checkbox');
                console.log('[GuildAjax] DEBUG: Found', allCheckboxes.length, 'checkboxes');
                
                let serializedCount = 0;
                allCheckboxes.forEach(checkbox => {
                    const permKey = checkbox.dataset.permissionKey;
                    console.log('[GuildAjax] DEBUG: Processing checkbox, permKey =', permKey, 'checked =', checkbox.checked);
                    if (permKey) {
                        // Überschreibe FormData mit aktuellem Checked-State
                        const fieldName = `permissions[${permKey}]`;
                        formData.delete(fieldName); // Lösche alte Werte
                        // Setze explizit true/false (NICHT "true"/"false" als String!)
                        formData.set(fieldName, checkbox.checked ? 'true' : 'false');
                        serializedCount++;
                    }
                });
                console.log('[GuildAjax] Permissions manuell serialisiert:', serializedCount, 'von', allCheckboxes.length, 'Checkboxen');
            } else {
                console.log('[GuildAjax] DEBUG: NOT a group form, skipping checkbox serialization');
            }

            // Konvertiere FormData zu Object (behandelt Arrays korrekt)
            const formObject = {};
            for (let [key, value] of formData.entries()) {
                // Behandle Array-Felder (z.B. group_ids[])
                if (key.endsWith('[]')) {
                    const arrayKey = key.slice(0, -2); // Entferne '[]'
                    if (!formObject[arrayKey]) {
                        formObject[arrayKey] = [];
                    }
                    formObject[arrayKey].push(value);
                } else {
                    // Behandle nested object notation (z.B. direct_permissions[key])
                    const match = key.match(/^(.+?)\[(.+?)\]$/);
                    if (match) {
                        const objKey = match[1];
                        const subKey = match[2];
                        if (!formObject[objKey]) {
                            formObject[objKey] = {};
                        }
                        formObject[objKey][subKey] = value;
                    } else {
                        formObject[key] = value;
                    }
                }
            }

            console.log('[GuildAjax] Serialized form data:', formObject);
            
            // DEBUG: Zeige alle Permission-Keys im Object
            if (formObject.permissions) {
                console.log('[GuildAjax] DEBUG: Permission keys in formObject:', Object.keys(formObject.permissions).length, 'keys');
                console.log('[GuildAjax] DEBUG: Permission sample (first 10):', Object.keys(formObject.permissions).slice(0, 10));
            }

            const response = await fetch(url, {
                method: method.toUpperCase(),
                headers: {
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formObject)
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
                
                case 'notification-save':
                    await this.handleNotificationSaveResponse(form, result);
                    break;
                
                case 'core-settings':
                    await this.handleCoreSettingsResponse(form, result);
                    break;
                
                case 'add-staff':
                    await this.handleAddStaffResponse(form, result);
                    break;
                
                case 'dunemap-settings':
                    await this.handleDuneMapSettingsResponse(form, result);
                    break;
                
                case 'launch-params':
                    await this.handleLaunchParamsResponse(form, result);
                    break;
                
                case 'automod-settings':
                    await this.handleAutoModSettingsResponse(form, result);
                    break;
                
                case 'moderation-settings':
                    await this.handleModerationSettingsResponse(form, result);
                    break;
                
                case 'egg-editor':
                    await this.handleEggEditorResponse(form, result);
                    break;
                
                case 'automod-settings':
                    await this.handleAutomodSettingsResponse(form, result);
                    break;
                
                // ========================================
                // PERMISSIONS SYSTEM HANDLERS
                // ========================================
                
                case 'create-group':
                    await this.handleCreateGroupResponse(form, result);
                    break;
                
                case 'edit-group':
                    await this.handleEditGroupResponse(form, result);
                    break;
                
                case 'delete-group':
                    await this.handleDeleteGroupResponse(form, result);
                    break;
                
                case 'edit-user':
                    await this.handleEditUserResponse(form, result);
                    break;
                
                case 'remove-user':
                    await this.handleRemoveUserResponse(form, result);
                    break;
                
                // ========================================
                // SERVER CONFIG
                // ========================================
                
                case 'server-config':
                    await this.handleServerConfigResponse(form, result);
                    break;
                
                case 'dashboard-config':
                    await this.handleDashboardConfigResponse(form, result);
                    break;
                
                case 'plugin-badge-create':
                    await this.handlePluginBadgeCreateResponse(form, result);
                    break;
                
                // Masterserver Plugin Handlers
                case 'daemon-create':
                    await this.handleDaemonCreateResponse(form, result);
                    break;
                
                case 'token-generate':
                    await this.handleTokenGenerateResponse(form, result);
                    break;
                
                case 'rootserver-create-wizard':
                    await this.handleRootServerWizardResponse(form, result);
                    break;
                
                case 'rootserver-create':
                    await this.handleRootServerCreateResponse(form, result);
                    break;
                
                case 'create-server':
                    await this.handleCreateServerResponse(form, result);
                    break;
                
                case 'update-server':
                    await this.handleUpdateServerResponse(form, result);
                    break;
                
                // Gameserver Plugin Handlers
                case 'gameserver-create':
                    await this.handleGameserverCreateResponse(form, result);
                    break;
                
                case 'gameserver-edit':
                    await this.handleGameserverEditResponse(form, result);
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
            
            // Button wiederherstellen (bei Erfolg)
            if (submitBtn && originalBtnState) {
                if (result.success) {
                    ButtonLoader.setSuccess(submitBtn, 'Erfolgreich!', 1500);
                    // Nach Success-Animation Original State wiederherstellen
                    setTimeout(() => ButtonLoader.restore(submitBtn, originalBtnState), 1500);
                } else {
                    ButtonLoader.setError(submitBtn, 'Fehler', 2000);
                    setTimeout(() => ButtonLoader.restore(submitBtn, originalBtnState), 2000);
                }
            }

        } catch (error) {
            this.showToast('error', window.i18n?.COMMON?.NETWORK_ERROR || 'Netzwerkfehler oder Serverfehler');
            console.error(error);
            
            // Button wiederherstellen (bei Error)
            if (submitBtn && originalBtnState) {
                ButtonLoader.setError(submitBtn, 'Fehler!', 2000);
                setTimeout(() => ButtonLoader.restore(submitBtn, originalBtnState), 2000);
            }
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

    static async handleAddStaffResponse(form, result) {
        console.log('[GuildAjax] handleAddStaffResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Benutzer erfolgreich hinzugefügt');
            
            // Modal schließen (Bootstrap 4 API)
            $('#addStaffModal').modal('hide');
            
            // Formular zurücksetzen
            form.reset();
            
            // Seite nach 1,5s neu laden um neue Tabelle zu zeigen
            setTimeout(() => window.location.reload(), 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Hinzufügen des Benutzers');
        }
    }

    static async handleNewsResponse(form, result) {
        if (result.success) {
            this.showToast('success', result.message || (window.i18n?.TOAST_MESSAGES?.NEWS_UPDATED || 'News erfolgreich gespeichert'));
            // Nach 1 Sekunde zur News-Übersicht weiterleiten
            setTimeout(() => {
                window.location.href = '/admin/news';
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

    static async handleNotificationSaveResponse(form, result) {
        console.log('[GuildAjax] handleNotificationSaveResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Notification erfolgreich gespeichert');
            // Nach 1,5s zur Notifications-Liste redirecten
            setTimeout(() => {
                window.location.href = '/admin/notifications';
            }, 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Speichern der Notification');
        }
    }

    // =====================================================
    // MASTERSERVER PLUGIN HANDLERS
    // =====================================================
    
    static async handleDaemonCreateResponse(form, result) {
        console.log('[GuildAjax] handleDaemonCreateResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Daemon erfolgreich erstellt!');
            // Nach 1,5s neu laden um Daemon-Info anzuzeigen
            setTimeout(() => window.location.reload(), 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Erstellen des Daemons');
        }
    }
    
    static async handleCreateServerResponse(form, result) {
        console.log('[GuildAjax] handleCreateServerResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Server erfolgreich erstellt');
            
            // ✅ Redirect zur Server-Liste (kein Modal mehr!)
            setTimeout(() => {
                // Extrahiere Guild-ID aus Form-Action oder URL
                const action = form.getAttribute('action');
                const match = action.match(/\/guild\/([^/]+)\//);
                
                if (match && match[1]) {
                    const guildId = match[1];
                    console.log('[GuildAjax] Redirecting to server list for guild:', guildId);
                    window.location.href = `/guild/${guildId}/plugins/masterserver/servers`;
                } else {
                    // Fallback: Aus aktueller URL extrahieren
                    const urlMatch = window.location.pathname.match(/\/guild\/([^/]+)\//);
                    if (urlMatch && urlMatch[1]) {
                        const guildId = urlMatch[1];
                        console.log('[GuildAjax] Redirecting to server list (from URL) for guild:', guildId);
                        window.location.href = `/guild/${guildId}/plugins/masterserver/servers`;
                    } else {
                        // Letzter Fallback: Seite neu laden
                        console.warn('[GuildAjax] Could not extract guildId, reloading page');
                        window.location.reload();
                    }
                }
            }, 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Erstellen des Servers');
        }
    }
    
    static async handleUpdateServerResponse(form, result) {
        console.log('[GuildAjax] handleUpdateServerResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Server erfolgreich aktualisiert');
            
            // Nach 1,5s zurück zur Server-Übersicht navigieren
            setTimeout(() => {
                // Guild-ID aus URL extrahieren
                const pathParts = window.location.pathname.split('/');
                const guildIdIndex = pathParts.indexOf('guild') + 1;
                const guildId = pathParts[guildIdIndex];
                
                // Zurück zur Server-Liste
                window.location.href = `/guild/${guildId}/plugins/masterserver/servers`;
            }, 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Aktualisieren des Servers');
        }
    }
    
    /**
     * Gameserver Creation Handler
     * Behandelt Response vom Server-Erstellungs-Wizard
     */
    static async handleGameserverCreateResponse(form, result) {
        console.log('[GuildAjax] handleGameserverCreateResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Server erfolgreich erstellt');
            
            // Optional: Progress-Anzeige für Installation
            if (result.serverId) {
                console.log('[GuildAjax] Neuer Gameserver ID:', result.serverId);
            }
            
            // Nach 2s zur Server-Liste navigieren
            setTimeout(() => {
                if (result.redirectUrl) {
                    window.location.href = result.redirectUrl;
                } else {
                    // Fallback: Guild-ID aus URL extrahieren
                    const pathParts = window.location.pathname.split('/');
                    const guildIdIndex = pathParts.indexOf('guild') + 1;
                    const guildId = pathParts[guildIdIndex];
                    window.location.href = `/guild/${guildId}/plugins/gameserver/servers`;
                }
            }, 2000);
        } else {
            this.showToast('error', result.message || 'Fehler beim Erstellen des Servers');
        }
    }

    static async handleGameserverEditResponse(form, result) {
        console.log('[GuildAjax] handleGameserverEditResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Server erfolgreich aktualisiert');
            // Nach 1,5s zur Server-Detail-Seite zurückkehren
            setTimeout(() => {
                const pathParts = window.location.pathname.split('/');
                const guildIdIndex = pathParts.indexOf('guild') + 1;
                const guildId = pathParts[guildIdIndex];
                // Server-ID aus URL extrahieren (z.B. /guild/:guildId/plugins/gameserver/servers/:serverId/edit)
                const serverIdIndex = pathParts.indexOf('servers') + 1;
                const serverId = pathParts[serverIdIndex];
                window.location.href = `/guild/${guildId}/plugins/gameserver/servers/${serverId}`;
            }, 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Aktualisieren des Servers');
        }
    }

    
    static async handleTokenGenerateResponse(form, result) {
        console.log('[GuildAjax] handleTokenGenerateResponse called:', result);
        if (result.success) {
            // Modal mit Token anzeigen (WICHTIG: Nur einmal sichtbar!)
            const modal = document.getElementById('tokenModal');
            if (modal) {
                document.getElementById('modalTokenId').value = result.tokenId;
                document.getElementById('modalToken').value = result.token;
                $(modal).modal('show');
                
                this.showToast('success', 'Token erfolgreich generiert!');
            } else {
                // Fallback: Alert (falls Modal fehlt)
                alert(`Token generiert!\n\nToken-ID: ${result.tokenId}\n\nToken (WICHTIG - nur einmal sichtbar!):\n${result.token}`);
            }
            
            // Formular zurücksetzen
            form.reset();
        } else {
            this.showToast('error', result.message || 'Fehler beim Generieren des Tokens');
        }
    }

    /**
     * RootServer Wizard Response Handler
     * Nach erfolgreicher Erstellung: Weiterleitung zur Details-Seite
     */
    static async handleRootServerWizardResponse(form, result) {
        console.log('[GuildAjax] handleRootServerWizardResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'RootServer erfolgreich erstellt!');
            
            // Redirect zur Details-Seite nach 1,5s
            if (result.data && result.data.redirectUrl) {
                setTimeout(() => {
                    window.location.href = result.data.redirectUrl;
                }, 1500);
            } else {
                // Fallback: Reload nach 2s
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        } else {
            this.showToast('error', result.message || 'Fehler beim Erstellen des RootServers');
        }
    }

    /**
     * Handler für RootServer-Create (Simple - Pterodactyl-Style)
     * Nach erfolgreicher Erstellung: Weiterleitung zur Details-Seite mit Token-Anzeige
     */
    static async handleRootServerCreateResponse(form, result) {
        console.log('[GuildAjax] handleRootServerCreateResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'RootServer erfolgreich erstellt!');
            
            // Redirect zur Details-Seite (zeigt Token & Installations-Command)
            if (result.data && result.data.redirectUrl) {
                setTimeout(() => {
                    window.location.href = result.data.redirectUrl;
                }, 1500);
            } else if (result.data && result.data.id) {
                // Fallback: Direkt zur Details-Seite mit ID
                const guildId = form.getAttribute('action').match(/\/guild\/(\d+)\//)[1];
                setTimeout(() => {
                    window.location.href = `/guild/${guildId}/plugins/masterserver/rootservers/${result.data.id}`;
                }, 1500);
            } else {
                // Fallback: Zur Liste
                setTimeout(() => {
                    window.location.href = form.getAttribute('action').replace(/\/rootservers.*/, '/rootservers');
                }, 2000);
            }
        } else {
            this.showToast('error', result.message || 'Fehler beim Erstellen des RootServers');
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

    static async handleAutoModSettingsResponse(form, result) {
        console.log('[GuildAjax] handleAutoModSettingsResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || (window.i18n?.TOAST_MESSAGES?.AUTOMOD_SETTINGS_SAVED || 'AutoMod-Einstellungen gespeichert'));
            // Seite nach 1,5s neu laden um Änderungen sichtbar zu machen
            console.log('[GuildAjax] Scheduling page reload in 1.5s...');
            setTimeout(() => {
                console.log('[GuildAjax] Reloading page now!');
                window.location.reload();
            }, 1500);
        } else {
            this.showToast('error', result.message || (window.i18n?.TOAST_MESSAGES?.AUTOMOD_SETTINGS_ERROR || 'Fehler beim Speichern der AutoMod-Einstellungen'));
        }
    }

    static async handleModerationSettingsResponse(form, result) {
        console.log('[GuildAjax] handleModerationSettingsResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || (window.i18n?.TOAST_MESSAGES?.MODERATION_SETTINGS_SAVED || 'Moderation-Einstellungen gespeichert'));
            // Seite nach 1,5s neu laden um Änderungen sichtbar zu machen
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            this.showToast('error', result.message || (window.i18n?.TOAST_MESSAGES?.MODERATION_SETTINGS_ERROR || 'Fehler beim Speichern der Moderation-Einstellungen'));
        }
    }

    static async handleServerConfigResponse(form, result) {
        console.log('[GuildAjax] handleServerConfigResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Server-Einstellungen erfolgreich gespeichert');
            // Seite nach 1,5s neu laden um Änderungen sichtbar zu machen
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Speichern der Server-Einstellungen');
        }
    }

    static async handleDashboardConfigResponse(form, result) {
        console.log('[GuildAjax] handleDashboardConfigResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Dashboard-Einstellungen erfolgreich gespeichert');
            // Seite nach 1,5s neu laden um Änderungen sichtbar zu machen
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Speichern der Dashboard-Einstellungen');
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
            delay: 2500,  // 2,5 Sekunden Auto-Close
            animation: true,
            autohide: true  // Auto-Close aktivieren
        });
        
        bsToast.show();
        toast.addEventListener('hidden.bs.toast', () => toast.remove());

        // Automatisches Logging für alle Toasts an zentrale DB
        this.logToastToAPI(type, message).catch(err => {
            console.error('[Toast] DB-Logging fehlgeschlagen:', err);
        });

        // Event für Notification Center (falls vorhanden)
        if (window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('toastShown', { 
                detail: { type, message } 
            }));
        }
    }

    /**
     * Loggt Toast-Event an zentrale Toast-Logger API
     * Alle Toasts werden in guild_toast_logs DB-Tabelle gespeichert
     */
    static async logToastToAPI(type, message) {
        try {
            const response = await fetch('/api/core/toasts/log', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    type,
                    message,
                    timestamp: new Date().toISOString(),
                    url: window.location.href,
                    guildId: window.currentGuildId || this.getCurrentGuildId(),
                    userAgent: navigator.userAgent,
                    metadata: { 
                        source: 'guild.js',
                        page: window.location.pathname,
                        userAgent: navigator.userAgent,
                        timestamp: Date.now()
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log(`[Toast] ${type.toUpperCase()} geloggt:`, result);

            // Debug-Info falls verfügbar
            if (result.debug) {
                console.log('[Toast] Session Debug:', result.debug);
            }

        } catch (error) {
            console.warn('[Toast] API Logging Fehler (ignoriert):', error);
            // Silent fail - Toast wird trotzdem angezeigt, Logging ist optional
        }
    }

    /**
     * Ermittelt Guild-ID aus aktueller URL oder Context
     */
    static getCurrentGuildId() {
        // Aus URL extrahieren (/guild/123456789/...)
        const guildMatch = window.location.pathname.match(/\/guild\/(\d+)/);
        if (guildMatch) {
            return guildMatch[1];
        }

        // Aus globalem Context
        if (window.guildId) {
            return window.guildId;
        }

        // Aus DOM-Elementen
        const guildIdElement = document.querySelector('[data-guild-id]');
        if (guildIdElement) {
            return guildIdElement.getAttribute('data-guild-id');
        }

        return null;
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

    static async handlePluginBadgeCreateResponse(form, result) {
        console.log('[GuildAjax] handlePluginBadgeCreateResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Plugin-Badge erfolgreich gesetzt');
            // Form zurücksetzen
            form.reset();
            // Seite nach 1,5s neu laden um Badge in Liste zu sehen
            setTimeout(() => window.location.reload(), 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Setzen des Badges');
        }
    }
    
    // ============================================================================
    // PERMISSIONS SYSTEM HANDLERS
    // ============================================================================
    
    /**
     * Handler für Gruppen-Erstellung
     */
    static async handleCreateGroupResponse(form, result) {
        console.log('[GuildAjax] handleCreateGroupResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Gruppe erfolgreich erstellt');
            // Modal schließen (Bootstrap 4 API)
            $('#createGroupModal').modal('hide');
            // Form zurücksetzen
            form.reset();
            // Seite nach 1,5s neu laden
            setTimeout(() => window.location.reload(), 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Erstellen der Gruppe');
        }
    }
    
    /**
     * Handler für Gruppen-Bearbeitung
     */
    static async handleEditGroupResponse(form, result) {
        console.log('[GuildAjax] handleEditGroupResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Gruppe erfolgreich aktualisiert');
            
            // Modal schließen (Bootstrap 4 API)
            $('#editGroupModal').modal('hide');
            
            // Seite nach 1,5s neu laden
            setTimeout(() => window.location.reload(), 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Aktualisieren der Gruppe');
        }
    }
    
    /**
     * Handler für Gruppen-Löschung
     */
    static async handleDeleteGroupResponse(form, result) {
        console.log('[GuildAjax] handleDeleteGroupResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Gruppe erfolgreich gelöscht');
            // Modal schließen (Bootstrap 4 API)
            $('#deleteGroupModal').modal('hide');
            // Seite nach 1,5s neu laden
            setTimeout(() => window.location.reload(), 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Löschen der Gruppe');
        }
    }
    
    /**
     * Handler für User-Bearbeitung
     */
    static async handleEditUserResponse(form, result) {
        console.log('[GuildAjax] handleEditUserResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Benutzer erfolgreich aktualisiert');
            
            // Modal schließen (Bootstrap 4 API)
            $('#editUserModal').modal('hide');
            
            // Seite nach 1,5s neu laden
            setTimeout(() => window.location.reload(), 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Aktualisieren des Benutzers');
        }
    }
    
    /**
     * Handler für User-Entfernung
     */
    static async handleRemoveUserResponse(form, result) {
        console.log('[GuildAjax] handleRemoveUserResponse called:', result);
        
        // Verhindere doppeltes Triggering
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
        }
        
        if (result.success) {
            this.showToast('success', result.message || 'Benutzer erfolgreich entfernt');
            // Modal schließen (Bootstrap 4 API)
            $('#removeUserModal').modal('hide');
            // Seite nach 1,5s neu laden
            setTimeout(() => window.location.reload(), 1500);
        } else {
            this.showToast('error', result.message || 'Fehler beim Entfernen des Benutzers');
            // Re-enable Button bei Fehler
            if (submitBtn) {
                submitBtn.disabled = false;
            }
        }
    }
    
    /**
     * Manuelles Schließen eines Modals (Fallback)
     */
    static _manualModalClose(modalElement) {
        modalElement.classList.remove('show');
        modalElement.style.display = 'none';
        modalElement.setAttribute('aria-hidden', 'true');
        modalElement.removeAttribute('aria-modal');
        document.body.classList.remove('modal-open');
        
        // Backdrop entfernen
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) backdrop.remove();
        
        // Body-Styles zurücksetzen
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }
    
    /**
     * Egg Editor Response Handler
     */
    static async handleEggEditorResponse(form, result) {
        console.log('[GuildAjax] handleEggEditorResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'Egg erfolgreich gespeichert!');
            
            // Wenn redirect angegeben, nach 1,5s weiterleiten
            if (result.redirect) {
                setTimeout(() => {
                    window.location.href = result.redirect;
                }, 1500);
            } else {
                // Fallback: reload
                setTimeout(() => window.location.reload(), 1500);
            }
        } else {
            this.showToast('error', result.message || 'Fehler beim Speichern des Eggs');
        }
    }
    
    /**
     * AutoMod Settings Response Handler
     */
    static async handleAutomodSettingsResponse(form, result) {
        console.log('[GuildAjax] handleAutomodSettingsResponse called:', result);
        if (result.success) {
            this.showToast('success', result.message || 'AutoMod Einstellungen gespeichert');
            // Kein Reload nötig - Settings bleiben sichtbar
        } else {
            this.showToast('error', result.message || 'Fehler beim Speichern der Einstellungen');
        }
    }
    
    /**
     * Handler für Launch-Params Update
     */
    static async handleLaunchParamsResponse(form, result) {
        console.log('[GuildAjax] handleLaunchParamsResponse called:', result);
        
        if (result.success) {
            // Toast mit Warnung falls Server läuft
            if (result.warning) {
                this.showToast('warning', result.message);
            } else {
                this.showToast('success', result.message);
            }
            
            // Update Display-Text
            const displayElement = document.getElementById('launch-params-display');
            if (displayElement && result.data && result.data.launch_params) {
                displayElement.textContent = result.data.launch_params;
            }
            
            // Zurück zu View-Mode
            if (typeof toggleLaunchParamsEdit === 'function') {
                toggleLaunchParamsEdit(false);
            }
            
        } else {
            this.showToast('error', result.message || 'Fehler beim Speichern der Start-Parameter');
        }
    }
}

// Initialisierung nach DOM-Load
document.addEventListener('DOMContentLoaded', () => {
    GuildAjaxHandler.init();
    
    // Plugin-Reload-Buttons registrieren
    const reloadButtons = document.querySelectorAll('.plugin-reload-btn');
    console.log('[GuildAjax] Gefundene Reload-Buttons:', reloadButtons.length);
    
    reloadButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            const pluginName = button.dataset.pluginName;
            const guildId = button.dataset.guildId;
            
            if (!pluginName || !guildId) {
                console.error('[GuildAjax] Plugin-Name oder Guild-ID fehlt');
                return;
            }
            
            // Button während Request deaktivieren
            button.disabled = true;
            const originalHTML = button.innerHTML;
            button.innerHTML = '<i class="bi bi-hourglass-split"></i>';
            
            try {
                const response = await fetch(`/guild/${guildId}/plugins/core/plugin-reload/${pluginName}`, {
                    method: 'POST',
                    headers: {
                        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
                        'Accept': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const result = await response.json();
                
                if (result.success) {
                    GuildAjaxHandler.showToast('success', `Plugin ${pluginName} erfolgreich neu geladen`);
                    console.log('[GuildAjax] Reload Details:', result.details);
                } else {
                    GuildAjaxHandler.showToast('error', result.message || 'Fehler beim Reload');
                }
                
            } catch (error) {
                console.error('[GuildAjax] Plugin-Reload-Fehler:', error);
                GuildAjaxHandler.showToast('error', 'Netzwerkfehler beim Plugin-Reload');
            } finally {
                // Button wieder aktivieren
                button.disabled = false;
                button.innerHTML = originalHTML;
            }
        });
    });
});