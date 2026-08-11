/**
 * fenster() kommt aus guild.js — der einzigen Definition im Projekt.
 *
 * Hier stand eine eigene Fassung. Weil Funktionsdeklarationen im globalen
 * Bereich einander ueberschreiben und guild.js als Theme-Skript spaeter laedt,
 * wurde sie nie ausgefuehrt — jede Aenderung daran blieb wirkungslos.
 */

/**
 * File-Manager Client-Side Logic
 * Monaco Editor, Multi-Select, AJAX, Toast-Notifications
 * @author FireBot Team
 * @version 2.0.0
 */

class FileManager {
    constructor() {
        this.config = {};
        this.currentPath = '/';
        this.currentFiles = [];
        this.selectedFiles = new Set();
        this.monacoEditor = null;
        this.currentEditFile = null;
        this.contextMenuTarget = null;
        this.uploadQueue = [];
        
        // Initialize on DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }
    
    /**
     * Initialisierung
     */
    async init() {
        // Config erst hier lesen – inline-<script> im Body ist jetzt bereits ausgeführt
        this.config = window.FILE_MANAGER_CONFIG || {};
        console.log('[FileManager] Initializing...', this.config);
        
        // Monaco Editor Setup
        this.setupMonaco();
        
        // Context-Menu Setup
        this.setupContextMenu();
        
        // Keyboard Shortcuts
        this.setupKeyboardShortcuts();
        
        // Initial Load
        await this.navigateTo('/');
        
        console.log('[FileManager] Initialized successfully');
    }
    
    /**
     * Monaco Editor Setup
     */
    setupMonaco() {
        if (!window.require) {
            console.error('[FileManager] Monaco Loader nicht gefunden!');
            return;
        }
        
        // AMD Module Loader Config
        require.config({ 
            paths: { 
                'vs': `/assets/plugins/gameserver/vendor/monaco-editor/min/vs` 
            }
        });
        
        // Monaco Editor lazy-load (erst bei Bedarf)
        console.log('[FileManager] Monaco Editor configured');
    }
    
    /**
     * Dateiinhalt ohne Monaco anzeigen.
     *
     * Kein Ersatz fuer den Editor, sondern die Zusicherung, dass ein Klick auf
     * eine Datei immer etwas zeigt. Bearbeiten und Speichern bleiben moeglich,
     * es fehlt nur die Syntaxhervorhebung.
     *
     * @param {string} inhalt - Dateiinhalt
     */
    zeigeRohtext(inhalt) {
        const behaelter = document.getElementById('monaco-editor');
        if (!behaelter) return;

        let feld = document.getElementById('editor-rohtext');
        if (!feld) {
            behaelter.innerHTML = '';
            feld = document.createElement('textarea');
            feld.id = 'editor-rohtext';
            feld.className = 'form-control font-monospace';
            feld.style.height = '100%';
            feld.style.minHeight = '400px';
            feld.spellcheck = false;
            feld.readOnly = !this.config?.permissions?.canManage;
            behaelter.appendChild(feld);
        }
        feld.value = inhalt;
    }

    /**
     * Monaco Editor laden und initialisieren
     */
    async loadMonaco() {
        if (this.monacoEditor) return; // Bereits geladen

        return new Promise((resolve, reject) => {
            // Ein Fehler im require-Rueckruf wurde bisher von niemandem gefangen:
            // `resolve()` blieb aus, das Promise stand fuer immer offen, und das
            // `await` in editFile kehrte nie zurueck. Sichtbar war davon nichts —
            // kein Fenster, keine Meldung, kein Eintrag im Protokoll.
            // Deshalb faengt hier jetzt alles, und ein Fehlschlag sagt, woran es lag.
            const abbrechen = setTimeout(() => {
                reject(new Error('Monaco hat sich nach 20 s nicht gemeldet'));
            }, 20000);

            require(['vs/editor/editor.main'], () => {
                clearTimeout(abbrechen);
                console.log('[FileManager] Monaco Editor loaded');

                try {
                    const behaelter = document.getElementById('monaco-editor');
                    if (!behaelter) {
                        throw new Error('Container #monaco-editor fehlt im Markup');
                    }

                    this.monacoEditor = monaco.editor.create(behaelter, {
                        value: '',
                        language: 'plaintext',
                        theme: 'vs-dark',
                        automaticLayout: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        readOnly: !this.config?.permissions?.canManage
                    });

                    // Ctrl+S Shortcut zum Speichern
                    this.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                        this.saveFile();
                    });

                    console.log('[FileManager] Monaco Editor erzeugt');
                    resolve();
                } catch (err) {
                    console.error('[FileManager] Monaco liess sich nicht erzeugen:', err);
                    reject(err instanceof Error ? err : new Error(String(err)));
                }
            }, (err) => {
                clearTimeout(abbrechen);
                console.error('[FileManager] Monaco Editor Laden fehlgeschlagen:', err);
                reject(new Error('Monaco Editor konnte nicht geladen werden'));
            });
        });
    }
    
    /**
     * Context-Menu Setup
     */
    setupContextMenu() {
        // Rechtsklick auf Dateien
        document.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('tr[data-file-path]');
            if (!row) return;
            
            e.preventDefault();
            this.showContextMenu(e, row);
        });
        
        // Click außerhalb schließt Context-Menu
        document.addEventListener('click', () => {
            this.hideContextMenu();
        });
    }
    
    /**
     * Keyboard Shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+R: Reload
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                this.reload();
            }
            
            // Delete: Delete selected files
            if (e.key === 'Delete' && this.selectedFiles.size > 0) {
                e.preventDefault();
                this.confirmBulkDelete();
            }
        });
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // NAVIGATION
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * Zu Pfad navigieren
     */
    async navigateTo(path) {
        this.currentPath = path;
        console.log(`[FileManager] Navigating to: ${path}`);
        
        // Loading anzeigen
        document.getElementById('files-loading').style.display = 'block';
        document.getElementById('files-table-container').style.display = 'none';
        document.getElementById('files-empty').style.display = 'none';
        document.getElementById('files-error').style.display = 'none';
        
        try {
            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files?path=${encodeURIComponent(path)}`);
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Fehler beim Laden');
            }
            
            this.currentFiles = data.files;
            this.renderFiles();
            this.renderBreadcrumbs();
            
        } catch (error) {
            console.error('[FileManager] Load error:', error);
            document.getElementById('files-error-message').textContent = error.message;
            document.getElementById('files-error').style.display = 'block';
        } finally {
            document.getElementById('files-loading').style.display = 'none';
        }
    }
    
    /**
     * Reload current directory
     */
    async reload() {
        await this.navigateTo(this.currentPath);
        this.showToast('success', 'Aktualisiert');
    }
    
    /**
     * Breadcrumbs rendern
     */
    renderBreadcrumbs() {
        const breadcrumbs = document.getElementById('file-breadcrumbs');
        const parts = this.currentPath.split('/').filter(p => p);
        
        let html = `
            <li class="breadcrumb-item">
                <a href="#" data-path="/" onclick="fileManager.navigateTo('/'); return false;">
                    <i class="fas fa-home"></i> Root
                </a>
            </li>
        `;
        
        let currentPath = '';
        parts.forEach((part, index) => {
            currentPath += '/' + part;
            const isLast = index === parts.length - 1;
            
            if (isLast) {
                html += `<li class="breadcrumb-item active">${this.escapeHtml(part)}</li>`;
            } else {
                html += `
                    <li class="breadcrumb-item">
                        <a href="#" onclick="fileManager.navigateTo('${currentPath}'); return false;">
                            ${this.escapeHtml(part)}
                        </a>
                    </li>
                `;
            }
        });
        
        breadcrumbs.innerHTML = html;
    }
    
    /**
     * Dateien rendern
     */
    renderFiles() {
        const tbody = document.getElementById('files-tbody');
        
        if (this.currentFiles.length === 0) {
            document.getElementById('files-empty').style.display = 'block';
            document.getElementById('files-table-container').style.display = 'none';
            return;
        }
        
        // Sortieren: Ordner zuerst, dann alphabetisch
        const sorted = [...this.currentFiles].sort((a, b) => {
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;
            return a.name.localeCompare(b.name);
        });
        
        let html = '';
        sorted.forEach(file => {
            const path = this.currentPath === '/' 
                ? `/${file.name}` 
                : `${this.currentPath}/${file.name}`;
            
            const icon = file.is_dir ? 'fa-folder' : this.getFileIcon(file.name);
            const iconColor = file.is_dir ? 'text-warning' : 'text-secondary';
            
            html += `
                <tr data-file-path="${this.escapeHtml(path)}" 
                    data-is-dir="${file.is_dir}"
                    ${file.is_dir ? `ondblclick="fileManager.navigateTo('${path}')"` : ''}>
                    <td>
                        ${!file.is_dir && this.config.permissions.canManage ? `
                            <input type="checkbox" 
                                   class="form-check-input file-checkbox" 
                                   data-path="${this.escapeHtml(path)}"
                                   onchange="fileManager.toggleFileSelection('${this.escapeHtml(path)}', this.checked)">
                        ` : ''}
                    </td>
                    <td>
                        <i class="fas ${icon} ${iconColor} me-2"></i>
                        ${file.is_dir ? `
                            <a href="#" onclick="fileManager.navigateTo('${path}'); return false;">
                                <strong>${this.escapeHtml(file.name)}</strong>
                            </a>
                        ` : `
                            ${file.editable && this.config.permissions.canView ? `
                                <a href="#" onclick="fileManager.editFile('${path}'); return false;">
                                    ${this.escapeHtml(file.name)}
                                </a>
                            ` : `
                                <span>${this.escapeHtml(file.name)}</span>
                            `}
                        `}
                    </td>
                    <td class="text-secondary">${file.size_formatted || '-'}</td>
                    <td class="text-secondary">${this.formatDate(file.mod_time)}</td>
                    <td class="text-end">
                        ${this.renderActions(file, path)}
                    </td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
        document.getElementById('files-table-container').style.display = 'block';
        document.getElementById('files-empty').style.display = 'none';
        
        // Selection zurücksetzen
        this.clearSelection();
    }
    
    /**
     * Actions-Buttons rendern
     */
    renderActions(file, path) {
        let html = '<div class="btn-group btn-group-sm">';
        
        if (file.is_dir) {
            // Ordner: Öffnen
            html += `
                <button class="btn btn-sm btn-primary" onclick="fileManager.navigateTo('${path}')" title="Öffnen">
                    <i class="fas fa-folder-open"></i>
                </button>
            `;
        } else {
            // Datei: Edit (wenn editierbar)
            if (file.editable && this.config.permissions.canView) {
                html += `
                    <button class="btn btn-sm btn-primary" onclick="fileManager.editFile('${path}')" title="Bearbeiten">
                        <i class="fas fa-edit"></i>
                    </button>
                `;
            }
            
            // Download
            html += `
                <button class="btn btn-sm btn-secondary" onclick="fileManager.downloadFile('${path}')" title="Herunterladen">
                    <i class="fas fa-download"></i>
                </button>
            `;
        }
        
        // Delete (nur mit MANAGE-Permission)
        if (this.config.permissions.canManage) {
            const deleteFunc = file.is_dir ? 'deleteFolder' : 'deleteFile';
            html += `
                <button class="btn btn-sm btn-danger" onclick="fileManager.${deleteFunc}('${path}')" title="Löschen">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }
        
        html += '</div>';
        return html;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // FILE OPERATIONS
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * Datei bearbeiten (Monaco Editor)
     */
    async editFile(path) {
        console.log(`[FileManager] Edit file: ${path}`);
        
        try {
            // Datei zuerst holen. Sie ist der Zweck des Klicks — der Editor ist
            // nur die Darstellung. Scheitert Monaco, soll trotzdem das Fenster
            // aufgehen und der Inhalt lesbar sein, statt dass gar nichts passiert.
            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/read?path=${encodeURIComponent(path)}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Fehler beim Laden');
            }

            this.currentEditFile = path;

            // Dateiname und Fenster zuerst — beides haengt nicht am Editor.
            const nameFeld = document.getElementById('editor-file-name');
            if (nameFeld) nameFeld.textContent = path.split('/').pop();
            fenster('#editor-modal')?.show();

            // Monaco danach. Ein Fehlschlag kostet die Hervorhebung, nicht den Inhalt.
            try {
                await this.loadMonaco();
                this.monacoEditor.setValue(data.content);

                const ext = path.split('.').pop().toLowerCase();
                monaco.editor.setModelLanguage(this.monacoEditor.getModel(), this.getMonacoLanguage(ext));
            } catch (editorFehler) {
                console.error('[FileManager] Editor nicht verfuegbar, Rueckfall auf Textfeld:', editorFehler);
                this.zeigeRohtext(data.content);
                this.showToast('warning', 'Editor nicht verfuegbar — Inhalt wird als Text angezeigt');
            }

        } catch (error) {
            console.error('[FileManager] Edit error:', error);
            this.showToast('error', `Fehler: ${error.message}`);
        }
    }
    
    /**
     * Datei speichern
     */
    async saveFile() {
        if (!this.currentEditFile) return;
        
        console.log(`[FileManager] Save file: ${this.currentEditFile}`);
        
        try {
            // Aus dem Editor, wenn er da ist — sonst aus dem Rueckfall-Textfeld.
            // Ohne diese Unterscheidung wuerde ein Speichern im Rueckfall den
            // Inhalt der Datei mit dem leeren Editor ueberschreiben.
            const rueckfall = document.getElementById('editor-rohtext');
            const content = this.monacoEditor
                ? this.monacoEditor.getValue()
                : (rueckfall ? rueckfall.value : null);

            if (content === null) {
                throw new Error('Kein Editorinhalt vorhanden — nichts gespeichert');
            }

            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/write`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: this.currentEditFile,
                    content
                })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Fehler beim Speichern');
            }
            
            this.showToast('success', 'Datei gespeichert');
            await this.reload();
            
        } catch (error) {
            console.error('[FileManager] Save error:', error);
            this.showToast('error', `Fehler: ${error.message}`);
        }
    }
    
    /**
     * Datei herunterladen
     */
    downloadFile(path) {
        const url = `${this.config.baseUrl}/servers/${this.config.serverId}/files/download?path=${encodeURIComponent(path)}`;
        window.open(url, '_blank');
    }
    
    /**
     * Datei löschen
     */
    async deleteFile(path) {
        const filename = path.split('/').pop();
        
        this.showConfirmModal(
            'Datei löschen',
            `Möchtest du die Datei <strong>${this.escapeHtml(filename)}</strong> wirklich löschen?`,
            async () => {
                try {
                    const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files?path=${encodeURIComponent(path)}`, {
                        method: 'DELETE'
                    });
                    
                    const data = await response.json();
                    
                    if (!data.success) {
                        throw new Error(data.error || 'Fehler beim Löschen');
                    }
                    
                    this.showToast('success', 'Datei gelöscht');
                    await this.reload();
                    
                } catch (error) {
                    console.error('[FileManager] Delete error:', error);
                    this.showToast('error', `Fehler: ${error.message}`);
                }
            }
        );
    }
    
    /**
     * Ordner löschen
     */
    async deleteFolder(path) {
        const foldername = path.split('/').pop();
        
        this.showConfirmModal(
            'Ordner löschen',
            `Möchtest du den Ordner <strong>${this.escapeHtml(foldername)}</strong> und alle Inhalte wirklich löschen?`,
            async () => {
                try {
                    const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/rmdir?path=${encodeURIComponent(path)}`, {
                        method: 'DELETE'
                    });
                    
                    const data = await response.json();
                    
                    if (!data.success) {
                        throw new Error(data.error || 'Fehler beim Löschen');
                    }
                    
                    this.showToast('success', 'Ordner gelöscht');
                    await this.reload();
                    
                } catch (error) {
                    console.error('[FileManager] Delete folder error:', error);
                    this.showToast('error', `Fehler: ${error.message}`);
                }
            }
        );
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // MULTI-SELECT
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * Toggle Datei-Selektion
     */
    toggleFileSelection(path, checked) {
        if (checked) {
            this.selectedFiles.add(path);
        } else {
            this.selectedFiles.delete(path);
        }
        
        this.updateSelectionUI();
    }
    
    /**
     * Toggle Select All
     */
    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.file-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = checked;
            const path = cb.dataset.path;
            if (checked) {
                this.selectedFiles.add(path);
            } else {
                this.selectedFiles.delete(path);
            }
        });
        
        this.updateSelectionUI();
    }
    
    /**
     * Selection UI aktualisieren
     */
    updateSelectionUI() {
        const count = this.selectedFiles.size;
        document.getElementById('selected-count').textContent = count;
        document.getElementById('bulk-actions-toolbar').style.display = count > 0 ? 'block' : 'none';
    }
    
    /**
     * Selektion zurücksetzen
     */
    clearSelection() {
        this.selectedFiles.clear();
        document.getElementById('select-all-checkbox').checked = false;
        document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = false);
        this.updateSelectionUI();
    }
    
    /**
     * Bulk Delete bestätigen
     */
    confirmBulkDelete() {
        const count = this.selectedFiles.size;
        
        this.showConfirmModal(
            `${count} Dateien löschen`,
            `Möchtest du wirklich <strong>${count} Dateien</strong> löschen?`,
            () => this.bulkDelete()
        );
    }
    
    /**
     * Bulk Delete ausführen
     */
    async bulkDelete() {
        const paths = Array.from(this.selectedFiles);
        
        try {
            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/bulk-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Fehler beim Löschen');
            }
            
            this.showToast('success', data.message || `${paths.length} Dateien gelöscht`);
            await this.reload();
            
        } catch (error) {
            console.error('[FileManager] Bulk delete error:', error);
            this.showToast('error', `Fehler: ${error.message}`);
        }
    }
    
    /**
     * Bulk Move Modal anzeigen
     */
    showBulkMoveModal() {
        // Ordner-Liste füllen
        const select = document.getElementById('bulk-move-target');
        select.innerHTML = '<option value="/">/</option>';
        
        this.currentFiles.filter(f => f.is_dir).forEach(folder => {
            const path = this.currentPath === '/' ? `/${folder.name}` : `${this.currentPath}/${folder.name}`;
            select.innerHTML += `<option value="${this.escapeHtml(path)}">${this.escapeHtml(folder.name)}</option>`;
        });
        
        fenster('#bulk-move-modal')?.show();
    }
    
    /**
     * Bulk Move ausführen
     */
    async bulkMove() {
        const sourcePaths = Array.from(this.selectedFiles);
        const destFolder = document.getElementById('bulk-move-target').value;
        
        try {
            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/bulk-move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_paths: sourcePaths, dest_folder: destFolder })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Fehler beim Verschieben');
            }
            
            this.showToast('success', data.message || `${sourcePaths.length} Dateien verschoben`);
            fenster('#bulk-move-modal')?.hide();
            await this.reload();
            
        } catch (error) {
            console.error('[FileManager] Bulk move error:', error);
            this.showToast('error', `Fehler: ${error.message}`);
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // FOLDER OPERATIONS
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * New File Modal anzeigen
     */
    showNewFileModal() {
        document.getElementById('new-file-name').value = '';
        fenster('#new-file-modal')?.show();
    }

    /**
     * Leere Datei erstellen (via write-Endpoint)
     */
    async createFile() {
        const name = document.getElementById('new-file-name').value.trim();

        if (!name) {
            this.showToast('error', 'Bitte einen Dateinamen eingeben');
            return;
        }

        const filePath = this.currentPath === '/' ? `/${name}` : `${this.currentPath}/${name}`;

        try {
            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/write`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: '' })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Fehler beim Erstellen');
            }

            this.showToast('success', `Datei "${name}" erstellt`);
            fenster('#new-file-modal')?.hide();
            await this.reload();

        } catch (error) {
            console.error('[FileManager] Create file error:', error);
            this.showToast('error', `Fehler: ${error.message}`);
        }
    }

    /**
     * New Folder Modal anzeigen
     */
    showNewFolderModal() {
        document.getElementById('new-folder-name').value = '';
        fenster('#new-folder-modal')?.show();
    }
    
    /**
     * Ordner erstellen
     */
    async createFolder() {
        const name = document.getElementById('new-folder-name').value.trim();
        
        if (!name) {
            this.showToast('error', 'Bitte einen Namen eingeben');
            return;
        }
        
        const path = this.currentPath === '/' ? `/${name}` : `${this.currentPath}/${name}`;
        
        try {
            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/mkdir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Fehler beim Erstellen');
            }
            
            this.showToast('success', 'Ordner erstellt');
            fenster('#new-folder-modal')?.hide();
            await this.reload();
            
        } catch (error) {
            console.error('[FileManager] Create folder error:', error);
            this.showToast('error', `Fehler: ${error.message}`);
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // UPLOAD
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * Upload Modal anzeigen
     */
    showUploadModal() {
        this.uploadQueue = [];
        document.getElementById('upload-queue').style.display = 'none';
        document.getElementById('start-upload-btn').disabled = true;
        
        fenster('#upload-modal')?.show();
    }
    
    /**
     * Drag & Drop Handler
     */
    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.add('bg-light');
    }
    
    handleDragLeave(e) {
        e.currentTarget.classList.remove('bg-light');
    }
    
    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('bg-light');
        
        const files = Array.from(e.dataTransfer.files);
        this.addFilesToQueue(files);
    }
    
    /**
     * File-Input Handler
     */
    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.addFilesToQueue(files);
    }
    
    /**
     * Dateien zur Queue hinzufügen
     */
    addFilesToQueue(files) {
        files.forEach(file => {
            // Max 500 MB Check
            if (file.size > 500 * 1024 * 1024) {
                this.showToast('error', `${file.name}: Datei zu groß (max. 500 MB)`);
                return;
            }
            
            this.uploadQueue.push(file);
        });
        
        this.renderUploadQueue();
    }
    
    /**
     * Upload-Queue rendern
     */
    renderUploadQueue() {
        const list = document.getElementById('upload-queue-list');
        
        if (this.uploadQueue.length === 0) {
            document.getElementById('upload-queue').style.display = 'none';
            document.getElementById('start-upload-btn').disabled = true;
            return;
        }
        
        let html = '';
        this.uploadQueue.forEach((file, index) => {
            html += `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                        <i class="fas fa-file me-2"></i>
                        ${this.escapeHtml(file.name)}
                        <small class="text-secondary ms-2">(${this.formatBytes(file.size)})</small>
                    </div>
                    <button class="btn btn-sm btn-danger" onclick="fileManager.removeFromQueue(${index})">
                        <i class="fas fa-times"></i>
                    </button>
                </li>
            `;
        });
        
        list.innerHTML = html;
        document.getElementById('upload-queue').style.display = 'block';
        document.getElementById('start-upload-btn').disabled = false;
    }
    
    /**
     * Aus Queue entfernen
     */
    removeFromQueue(index) {
        this.uploadQueue.splice(index, 1);
        this.renderUploadQueue();
    }
    
    /**
     * Upload starten
     */
    async startUpload() {
        if (this.uploadQueue.length === 0) return;
        
        const btn = document.getElementById('start-upload-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Uploading...';
        
        for (const file of this.uploadQueue) {
            await this.uploadSingleFile(file);
        }
        
        this.showToast('success', `${this.uploadQueue.length} Dateien hochgeladen`);
        fenster('#upload-modal')?.hide();
        await this.reload();
    }
    
    /**
     * Einzelne Datei hochladen
     */
    async uploadSingleFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', this.currentPath);
        
        try {
            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/upload`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Upload fehlgeschlagen');
            }
            
        } catch (error) {
            console.error('[FileManager] Upload error:', error);
            this.showToast('error', `${file.name}: ${error.message}`);
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // CONTEXT MENU
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * Context-Menu anzeigen
     */
    showContextMenu(e, row) {
        const menu = document.getElementById('context-menu');
        menu.style.display = 'block';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        
        this.contextMenuTarget = row;
    }
    
    /**
     * Context-Menu verstecken
     */
    hideContextMenu() {
        document.getElementById('context-menu').style.display = 'none';
        this.contextMenuTarget = null;
    }
    
    /**
     * Context-Menu Aktion
     */
    contextMenuAction(action) {
        this.hideContextMenu();
        
        if (!this.contextMenuTarget) return;
        
        const path = this.contextMenuTarget.dataset.filePath;
        const isDir = this.contextMenuTarget.dataset.isDir === 'true';
        
        switch (action) {
            case 'edit':
                if (!isDir) this.editFile(path);
                break;
            case 'rename':
                this.showRenameModal(path);
                break;
            case 'download':
                if (!isDir) this.downloadFile(path);
                break;
            case 'delete':
                isDir ? this.deleteFolder(path) : this.deleteFile(path);
                break;
        }
    }
    
    /**
     * Rename Modal anzeigen
     */
    showRenameModal(path) {
        const filename = path.split('/').pop();
        document.getElementById('rename-new-name').value = filename;
        
        this.currentRenameFile = path;
        
        fenster('#rename-modal')?.show();
    }
    
    /**
     * Datei umbenennen
     */
    async renameFile() {
        const newName = document.getElementById('rename-new-name').value.trim();
        
        if (!newName) {
            this.showToast('error', 'Bitte einen Namen eingeben');
            return;
        }
        
        try {
            const response = await fetch(`${this.config.baseUrl}/servers/${this.config.serverId}/files/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: this.currentRenameFile,
                    new_name: newName
                })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Fehler beim Umbenennen');
            }
            
            this.showToast('success', 'Umbenannt');
            fenster('#rename-modal')?.hide();
            await this.reload();
            
        } catch (error) {
            console.error('[FileManager] Rename error:', error);
            this.showToast('error', `Fehler: ${error.message}`);
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * Toast-Benachrichtigung anzeigen
     */
    showToast(type, message) {
        // AdminLTE Toast (falls verfügbar)
        if (window.$(document).Toasts) {
            $(document).Toasts('create', {
                class: type === 'success' ? 'bg-success' : 'bg-danger',
                title: type === 'success' ? 'Erfolg' : 'Fehler',
                body: message,
                autohide: true,
                delay: 3000
            });
        } else {
            // Fallback: Bootstrap Alert
            alert(`${type.toUpperCase()}: ${message}`);
        }
    }
    
    /**
     * Confirmation-Modal anzeigen
     */
    showConfirmModal(title, message, onConfirm) {
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').innerHTML = message;
        
        const btn = document.getElementById('confirm-action-btn');
        btn.onclick = () => {
            fenster('#confirm-modal')?.hide();
            onConfirm();
        };
        
        fenster('#confirm-modal')?.show();
    }
    
    /**
     * File-Icon ermitteln
     */
    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        
        const iconMap = {
            // Config
            'cfg': 'fa-cog',
            'ini': 'fa-cog',
            'conf': 'fa-cog',
            'config': 'fa-cog',
            'json': 'fa-file-code',
            'yaml': 'fa-file-code',
            'yml': 'fa-file-code',
            'toml': 'fa-file-code',
            'env': 'fa-key',
            
            // Code
            'js': 'fa-file-code',
            'ts': 'fa-file-code',
            'py': 'fa-file-code',
            'lua': 'fa-file-code',
            'sh': 'fa-terminal',
            'bat': 'fa-terminal',
            
            // Text
            'txt': 'fa-file-alt',
            'md': 'fa-file-alt',
            'log': 'fa-file-alt',
            
            // Archives
            'zip': 'fa-file-archive',
            'tar': 'fa-file-archive',
            'gz': 'fa-file-archive',
            'rar': 'fa-file-archive',
            
            // Images
            'png': 'fa-file-image',
            'jpg': 'fa-file-image',
            'jpeg': 'fa-file-image',
            'gif': 'fa-file-image',
            
            // Default
            'default': 'fa-file'
        };
        
        return iconMap[ext] || iconMap.default;
    }
    
    /**
     * Monaco Sprache ermitteln
     */
    getMonacoLanguage(ext) {
        const map = {
            'js': 'javascript',
            'ts': 'typescript',
            'json': 'json',
            'py': 'python',
            'lua': 'lua',
            'sh': 'shell',
            'bat': 'bat',
            'xml': 'xml',
            'html': 'html',
            'css': 'css',
            'yaml': 'yaml',
            'yml': 'yaml',
            'md': 'markdown',
            'sql': 'sql',
            'ini': 'ini',
            'cfg': 'ini',
            'conf': 'ini'
        };
        
        return map[ext] || 'plaintext';
    }
    
    /**
     * Datum formatieren
     */
    formatDate(dateStr) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        // Relative Zeit für < 24h
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            if (hours === 0) {
                const mins = Math.floor(diff / 60000);
                return `vor ${mins} Min.`;
            }
            return `vor ${hours}h`;
        }
        
        // Absolutes Datum
        return date.toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    /**
     * Bytes formatieren
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * HTML escapen
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Globale Instanz erstellen
const fileManager = new FileManager();
