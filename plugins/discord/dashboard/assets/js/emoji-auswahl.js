'use strict';

/**
 * Emoji-Auswahl fuer die Rollenmenues.
 *
 * Das Emoji-Feld war ein blankes Textfeld. Wer draufklickt, erwartet eine
 * Auswahl — bekam aber nichts und musste ein Zeichen von anderswo
 * hineinkopieren. Bei **Server-Emojis** war das praktisch unmoeglich: Discord
 * will dort `<:name:id>`, und die ID kennt niemand auswendig.
 *
 * Aufbau: ein Aufklapper am Feld mit zwei Bereichen. "Dieser Server" kommt
 * ueber `discord:holeEmojis` vom Bot, "Standard" steht hier in der Datei.
 *
 * Warum die Standard-Emojis fest hier stehen und nicht aus einem Paket kommen:
 * ein vollstaendiger Unicode-Satz sind rund 1900 Zeichen, von denen fuer ein
 * Rollenmenue vielleicht fuenfzig je gebraucht werden. Die Auswahl unten deckt
 * die gaengigen Faelle ab und kostet keine Abhaengigkeit und kein CDN. Wer ein
 * ausgefallenes Zeichen braucht, kann es weiterhin ins Feld tippen — das Feld
 * bleibt ein normales Textfeld.
 */
(function () {

    /** Standard-Emojis, nach Zweck gruppiert statt nach Unicode-Block. */
    const STANDARD = [
        ['Spiele & Aktivität', '🎮 🕹️ 🎲 🎯 🏆 ⚔️ 🛡️ 🏹 🪄 🔮 🚀 🛸 🏎️ ⚽ 🏀 🎿 🎣 🧗 🎨 🎬 🎵 🎤 🎧 📚 ✏️'],
        ['Menschen & Rollen',  '👑 🧙 🧝 🧛 🦸 🥷 👮 🕵️ 👷 🧑‍🌾 🧑‍🍳 🧑‍🔧 🧑‍💻 🧑‍🚀 🤝 👋 🙋 💬'],
        ['Tiere & Natur',      '🐉 🐺 🦊 🦁 🐯 🐻 🐼 🦅 🦉 🐍 🦂 🕷️ 🐝 🦋 🌲 🌵 🌊 🔥 ❄️ ⚡ 🌙 ⭐ ☀️ 🌈'],
        ['Zeichen & Status',   '✅ ❌ ⚠️ ❓ ❗ ➕ ➖ 🔔 🔕 🔒 🔓 🔑 📌 📢 🎉 💎 💰 ⏰ 🧭 🗺️ 🏳️ 🏴'],
        ['Herzen & Farben',    '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤'],
        ['Zahlen',             '1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🅰️ 🅱️ 🆎 🆑'],
    ].map(([titel, zeichen]) => ({ titel, zeichen: zeichen.split(' ').filter(Boolean) }));

    /** Server-Emojis, einmal geholt und dann behalten. */
    let serverEmojis = null;
    let holt = null;

    async function serverEmojisHolen(basis) {
        if (serverEmojis) return serverEmojis;
        if (holt) return holt;
        holt = fetch(`${basis}/emojis`)
            .then(r => r.json())
            .then(d => { serverEmojis = d.success ? (d.emojis || []) : []; return serverEmojis; })
            .catch(() => { serverEmojis = []; return serverEmojis; })
            .finally(() => { holt = null; });
        return holt;
    }

    const escHtml = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    /**
     * Haengt eine Auswahl an ein Textfeld.
     * @param {HTMLInputElement} feld
     * @param {string} basis Basisadresse der Rollenmenue-Routen
     */
    function anhaengen(feld, basis) {
        if (!feld || feld.dataset.emojiAuswahl === 'ja') return;
        feld.dataset.emojiAuswahl = 'ja';
        feld.setAttribute('autocomplete', 'off');

        const huelle = document.createElement('div');
        huelle.className = 'emoji-auswahl-huelle';
        huelle.style.position = 'relative';
        feld.parentNode.insertBefore(huelle, feld);
        huelle.appendChild(feld);

        const kasten = document.createElement('div');
        kasten.className = 'card emoji-auswahl';
        kasten.style.cssText = 'position:absolute;z-index:1080;width:22rem;max-width:90vw;display:none;top:100%;left:0;margin-top:.25rem;';
        kasten.innerHTML = `
            <div class="card-body p-2">
                <input type="text" class="form-control form-control-sm mb-2" placeholder="Suchen…" data-emoji-suche>
                <div data-emoji-liste style="max-height:16rem;overflow-y:auto;"></div>
            </div>`;
        huelle.appendChild(kasten);

        const liste = kasten.querySelector('[data-emoji-liste]');
        const suche = kasten.querySelector('[data-emoji-suche]');

        function knopf(inhalt, wert, titel) {
            return `<button type="button" class="btn btn-sm btn-ghost-secondary p-1"
                        style="font-size:1.15rem;line-height:1;"
                        title="${escHtml(titel)}" data-emoji-wert="${escHtml(wert)}">${inhalt}</button>`;
        }

        function zeichnen(filter = '') {
            const f = filter.trim().toLowerCase();
            let html = '';

            const eigene = (serverEmojis || []).filter(e => !f || e.name.toLowerCase().includes(f));
            if (eigene.length) {
                html += '<div class="text-secondary small mb-1">Dieser Server</div><div class="mb-2">';
                html += eigene.map(e => knopf(
                    `<img src="${escHtml(e.url)}" alt="${escHtml(e.name)}" style="width:1.4rem;height:1.4rem;object-fit:contain;">`,
                    e.kennung, `:${e.name}:`
                )).join('');
                html += '</div>';
            }

            for (const gruppe of STANDARD) {
                // Ohne Suchbegriff alles zeigen; mit Begriff nur passende Gruppen —
                // Standard-Emojis tragen keinen durchsuchbaren Namen, also ist der
                // Gruppentitel das Einzige, wonach sich sinnvoll suchen laesst.
                if (f && !gruppe.titel.toLowerCase().includes(f)) continue;
                html += `<div class="text-secondary small mb-1">${escHtml(gruppe.titel)}</div><div class="mb-2">`;
                html += gruppe.zeichen.map(z => knopf(z, z, z)).join('');
                html += '</div>';
            }

            if (!html) {
                html = '<div class="text-secondary small py-2">Nichts gefunden. Du kannst das Zeichen auch direkt ins Feld tippen.</div>';
            }
            liste.innerHTML = html;
        }

        function oeffnen() {
            kasten.style.display = '';
            zeichnen(suche.value);
            serverEmojisHolen(basis).then(() => {
                if (kasten.style.display !== 'none') zeichnen(suche.value);
            });
        }
        const schliessen = () => { kasten.style.display = 'none'; };

        feld.addEventListener('focus', oeffnen);
        feld.addEventListener('click', oeffnen);
        suche.addEventListener('input', () => zeichnen(suche.value));

        liste.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-emoji-wert]');
            if (!b) return;
            feld.value = b.dataset.emojiWert;
            feld.dispatchEvent(new Event('input', { bubbles: true }));
            feld.dispatchEvent(new Event('change', { bubbles: true }));
            schliessen();
        });

        // Klick daneben schliesst. Bewusst auf `mousedown`, nicht auf `click`:
        // sonst schliesst der Kasten, bevor der Klick auf einem Emoji ankommt.
        document.addEventListener('mousedown', (ev) => {
            if (!huelle.contains(ev.target)) schliessen();
        });
        feld.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') schliessen(); });
    }

    window.EmojiAuswahl = { anhaengen };
})();
