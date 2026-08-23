/**
 * Live-Anzeige: ein Empfänger, ein Zustand, ein Neuzeichnen.
 *
 * ── Was hier vorher stand, und warum es nichts tat ───────────────────────────
 *
 * Gemessen am 2026-08-23: In `server-detail.ejs` gab es einen Aktualisierer,
 * der `[data-server-status]`, `[data-status-text]`, `[data-metric-cpu-text]`
 * und fünf weitere Anker suchte. **Acht von acht existierten nur als Selektor,
 * keiner als HTML-Attribut.** Der Entwurfs-Umbau hatte die Auszeichnung
 * ersetzt und das Skript stehengelassen. `querySelector` lieferte `null`, ein
 * `if` fing es ab, nichts geschah — kein Fehler, keine Meldung.
 *
 * Die Übersicht war noch eine Stufe schlimmer: dort gab es gar keine
 * `data-`Attribute.
 *
 * ── Warum nicht einfach die acht Anker nachtragen ────────────────────────────
 *
 * Weil genau so der Bruch entstanden ist. Ein Skript, das einzelne Elemente
 * kennt, geht kaputt, sobald jemand die Auszeichnung anfasst — und zwar
 * lautlos. Drei Entscheidungen dagegen:
 *
 * 1. **Ein Besitzer.** Dieses Modul hält den Zustand je Server. Die Ansicht
 *    beschreibt nur noch, WO ein Wert steht (`data-fb-live="status"`), nicht
 *    wie er dorthin kommt.
 *
 * 2. **Zustand statt Änderung.** Jedes Ereignis trägt den vollen Wert, nicht
 *    eine Differenz. Eine verpasste Nachricht kostet dann nichts.
 *
 * 3. **Nach jedem Verbinden wird geholt.** Auch nach einem Wiederverbinden —
 *    denn was während der Trennung passiert ist, kann niemand nachliefern.
 *    Ohne das stünde die Seite nach jedem Netzwackler still und sähe dabei aus,
 *    als wäre alles in Ordnung. Das ist derselbe Fehler nochmal, nur seltener.
 */
(function () {
    'use strict';

    const ZUSTAende = {
        online:     { text: 'Läuft',          punkt: 'var(--fb-success)' },
        offline:    { text: 'Aus',            punkt: 'var(--fb-border)'  },
        starting:   { text: 'Startet gerade', punkt: 'var(--fb-warning)' },
        stopping:   { text: 'Stoppt gerade',  punkt: 'var(--fb-warning)' },
        installing: { text: 'Wird installiert', punkt: 'var(--fb-warning)' },
        error:      { text: 'Fehler',         punkt: 'var(--fb-danger)'  },
    };

    /** Die Leiter in der Reihenfolge, in der fb-init sie meldet. */
    const LEITER = ['process', 'port', 'query'];

    class LiveAnzeige {
        constructor(sse, guildId) {
            this.sse = sse;
            this.guildId = guildId;
            this.zustand = new Map();   // serverId → { status, stufe, grund, spieler, max }

            sse.on('status_changed', (d) => this.uebernimm(d.server_id, { status: d.status }));
            sse.on('readiness',      (d) => this.uebernimm(d.server_id, { stufe: d.stufe, grund: d.grund }));
            sse.on('resource_usage', (d) => this.uebernimm(d.server_id, {
                spieler: d.current_players, max: d.max_players }));

            // Nach JEDEM Verbinden nachholen — auch nach einem Wiederverbinden.
            sse.on('connected', () => this.holeAlles());
            this.holeAlles();
        }

        uebernimm(serverId, teil) {
            if (serverId === undefined || serverId === null) return;
            const id = String(serverId);
            const alt = this.zustand.get(id) || {};
            // Ein Ereignis trägt nur, was es weiss. `undefined` überschreibt nicht.
            for (const [k, v] of Object.entries(teil)) {
                if (v !== undefined) alt[k] = v;
            }
            this.zustand.set(id, alt);
            this.zeichne(id);
        }

        async holeAlles() {
            try {
                const r = await fetch(
                    `/guild/${this.guildId}/plugins/gameserver/servers/status`,
                    { headers: { Accept: 'application/json' } });
                if (!r.ok) return;
                const d = await r.json();
                for (const s of (d.servers || [])) {
                    this.uebernimm(s.id, {
                        status:  s.status,
                        stufe:   s.bereitschaft_stufe,
                        grund:   s.bereitschaft_grund,
                        spieler: s.current_players,
                        max:     s.max_players,
                    });
                }
            } catch (_) {
                // Nicht erreichbar ist kein Grund, die Seite zu verändern. Was
                // dasteht, ist der letzte bekannte Stand — und der ist ehrlicher
                // als ein geleertes Feld.
            }
        }

        zeichne(id) {
            const z = this.zustand.get(id) || {};
            const felder = document.querySelectorAll(
                `[data-fb-live][data-fb-server="${CSS.escape(id)}"]`);

            for (const el of felder) {
                switch (el.dataset.fbLive) {

                    case 'status-text': {
                        const e = ZUSTAende[z.status] || { text: z.status || '—' };
                        el.textContent = e.text;
                        break;
                    }

                    case 'status-punkt': {
                        const e = ZUSTAende[z.status] || { punkt: 'var(--fb-border)' };
                        el.style.background = e.punkt;
                        break;
                    }

                    case 'bereitschaft-pille': {
                        const laeuft = z.status === 'online' || z.status === 'starting';
                        const wieWeit = LEITER.indexOf(z.stufe);
                        if (!laeuft || wieWeit < 0) {
                            el.textContent = 'Bereitschaft noch nicht gemeldet';
                            el.className = 'fb-pille';
                            el.title = 'Der Server hat noch keine Bereitschaftsstufe gemeldet.';
                        } else if (z.stufe === LEITER[LEITER.length - 1]) {
                            el.textContent = 'Spieler können rein';
                            el.className = 'fb-pille fb-pille-gut';
                            el.title = 'fb-init hat die letzte Stufe erreicht.';
                        } else {
                            el.textContent = `startet — Stufe ${z.stufe}`;
                            el.className = 'fb-pille fb-pille-warn';
                            el.title = z.grund || 'Der Server ist noch nicht auf der letzten Stufe.';
                        }
                        break;
                    }

                    case 'stufe-punkt': {
                        // Dieselben drei Farben mit denselben drei Bedeutungen
                        // wie beim serverseitigen Zeichnen — sonst springt die
                        // Karte beim Neuladen um.
                        const meine   = LEITER.indexOf(el.dataset.fbStufe);
                        const laeuft  = z.status === 'online' || z.status === 'starting';
                        const wieWeit = LEITER.indexOf(z.stufe);
                        const verlangt = el.dataset.fbVerlangt !== 'nein';

                        let farbe;
                        if (!verlangt)                              farbe = '#f1f3f5';
                        else if (laeuft && wieWeit >= 0 && meine <= wieWeit) farbe = 'var(--fb-success)';
                        else if (laeuft && wieWeit >= 0 && meine === wieWeit + 1) farbe = 'var(--fb-warning)';
                        else                                        farbe = 'var(--fb-border)';
                        el.style.background = farbe;
                        break;
                    }

                    case 'bereitschaft-grund': {
                        const laeuft = z.status === 'online' || z.status === 'starting';
                        el.textContent = (laeuft && z.grund) ? z.grund : '';
                        el.style.display = (laeuft && z.grund) ? '' : 'none';
                        break;
                    }

                    case 'spieler': {
                        el.textContent = (z.spieler === null || z.spieler === undefined)
                            ? '—' : String(z.spieler);
                        break;
                    }
                }
            }
        }
    }

    window.GameserverLiveAnzeige = LiveAnzeige;

    // Selbst starten, wenn die Seite einen SSE-Client bereitgestellt hat.
    document.addEventListener('DOMContentLoaded', () => {
        const wurzel = document.querySelector('[data-fb-live-guild]');
        if (!wurzel || !window.gameserverSSE) return;
        window.gameserverLive = new LiveAnzeige(window.gameserverSSE,
            wurzel.dataset.fbLiveGuild);
    });
})();
