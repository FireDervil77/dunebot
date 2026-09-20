#!/usr/bin/env python3
"""Zeigt, welche Weltmodifikatoren in einer Valheim-Welt WIRKLICH stehen.

    python3 scripts/valheim-weltmodifikatoren.py <pfad-zur-.fwl2> [...]

⚠ DIESES WERKZEUG LIEST NUR. Es darf nie schreiben, und es gibt auch keinen
Grund dafuer: Eine von Hand veraenderte Weltdatei laedt Valheim nicht mehr —
dann ist die Welt hin. Gesetzt werden Modifikatoren ausschliesslich ueber die
Startparameter (`-preset`, `-modifier`, `-setkey`, `-resetmodifiers`); das
Schreiben macht das Spiel selbst.

## Wozu

Das Panel zeigt, was jemand EINGETRAGEN hat. Was in der WELT steht, ist etwas
anderes — Valheim speichert Modifikatoren dauerhaft, und ohne `-resetmodifiers`
fuegt ein Start nur hinzu. Genau diese Luecke hat am 2026-09-20 gekostet:
Server 186 trug `deathpenalty veryeasy` im Panel, der Aufraeum-Parameter lief
nie, und niemand konnte sehen, was die Welt tatsaechlich trug.

## Der Aufbau, gemessen am 2026-09-20 an vier echten Laeufen

Valheim 1.0.14, Abbild fb/steamcmd:2026.09. Nicht aus einer Doku:

    Lauf 1  -preset hard                               -> 6 Eintraege
    Lauf 2  -preset hard -modifier combat veryeasy     -> 7, combat sticht
    Lauf 3  ohne jeden Parameter                       -> die 6 bleiben
    Lauf 4  -resetmodifiers                            -> 0

Die Datei `_main.<n>.fwl2`:

    4 B  Laenge des Rumpfs
    4 B  Weltversion (41 bei Valheim 1.0.14)
    1 B  Laenge + Weltname
    1 B  Laenge + Seed als Text
    4 B  Seed als Zahl
    4 B  uid
    4 B  worldGenVersion
    4 B  ? (2)
    1 B  ? (1)
    4 B  ANZAHL der Modifikatoren
    je   1 B Laenge + Text, z. B. "playerdamage 85" oder "preset hard"

⚠ **Nicht in der `.db2` suchen.** Die Welt-Datenbank ist ab Offset 16 gzip, und
auch entpackt steht darin kein lesbarer Klartext. Wer dort sucht, findet nichts
und haelt das faelschlich fuer „keine Modifikatoren" — genau dieser Fehlschluss
ist am 2026-09-20 passiert, samt einem Fehltreffer auf den Ortsnamen
`CombatRuin01` bei der Suche nach „combat".
"""
import struct
import sys


def lies(pfad):
    """@returns (name, seed, [modifikatoren]) — oeffnet die Datei NUR lesend."""
    b = open(pfad, 'rb').read()
    p = 8                                   # Laenge + Weltversion

    def text():
        nonlocal p
        n = b[p]
        p += 1
        s = b[p:p + n].decode('utf-8', 'replace')
        p += n
        return s

    name, seed = text(), text()
    p += 4 + 4 + 4 + 4 + 1                  # seedzahl, uid, worldgen, ?, ?
    (anzahl,) = struct.unpack_from('<I', b, p)
    p += 4
    # Nicht raten, wenn der Aufbau nicht passt: Eine andere Weltversion wuerde
    # hier eine Fantasiezahl liefern, und der Rest waere frei erfunden.
    if anzahl > 64:
        raise ValueError(f'{anzahl} Eintraege — der Aufbau passt nicht, '
                         'vermutlich eine andere Weltversion')
    return name, seed, [text() for _ in range(anzahl)]


def main(pfade):
    if not pfade:
        print(__doc__.strip().split('\n\n')[0])
        print('\nAufruf: valheim-weltmodifikatoren.py <pfad-zur-.fwl2> [...]')
        return 2
    schlimm = 0
    for pfad in pfade:
        try:
            name, seed, werte = lies(pfad)
        except Exception as fehler:
            print(f'{pfad}: nicht lesbar — {fehler}')
            schlimm = 1
            continue
        print(f'{name} (Seed {seed}) — {len(werte)} Modifikator(en)')
        for w in werte:
            print(f'    {w}')
        if not werte:
            print('    (keine — die Welt steht auf Standard)')
    return schlimm


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
