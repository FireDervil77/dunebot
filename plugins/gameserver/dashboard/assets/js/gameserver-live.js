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

    /**
     * Wie steht die Bereitschaftspille? — eine reine Rechnung.
     *
     * ── Warum sie hier steht und nicht in der Vorlage (2026-09-17) ──────────
     *
     * Der Betreiber nach dem ersten Rollout: *"das 'noch nichts gemeldet'
     * erscheint leider auch nicht von alleine, nur nach Seite neu laden."*
     *
     * Ursache war dieselbe wie bei den Knoepfen: Die Vorlage rendert die Pille
     * nur `if (online || starting)`. Wer die Seite bei ausgeschaltetem Server
     * oeffnet und dann auf Starten klickt, hat das Element gar nicht im DOM —
     * das Modul sucht es, findet nichts und zeichnet nichts. Kein Fehler,
     * keine Meldung, genau wie beim ersten Mal.
     *
     * Jetzt steht die Pille immer da und wird hier geschaltet.
     *
     * `wartet` ist der Wunsch des Betreibers: *"wenn da steht, es wurde noch
     * nichts gemeldet, koennte man dort eine Sanduhr einblenden. Dann weiss
     * man ohne auf die Konsole zu schauen, dass der Server gerade etwas tut."*
     *
     * @param {{status?: string, bereit?: boolean, messbar?: boolean,
     *          text?: string, grund?: string}} z
     * @returns {{sichtbar: boolean, text: string, klasse: string,
     *            titel: string, wartet: boolean}}
     */
    function pillenZustand(z = {}) {
        const laeuft = z.status === 'online' || z.status === 'starting';

        // Steht der Server, sagt die Bereitschaft nichts ueber jetzt. Eine
        // Pille mit dem Stand von vorhin waere schlimmer als keine.
        if (!laeuft) {
            return { sichtbar: false, text: '', klasse: 'fb-pille', titel: '', wartet: false };
        }

        // Kein `ready_when` im Paket: Es gibt nichts zu messen, also wird auch
        // nicht gewartet. Eine Sanduhr hier hiesse "gleich", und es kaeme nie.
        if (z.messbar === false) {
            return {
                sichtbar: true, text: 'nicht messbar', klasse: 'fb-pille',
                titel: 'Das Paket verlangt keine Bereitschaftspruefung.', wartet: false,
            };
        }

        if (z.bereit === true) {
            return {
                sichtbar: true, text: 'Spieler können rein',
                klasse: 'fb-pille fb-pille-gut',
                titel: 'Alle verlangten Stufen sind erreicht.', wartet: false,
            };
        }

        return {
            sichtbar: true,
            text:   z.text || 'noch nichts gemeldet',
            klasse: 'fb-pille fb-pille-warn',
            titel:  z.grund || 'Der Server hat noch keine Bereitschaftsstufe gemeldet.',
            wartet: true,
        };
    }

    /**
     * Welcher Knopf ist sichtbar, welcher aktiv? — eine reine Rechnung.
     *
     * ── Warum das eine eigene Funktion ist (Baustelle 134) ──────────────────
     *
     * Weil sie sonst nur im Browser existiert und niemand sie messen kann.
     * `scripts/check-knopfzeile.js` ruft genau diese Funktion auf; stuende die
     * Regel im `switch`, waere sie "vorhanden, aber ungeprueft" — und genau
     * solche Stellen fallen hier beim ersten Einsatz um.
     *
     * Die Regeln:
     *   Starten     nur wenn nichts laeuft und nichts werkelt
     *   Neu starten erst wenn der Server wirklich steht (bereit ODER das Paket
     *               misst gar keine Bereitschaft)
     *   Stoppen     solange irgendetwas laeuft — auch beim Starten, denn ein
     *               haengender Start braucht einen Weg zurueck
     *
     * @param {{status?: string, bereit?: boolean, messbar?: boolean, text?: string}} z
     * @returns {{start: object, restart: object, stop: object}}
     */
    function knopfZustand(z = {}) {
        const laeuft  = z.status === 'online' || z.status === 'starting';
        const werkelt = z.status === 'stopping'
                     || z.status === 'installing'
                     || z.status === 'updating';
        // Kein `ready_when` heisst NICHT "nicht bereit" — sonst waere so ein
        // Server nie neu startbar.
        const steht = z.bereit === true || z.messbar === false;

        const neustartbar = z.status === 'online' && steht;

        // `grund` steht nur an einem GESPERRTEN Knopf. Ein Grund neben einem
        // aktiven Knopf waere ein Hinweis auf ein Hindernis, das es nicht gibt.
        return {
            // Sichtbar, sobald nichts laeuft — auch waehrend er werkelt, dann
            // aber gesperrt. Ihn ganz auszublenden liesse die Knopfzeile beim
            // Installieren und Stoppen LEER, und eine leere Zeile sagt einem
            // Betreiber nicht, ob er etwas uebersehen hat. Ein gesperrter Knopf
            // mit Begruendung sagt "gleich wieder".
            start: {
                sichtbar: !laeuft,
                aktiv:    !werkelt,
                grund:    werkelt ? 'Der Server ist gerade beschäftigt.' : '',
            },
            restart: {
                sichtbar: laeuft,
                aktiv:    neustartbar,
                grund:    neustartbar ? ''
                        : z.status === 'starting'
                            ? (z.text ? `Startet noch — ${z.text}.` : 'Der Server startet noch.')
                            : 'Der Server ist noch nicht bereit.',
            },
            stop: {
                sichtbar: laeuft,
                aktiv:    laeuft,
                grund:    '',
            },
        };
    }

    /**
     * Die vier Kachelzahlen aus allen bekannten Serverzustaenden.
     *
     * ── Warum das hier steht und nicht auf dem Server (2026-09-18, B140) ────
     *
     * Die Kacheln kamen von der alten Dashboard-Seite, die dafuer eine eigene
     * SQL-Abfrage hatte. Beim Zusammenlegen rechnet sie serverseitig
     * `baueServerListe` aus DERSELBEN Liste, die auch die Tabelle fuellt — und
     * hier noch einmal aus den Live-Zustaenden, damit die Kachel mitzaehlt,
     * ohne dass jemand neu laedt.
     *
     * **Beide Rechnungen muessen dieselbe sein**, sonst springt die Zahl beim
     * ersten Live-Abruf. Deshalb steht sie hier so ausgeschrieben wie dort:
     *
     *   - `alle` ist NICHT `online + aus` — wer gerade startet, zaehlt in
     *     keiner der beiden Kacheln.
     *   - Nur GEMESSENE Spieler summieren. `null` heisst „nicht gemessen" und
     *     darf nicht als 0 durchgehen.
     *
     * Reine Rechnung, keine Beruehrung mit dem Dokument — deshalb in node
     * pruefbar (`scripts/check-live-zahlen.js`).
     *
     * @param {Iterable<{status?: string, spieler?: number}>} zustaende
     * @returns {{alle: number, online: number, aus: number, spieler: number}}
     */
    function summen(zustaende) {
        let alle = 0, online = 0, aus = 0, spieler = 0;

        for (const z of zustaende) {
            alle++;
            if (z.status === 'online') online++;
            else if (z.status === 'offline') aus++;
            if (typeof z.spieler === 'number') spieler += z.spieler;
        }

        return { alle, online, aus, spieler };
    }

    class LiveAnzeige {
        constructor(sse, guildId) {
            this.sse = sse;
            this.guildId = guildId;
            this.zustand = new Map();   // serverId → { status, stufe, grund, spieler, max }

            // Diese zwei Ereignisse aendern die BEURTEILUNG (bereit / nicht
            // bereit), und die rechnet der Server. Also erst den Rohwert
            // uebernehmen, damit die Anzeige sofort reagiert, dann die
            // Beurteilung nachholen. Ohne das Nachholen stuenden die Knoepfe
            // auf dem Stand von vor dem Ereignis.
            sse.on('status_changed', (d) => {
                this.uebernimm(d.server_id, { status: d.status });
                this.holeBald();
            });
            sse.on('readiness', (d) => {
                this.uebernimm(d.server_id, { stufe: d.stufe, grund: d.grund });
                this.holeBald();
            });
            // Die Spielerzahl aendert keine Beurteilung — hier wird NICHT
            // nachgeholt. Sie kommt im Sekundentakt; ein Abruf je Messwert
            // waere eine Last ohne Gegenwert.
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
            this.summenBald();
        }

        /**
         * Die Kacheln einmal nachziehen, nicht je Server.
         *
         * `holeAlles` ruft `uebernimm` in einer Schleife. Wer die Summe dort
         * direkt zeichnet, rechnet sie bei achtzig Servern achtzigmal ueber
         * achtzig Eintraege. Ein Sprung ans Ende der Warteschlange reicht: Die
         * Schleife ist dann durch, und gezeichnet wird genau einmal.
         */
        summenBald() {
            if (this._summenGeplant) return;
            this._summenGeplant = true;
            Promise.resolve().then(() => {
                this._summenGeplant = false;
                this.zeichneSummen();
            });
        }

        /**
         * Die Kachelzahlen ins Dokument schreiben.
         *
         * **Nur wenn ueberhaupt ein Zustand bekannt ist.** Vor dem ersten
         * Abruf ist `zustand` leer, und `summen` gaebe dafuer lauter Nullen
         * zurueck. Die wuerden die serverseitig gerenderten Zahlen ueberschreiben
         * — die Seite zeigte kurz "0 Server", obwohl zwei dastehen. Was der
         * Server gerendert hat, ist bis zum ersten Abruf der bessere Wert.
         */
        zeichneSummen() {
            if (!this.zustand.size) return;

            const s = summen(this.zustand.values());

            for (const el of document.querySelectorAll('[data-fb-live-summe]')) {
                const wert = s[el.dataset.fbLiveSumme];
                if (wert === undefined) continue;
                const neu = String(wert);
                if (el.textContent !== neu) el.textContent = neu;
            }
        }

        /**
         * Bald nachholen — mehrere Ereignisse kurz hintereinander kosten einen
         * Abruf, nicht fuenf. Ein Statuswechsel zieht meist eine Bereitschafts-
         * meldung nach sich; beide zusammen sollen EINEN Abruf ausloesen.
         */
        holeBald() {
            clearTimeout(this._holeGleich);
            this._holeGleich = setTimeout(() => this.holeAlles(), 250);
        }

        async holeAlles() {
            try {
                const r = await fetch(
                    `/guild/${this.guildId}/plugins/gameserver/servers/status`,
                    { headers: { Accept: 'application/json' } });
                if (!r.ok) return;
                const d = await r.json();
                for (const s of (d.servers || [])) {
                    // `bereitschaft` ist die BEURTEILUNG vom Server (seit
                    // Baustelle 134). Sie hier nachzurechnen waere der zweite
                    // Weg — und der erste war schon falsch: Das Modul pruefte
                    // `stufe === 'query'` und hielt damit jeden Server, dessen
                    // Paket keine Abfrage verlangt, fuer nie bereit.
                    const b = s.bereitschaft || null;
                    this.uebernimm(s.id, {
                        status:  s.status,
                        stufe:   b ? b.stufe : s.bereitschaft_stufe,
                        grund:   b ? b.grund : s.bereitschaft_grund,
                        spieler: s.current_players,
                        max:     s.max_players,
                        bereit:  b ? b.bereit  : undefined,
                        messbar: b ? b.messbar : undefined,
                        text:    b ? b.text    : undefined,
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
                        // ── Baustelle 134: Hier stand `z.stufe === 'query'` ──
                        //
                        // Das war falsch fuer jedes Paket, das keine Abfrage
                        // verlangt: Dessen letzte Stufe ist `port` oder
                        // `process`, also wurde es NIE als bereit angezeigt.
                        // Die richtige Frage — "sind alle VERLANGTEN Stufen
                        // erreicht" — beantwortet der Server.
                        const s = pillenZustand(z);
                        el.hidden = !s.sichtbar;
                        el.className = s.klasse;
                        el.title = s.titel;

                        // Text und Wartemarke sind KINDER, nicht der Inhalt der
                        // Pille selbst: Ein `textContent` auf der Pille wuerde
                        // die Sanduhr bei jedem Zeichnen mit wegwerfen.
                        const textEl  = el.querySelector('[data-fb-pille="text"]');
                        const warteEl = el.querySelector('[data-fb-pille="warte"]');
                        if (textEl) textEl.textContent = s.text;
                        else el.textContent = s.text;   // alte Auszeichnung ohne Kinder
                        if (warteEl) warteEl.hidden = !s.wartet;
                        break;
                    }

                    case 'aktionen': {
                        // ── Die Knoepfe (Baustelle 134) ─────────────────────
                        //
                        // Vorher entschied die Vorlage beim Rendern, welche
                        // Knoepfe es GIBT. Der Statustext sprang live auf
                        // "Laeuft", und daneben stand weiter "Starten".
                        //
                        // Regeln, dieselben wie serverseitig:
                        //   Starten     — nur wenn nichts laeuft und nichts werkelt
                        //   Neu starten — erst wenn der Server wirklich steht
                        //   Stoppen     — solange irgendetwas laeuft
                        //
                        // "Stoppen" bleibt beim Starten ABSICHTLICH aktiv: Ein
                        // haengender Start braucht einen Weg zurueck. Gesperrt
                        // wird nur "Neu starten".
                        const soll = knopfZustand(z);
                        const setze = (aktion) => {
                            const b = el.querySelector(`[data-fb-aktion="${aktion}"]`);
                            if (!b) return;
                            const s = soll[aktion];
                            b.hidden = !s.sichtbar;
                            b.disabled = !s.aktiv;
                            // Ein gesperrter Knopf ohne Grund ist eine Sackgasse.
                            b.title = s.aktiv ? '' : (s.grund || '');
                        };
                        setze('start');
                        setze('restart');
                        setze('stop');
                        break;
                    }

                    case 'stufe-punkt': {
                        // Dieselben drei Farben mit denselben drei Bedeutungen
                        // wie beim serverseitigen Zeichnen — sonst springt die
                        // Karte beim Neuladen um.
                        //
                        // Baustelle 134: Hier wurde die Leiter fruehr selbst
                        // nachgerechnet (`LEITER.indexOf`). Jetzt kommt sie
                        // fertig beurteilt vom Server; nachgerechnet wird nur
                        // noch, wenn sie (aus einem Ereignis) fehlt.
                        const meineStufe = el.dataset.fbStufe;
                        const verlangt   = el.dataset.fbVerlangt !== 'nein';
                        const laeuft = z.status === 'online' || z.status === 'starting';

                        let erreicht, wartet;
                        const geliefert = (z.stufen || []).find(st => st.schluessel === meineStufe);
                        if (geliefert) {
                            erreicht = geliefert.erfuellt;
                            wartet   = geliefert.wartet;
                        } else {
                            const meine   = LEITER.indexOf(meineStufe);
                            const wieWeit = LEITER.indexOf(z.stufe);
                            erreicht = laeuft && wieWeit >= 0 && meine >= 0 && meine <= wieWeit;
                            wartet   = laeuft && wieWeit >= 0 && meine === wieWeit + 1;
                        }

                        let farbe;
                        if (!verlangt)   farbe = '#f1f3f5';
                        else if (erreicht) farbe = 'var(--fb-success)';
                        else if (wartet)   farbe = 'var(--fb-warning)';
                        else               farbe = 'var(--fb-border)';
                        el.style.background = farbe;
                        break;
                    }

                    case 'bereitschaft-text': {
                        // Der Satz unter den Balken in der Uebersicht —
                        // dieselbe Quelle wie `bereitschaftText` der Liste,
                        // und dieselbe Wartemarke wie auf der Serverseite.
                        // Zwei Darstellungen desselben Zustands waeren genau
                        // das, was hier gerade abgebaut wird.
                        const s = pillenZustand(z);
                        const textEl  = el.querySelector('[data-fb-live-text]');
                        const warteEl = el.querySelector('[data-fb-pille="warte"]');
                        if (textEl) textEl.textContent = z.text || s.text;
                        else if (z.text) el.textContent = z.text;
                        if (warteEl) warteEl.hidden = !s.wartet;
                        break;
                    }

                    case 'zustand-pille': {
                        const e = ZUSTAende[z.status] || { text: z.status || '—' };
                        el.textContent = e.text;
                        // Gruen heisst hier "laeuft", genau wie serverseitig
                        // (`baueZustand().gut`).
                        el.className = 'fb-pille' + (z.status === 'online' ? ' fb-pille-gut' : '');
                        break;
                    }

                    case 'spieler-paar': {
                        // "3 / 8" — und "nicht gemessen" ist etwas anderes als
                        // "0". Die Legende der Uebersicht sagt das ausdruecklich,
                        // also darf hier keine 0 stehen, wo nichts gemessen wurde.
                        if (z.spieler === null || z.spieler === undefined) {
                            el.innerHTML = '<span class="fb-muted" style="font-family:inherit">nicht gemessen</span>';
                        } else {
                            el.textContent = `${z.spieler} / ${(z.max === null || z.max === undefined) ? '?' : z.max}`;
                        }
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

    // Damit `scripts/check-knopfzeile.js` dieselbe Rechnung pruefen kann, die
    // der Browser benutzt — nicht eine nachgebaute daneben. Im Browser aendert
    // sich dadurch nichts; in node gibt es kein `window` und kein `document`,
    // deshalb steigt die Datei hier sauber aus, statt zu werfen.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { knopfZustand, pillenZustand, summen };
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    window.GameserverLiveAnzeige = LiveAnzeige;
    window.GameserverKnopfZustand = knopfZustand;
    window.GameserverPillenZustand = pillenZustand;
    window.GameserverSummen = summen;

    // ── Selbst starten — und den eigenen Empfaenger bauen ───────────────────
    //
    // Bis zum 2026-09-08 stand hier `if (!wurzel || !window.gameserverSSE)
    // return;`. **Beide Bedingungen waren nie erfuellt:** `data-fb-live-guild`
    // stand in keiner einzigen Vorlage, und `window.gameserverSSE` baute nur
    // die Dashboard-Seite in ihrem eigenen Inline-Skript. Das ganze Modul lief
    // also nie - lautlos, so wie ein `return` es tut.
    //
    // Jetzt reicht der Haken in der Vorlage. Ist noch kein Empfaenger da, baut
    // dieses Modul ihn aus der Guild-Kennung, die am Haken steht; ist schon
    // einer da (Dashboard-Seite), wird er MITBENUTZT - zwei Verbindungen fuer
    // dieselben Ereignisse waeren zwei Wege.
    document.addEventListener('DOMContentLoaded', () => {
        const wurzel = document.querySelector('[data-fb-live-guild]');
        if (!wurzel) return;

        const guildId = wurzel.dataset.fbLiveGuild;

        if (!window.gameserverSSE) {
            if (typeof window.GameserverSSEClient !== 'function') {
                // Melden statt ausweichen: Ohne Empfaenger bleibt die Seite
                // stehen, und genau dieses Schweigen hat das Modul ein Jahr
                // lang unbemerkt gelassen.
                console.error('[Gameserver] Live-Anzeige: GameserverSSEClient ist nicht geladen — '
                    + 'die Seite zeigt den Stand vom Aufruf und aktualisiert sich nicht.');
                return;
            }
            window.gameserverSSE = new window.GameserverSSEClient(guildId);
            window.gameserverSSE.connect();
        }

        window.gameserverLive = new LiveAnzeige(window.gameserverSSE, guildId);
    });
})();
