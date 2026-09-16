# Was hier nicht mehr steht, und warum

Stand 2026-09-16. Gehört zu `docs/Sperrsystem.md`.

## Entfernt: die Exploit-Regel für fail2ban

**Dateien:** `fail2ban-dunebot-exploits.conf`, `fail2ban-jail-dunebot.conf`

Die Regel `[dunebot-exploits]` bannte Website-Besucher auf iptables-Ebene, nach
**einem** Treffer, **dauerhaft**. Sie hat seit der Umbenennung von DuneBot auf
FireBot niemanden mehr gebannt — drei verschiedene Namen für dieselbe Kennung
(siehe `docs/Sperrsystem.md`, Befund 2.1).

**Sie wird nicht repariert, sondern stillgelegt.** Entscheidung des Betreibers
vom 2026-09-16: Auf der Website soll fail2ban niemanden mehr aussperren. Der
Exploit-Blocker in der Anwendung tut dasselbe besser — er gibt 403, merkt sich
die Adresse in `blocked_ips`, und man kann dort nachsehen und entsperren. Die
iptables-Sperre sparte nur Rechenzeit, und das zählt erst bei Dauerbeschuss.

**Auf dem Server noch installiert.** Zum Abschalten:

```bash
sudo rm /etc/fail2ban/jail.d/dunebot.local
sudo rm /etc/fail2ban/filter.d/dunebot-exploits.conf
sudo systemctl reload fail2ban
sudo fail2ban-client status        # dunebot-exploits darf nicht mehr auftauchen
```

Das Log `/var/log/dunebot-exploits.log` schreibt die Middleware weiter. Es
schadet nicht und ist als Nachweis nützlich — wer es nicht will, nimmt in
`exploit-blocker.middleware.js` das Schreiben heraus.

## Noch zu prüfen

Diese Dateien beschreiben Systeme, die das Runbook vom 2026-07-27 stillgelegt
hat. Sie stehen noch hier, weil niemand nachgemessen hat, ob sie wirklich weg
sind — das braucht Root:

- `fail2ban-jail-dunebot-db.conf`, `fail2ban-filter-dunebot-db.conf`,
  `fail2ban-db-reader.py`, `setup-fail2ban-db.sh` — Regel `dunebot-db`
- `sync-blocked-ips-to-firewall.js` — die `DUNEBOT_BLOCKED`-Chain
- `sync-blocked-ips-to-fail2ban.js` — schiebt `blocked_ips` nach fail2ban;
  mit der stillgelegten Exploit-Regel ohne Ziel

Prüfen mit `sudo fail2ban-client status` und `sudo iptables -L INPUT -n`.
