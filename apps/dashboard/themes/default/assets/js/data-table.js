/**
 * FireBot DataTable – Wiederverwendbare Listen-Komponente
 * 
 * Features:
 * - Multi-Select (Checkbox pro Zeile + "Alle auswählen")
 * - Bulk-Aktionen (Delete, Move, Copy + Custom)
 * - Suche (Client-Side Filtering)
 * - Pagination
 * - Sortierung (Spaltenklick)
 * - Summary-Badges
 * - Responsive (AdminLTE / Bootstrap 4 kompatibel)
 * 
 * Usage:
 *   const table = new DuneDataTable({
 *     containerId: 'my-table-container',
 *     apiUrl: '/guild/123/plugins/example/items',
 *     columns: [
 *       { key: 'name', label: 'Name', sortable: true },
 *       { key: 'status', label: 'Status', render: (val, row) => `<span class="badge">${val}</span>` }
 *     ],
 *     rowKey: 'id',
 *     perPage: 25,
 *     searchable: true,
 *     selectable: true,
 *     bulkActions: [
 *       { key: 'delete', label: 'Löschen', icon: 'fa-trash', class: 'btn-danger', confirm: 'Wirklich löschen?' },
 *       { key: 'move',   label: 'Verschieben', icon: 'fa-arrows-alt', class: 'btn-warning' },
 *       { key: 'copy',   label: 'Kopieren', icon: 'fa-copy', class: 'btn-info' }
 *     ],
 *     onBulkAction: async (action, selectedIds) => { ... },
 *     onLoad: (data) => { ... },
 *     emptyIcon: 'fa-inbox',
 *     emptyText: 'Keine Einträge gefunden.',
 *     loadingText: 'Lade...'
 *   });
 *   table.load();
 */
class DuneDataTable {
    constructor(options) {
        this.containerId = options.containerId;
        this.apiUrl = options.apiUrl;
        this.columns = options.columns || [];
        this.rowKey = options.rowKey || 'id';
        this.perPage = options.perPage || 25;
        this.perPageOptions = options.perPageOptions || [25, 50, 100, 0]; // 0 = Alle
        this.searchable = options.searchable !== false;
        this.selectable = options.selectable || false;
        this.bulkActions = options.bulkActions || [];
        this.onBulkAction = options.onBulkAction || null;
        this.onLoad = options.onLoad || null;
        this.emptyIcon = options.emptyIcon || 'fa-solid fa-inbox';
        this.emptyText = options.emptyText || 'Keine Einträge gefunden.';
        this.loadingText = options.loadingText || 'Lade...';
        this.summaryMap = options.summaryMap || null; // (data) => { total: X, ... }
        this.rowClass = options.rowClass || null; // (row) => 'css-class'
        this.parseResponse = options.parseResponse || null; // (json) => { data: [], summary?: {} }
        this.filters = options.filters || []; // [{ key, label, options: [{value, text}] }]

        // State
        this._data = [];
        this._filtered = [];
        this._page = 1;
        this._sortKey = null;
        this._sortDir = 'asc';
        this._selected = new Set();
        this._filterValues = {};

        this._container = document.getElementById(this.containerId);
        if (!this._container) {
            console.error(`[DuneDataTable] Container #${this.containerId} nicht gefunden`);
            return;
        }

        this._render();
    }

    // ── Public API ──────────────────────────────────────────

    async load() {
        this._showLoading();
        try {
            const r = await fetch(this.apiUrl);
            const json = await r.json();

            let parsed;
            if (this.parseResponse) {
                parsed = this.parseResponse(json);
            } else {
                parsed = { data: json.data || json, summary: json.summary || null };
            }

            this._data = parsed.data || [];
            if (parsed.summary) this._updateSummary(parsed.summary);
            if (this.onLoad) this.onLoad(this._data);

            this._selected.clear();
            this._page = 1;
            this._applyFilter();
        } catch (e) {
            console.error('[DuneDataTable] Load error:', e);
            this._showError();
        }
    }

    getSelectedIds() {
        return Array.from(this._selected);
    }

    getData() {
        return this._data;
    }

    // ── Scaffold / Render ───────────────────────────────────

    _render() {
        let html = '';

        // Toolbar: Search + Filters + Bulk-Actions
        html += '<div class="d-flex flex-wrap align-items-center mb-2 gap-2 dune-dt-toolbar">';

        // Search
        if (this.searchable) {
            html += `<div class="input-group input-group-sm" style="max-width:280px;">
                <div class="input-group-prepend"><span class="input-group-text"><i class="fa-solid fa-search"></i></span></div>
                <input type="text" class="form-control dune-dt-search" placeholder="Suchen…">
            </div>`;
        }

        // Custom Filters
        this.filters.forEach((f, i) => {
            html += `<select class="form-control form-control-sm dune-dt-filter" data-filter-key="${f.key}" style="max-width:180px;">`;
            f.options.forEach(o => {
                html += `<option value="${o.value}">${o.text}</option>`;
            });
            html += '</select>';
        });

        // Spacer
        html += '<div class="ml-auto"></div>';

        // Bulk Actions (hidden by default, shown when items selected)
        if (this.selectable && this.bulkActions.length > 0) {
            html += '<div class="dune-dt-bulk-bar" style="display:none;">';
            html += '<span class="text-muted mr-2 dune-dt-sel-count">0 ausgewählt</span>';
            this.bulkActions.forEach(a => {
                html += `<button class="btn btn-sm ${a.class || 'btn-secondary'} mr-1 dune-dt-bulk-btn" data-action="${a.key}" title="${a.label}">
                    <i class="fa-solid ${a.icon || 'fa-cog'} mr-1"></i>${a.label}
                </button>`;
            });
            html += '</div>';
        }

        // Per-Page Dropdown
        html += '<select class="form-control form-control-sm dune-dt-perpage" style="max-width:120px;">';
        this.perPageOptions.forEach(n => {
            const label = n === 0 ? 'Alle' : n;
            html += `<option value="${n}" ${n === this.perPage ? 'selected' : ''}>${label}</option>`;
        });
        html += '</select>';

        // Page info (right-aligned)
        html += '<small class="text-muted dune-dt-showing"></small>';
        html += '</div>';

        // Summary cards (optional, filled via _updateSummary)
        html += '<div class="dune-dt-summary row mb-2"></div>';

        // Table
        html += '<div class="table-responsive"><table class="table table-sm table-hover dune-dt-table"><thead class="thead-light"><tr>';
        if (this.selectable) {
            html += '<th style="width:35px;"><input type="checkbox" class="dune-dt-select-all"></th>';
        }
        this.columns.forEach(col => {
            const sortAttr = col.sortable ? `style="cursor:pointer;" data-sort-key="${col.key}"` : '';
            html += `<th ${sortAttr}>${col.label}${col.sortable ? ' <i class="fa-solid fa-sort text-muted" style="font-size:.7rem;"></i>' : ''}</th>`;
        });
        html += '</tr></thead><tbody class="dune-dt-body">';
        html += `<tr><td colspan="${this.columns.length + (this.selectable ? 1 : 0)}" class="text-center text-muted py-3"><i class="fa-solid fa-spinner fa-spin mr-1"></i>${this.loadingText}</td></tr>`;
        html += '</tbody></table></div>';

        // Pagination
        html += '<div class="d-flex justify-content-between align-items-center mt-2">';
        html += '<small class="text-muted dune-dt-page-info"></small>';
        html += '<nav><ul class="pagination pagination-sm mb-0 dune-dt-pagination"></ul></nav>';
        html += '</div>';

        this._container.innerHTML = html;
        this._bindEvents();
    }

    _bindEvents() {
        const c = this._container;

        // Search
        const search = c.querySelector('.dune-dt-search');
        if (search) {
            search.addEventListener('input', () => { this._page = 1; this._applyFilter(); });
        }

        // Custom Filters
        c.querySelectorAll('.dune-dt-filter').forEach(sel => {
            sel.addEventListener('change', () => {
                this._filterValues[sel.dataset.filterKey] = sel.value;
                this._page = 1;
                this._applyFilter();
            });
        });

        // Per-Page
        const perPageSel = c.querySelector('.dune-dt-perpage');
        if (perPageSel) {
            perPageSel.addEventListener('change', () => {
                this.perPage = parseInt(perPageSel.value);
                this._page = 1;
                this._renderPage();
            });
        }

        // Select All
        const selectAll = c.querySelector('.dune-dt-select-all');
        if (selectAll) {
            selectAll.addEventListener('change', () => {
                const checked = selectAll.checked;
                // Select/Deselect all items on CURRENT page
                const ep = this.perPage === 0 ? this._filtered.length || 1 : this.perPage;
                const start = (this._page - 1) * ep;
                const pageData = this._filtered.slice(start, start + ep);
                pageData.forEach(row => {
                    const id = row[this.rowKey];
                    if (checked) this._selected.add(id); else this._selected.delete(id);
                });
                this._renderPage();
                this._updateBulkBar();
            });
        }

        // Sort
        c.querySelectorAll('th[data-sort-key]').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sortKey;
                if (this._sortKey === key) {
                    this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    this._sortKey = key;
                    this._sortDir = 'asc';
                }
                this._applyFilter();
            });
        });

        // Bulk Actions
        c.querySelectorAll('.dune-dt-bulk-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action;
                const def = this.bulkActions.find(a => a.key === action);
                const ids = this.getSelectedIds();
                if (ids.length === 0) return;

                if (def && def.confirm) {
                    if (!confirm(def.confirm.replace('{count}', ids.length))) return;
                }

                if (this.onBulkAction) {
                    btn.disabled = true;
                    btn.querySelector('i').className = 'fa-solid fa-spinner fa-spin mr-1';
                    try {
                        await this.onBulkAction(action, ids);
                        this._selected.clear();
                        await this.load();
                    } catch (e) {
                        console.error('[DuneDataTable] Bulk action error:', e);
                    } finally {
                        btn.disabled = false;
                        const icon = this.bulkActions.find(a => a.key === action)?.icon || 'fa-cog';
                        btn.querySelector('i').className = `fa-solid ${icon} mr-1`;
                    }
                }
            });
        });
    }

    // ── Filter + Sort ───────────────────────────────────────

    _applyFilter() {
        const searchEl = this._container.querySelector('.dune-dt-search');
        const search = (searchEl?.value || '').toLowerCase().trim();

        this._filtered = this._data.filter(row => {
            // Custom Filters
            for (const f of this.filters) {
                const val = this._filterValues[f.key];
                if (val && val !== '' && val !== 'all') {
                    if (typeof f.match === 'function') {
                        if (!f.match(row, val)) return false;
                    } else {
                        // Default: exact match on row[f.key]
                        if (String(row[f.key]) !== val) return false;
                    }
                }
            }

            // Text-Search (alle Spalten)
            if (search) {
                const haystack = this.columns.map(c => String(row[c.key] ?? '')).join(' ').toLowerCase();
                if (!haystack.includes(search)) return false;
            }

            return true;
        });

        // Sort
        if (this._sortKey) {
            const dir = this._sortDir === 'asc' ? 1 : -1;
            const key = this._sortKey;
            this._filtered.sort((a, b) => {
                const aVal = a[key] ?? '';
                const bVal = b[key] ?? '';
                if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
                return String(aVal).localeCompare(String(bVal), 'de', { numeric: true }) * dir;
            });
        }

        this._renderPage();
    }

    // ── Pagination + Rows ───────────────────────────────────

    _renderPage() {
        const tbody = this._container.querySelector('.dune-dt-body');
        const total = this._filtered.length;
        const effectivePerPage = this.perPage === 0 ? total || 1 : this.perPage;
        const totalPages = Math.max(1, Math.ceil(total / effectivePerPage));
        if (this._page > totalPages) this._page = totalPages;

        const start = (this._page - 1) * effectivePerPage;
        const pageData = this._filtered.slice(start, start + effectivePerPage);

        // Showing text
        const showingEl = this._container.querySelector('.dune-dt-showing');
        if (showingEl) {
            showingEl.textContent = total === 0 ? '0 Ergebnisse'
                : total + ' Ergebnisse' + (total !== this._data.length ? ' (gefiltert)' : '');
        }

        // Page info
        const pageInfoEl = this._container.querySelector('.dune-dt-page-info');
        if (pageInfoEl) {
            pageInfoEl.textContent = total > 0
                ? `Zeige ${start + 1}-${Math.min(start + effectivePerPage, total)} von ${total}`
                : '';
        }

        // Empty state
        if (total === 0) {
            const colSpan = this.columns.length + (this.selectable ? 1 : 0);
            tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center text-muted py-3"><i class="${this.emptyIcon} mr-1"></i>${this.emptyText}</td></tr>`;
            this._renderPagination(0);
            this._updateBulkBar();
            return;
        }

        let html = '';
        for (const row of pageData) {
            const id = row[this.rowKey];
            const checked = this._selected.has(id);
            const rowCls = this.rowClass ? this.rowClass(row) : '';

            html += `<tr data-row-id="${id}" class="${rowCls}">`;
            if (this.selectable) {
                html += `<td><input type="checkbox" class="dune-dt-row-check" data-id="${id}" ${checked ? 'checked' : ''}></td>`;
            }
            this.columns.forEach(col => {
                const val = row[col.key];
                const rendered = col.render ? col.render(val, row) : (val ?? '');
                html += `<td>${rendered}</td>`;
            });
            html += '</tr>';
        }

        tbody.innerHTML = html;

        // Row checkbox events
        tbody.querySelectorAll('.dune-dt-row-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.id;
                // Parse to number if originally numeric
                const parsed = isNaN(id) ? id : Number(id);
                if (cb.checked) this._selected.add(parsed); else this._selected.delete(parsed);
                this._updateBulkBar();
            });
        });

        // Update select-all checkbox state
        const selectAll = this._container.querySelector('.dune-dt-select-all');
        if (selectAll) {
            const allChecked = pageData.every(r => this._selected.has(r[this.rowKey]));
            const someChecked = pageData.some(r => this._selected.has(r[this.rowKey]));
            selectAll.checked = allChecked && pageData.length > 0;
            selectAll.indeterminate = someChecked && !allChecked;
        }

        this._renderPagination(totalPages);
        this._updateBulkBar();
    }

    _renderPagination(totalPages) {
        const ul = this._container.querySelector('.dune-dt-pagination');
        if (!ul) return;
        if (totalPages <= 1) { ul.innerHTML = ''; return; }

        let html = '';
        html += `<li class="page-item ${this._page <= 1 ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${this._page - 1}">&laquo;</a></li>`;

        const range = [];
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) range.push(i);
        } else {
            range.push(1);
            let lo = Math.max(2, this._page - 1);
            let hi = Math.min(totalPages - 1, this._page + 1);
            if (this._page <= 3) { lo = 2; hi = 5; }
            if (this._page >= totalPages - 2) { lo = totalPages - 4; hi = totalPages - 1; }
            if (lo > 2) range.push('...');
            for (let i = lo; i <= hi; i++) range.push(i);
            if (hi < totalPages - 1) range.push('...');
            range.push(totalPages);
        }

        for (const p of range) {
            if (p === '...') {
                html += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
            } else {
                html += `<li class="page-item ${p === this._page ? 'active' : ''}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
            }
        }

        html += `<li class="page-item ${this._page >= totalPages ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${this._page + 1}">&raquo;</a></li>`;
        ul.innerHTML = html;

        ul.querySelectorAll('a[data-page]').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const p = parseInt(a.dataset.page);
                if (isNaN(p) || p < 1 || p > totalPages) return;
                this._page = p;
                this._renderPage();
            });
        });
    }

    // ── Bulk Bar ────────────────────────────────────────────

    _updateBulkBar() {
        const bar = this._container.querySelector('.dune-dt-bulk-bar');
        if (!bar) return;
        const count = this._selected.size;
        bar.style.display = count > 0 ? '' : 'none';
        const countEl = bar.querySelector('.dune-dt-sel-count');
        if (countEl) countEl.textContent = count + ' ausgewählt';
    }

    // ── Summary ─────────────────────────────────────────────

    _updateSummary(summary) {
        const el = this._container.querySelector('.dune-dt-summary');
        if (!el) return;
        if (!this.summaryMap) { el.innerHTML = ''; return; }

        const items = this.summaryMap(summary);
        // items = [{ label, value, color, icon }]
        if (!items || items.length === 0) { el.innerHTML = ''; return; }

        let html = '';
        items.forEach(item => {
            html += `<div class="col-md-${Math.max(2, Math.floor(12 / items.length))} mb-2">
                <div class="info-box bg-${item.color || 'info'} mb-0">
                    <span class="info-box-icon"><i class="fa-solid ${item.icon || 'fa-circle-info'}"></i></span>
                    <div class="info-box-content">
                        <span class="info-box-text">${item.label}</span>
                        <span class="info-box-number">${item.value}</span>
                    </div>
                </div>
            </div>`;
        });
        el.innerHTML = html;
    }

    // ── Helpers ─────────────────────────────────────────────

    _showLoading() {
        const tbody = this._container.querySelector('.dune-dt-body');
        if (tbody) {
            const colSpan = this.columns.length + (this.selectable ? 1 : 0);
            tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center text-muted py-3"><i class="fa-solid fa-spinner fa-spin mr-1"></i>${this.loadingText}</td></tr>`;
        }
    }

    _showError() {
        const tbody = this._container.querySelector('.dune-dt-body');
        if (tbody) {
            const colSpan = this.columns.length + (this.selectable ? 1 : 0);
            tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center text-danger">Fehler beim Laden</td></tr>`;
        }
    }
}

// Global verfügbar machen
window.DuneDataTable = DuneDataTable;
