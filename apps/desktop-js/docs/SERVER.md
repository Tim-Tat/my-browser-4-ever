# Aven Sync-Server betreiben

Der Server speichert Konten und verschlüsselte Sync-Daten. Das Protokoll steht in [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md). Er hat keine Abhängigkeiten und braucht **Node.js 24.7 oder neuer** (er nutzt `node:sqlite` und `crypto.argon2Sync`).

> **Hosting:** Der Server ist ein Node-Prozess. Auf einem klassischen PHP-Webhosting (zum Beispiel Hostpoint Shared Hosting) läuft er nicht. Dafür braucht es einen Server, den man selbst betreibt (VPS, eigener Rechner, Docker). Das README nannte PHP und MySQL als Idee, diese Umsetzung geht einen anderen Weg.

## Starten

```bash
cd server
node index.js gen-keys > .env
node --env-file=.env index.js
```

`gen-keys` erzeugt zwei Schlüssel. Sie gehören nur in die Umgebung des Servers, nie ins Repository, nie in ein Backup neben der Datenbank.

- `AVEN_SEARCH_KEY` macht aus E-Mail-Adressen den Suchindex (HMAC). Wechselt er, findet niemand sein Konto mehr.
- `AVEN_ESCROW_KEY` schützt die Treuhandkopien normaler Konten. Geht er verloren, ist die E-Mail-Wiederherstellung normaler Konten nicht mehr möglich. Ohne ihn startet der Server ohne Normalmodus, Ultra Privacy geht weiter.

## Docker

```bash
cd server
node index.js gen-keys > .env
docker compose up -d --build
```

Die Datenbank liegt im Volume `aven-data`.

## TLS

Der Browser akzeptiert nur `https://` (außer `localhost` für Entwicklung). Stelle einen Reverse-Proxy davor, der TLS beendet. Beispiel mit Caddy:

```text
sync.example.org {
    reverse_proxy 127.0.0.1:8787
    log { output discard }
}
```

Mit `AVEN_TRUST_PROXY=1` liest der Server die Client-Adresse aus `X-Forwarded-For` für die Rate-Limits. Nur setzen, wenn wirklich ein Proxy davor steht.

## Einstellungen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `AVEN_PORT`, `AVEN_HOST` | 8787, 127.0.0.1 | Wo der Server lauscht |
| `AVEN_DB` | `./aven-server.db` | SQLite-Datei |
| `AVEN_ALLOW_REGISTRATION` | an | `0` schließt neue Registrierungen |
| `AVEN_INACTIVITY_DAYS_ULTRA` | 180 | Löschung nach Inaktivität (Ultra Privacy) |
| `AVEN_INACTIVITY_DAYS_NORMAL` | 0 (aus) | Dasselbe für normale Konten |
| `AVEN_EXPORT_MIN_INTERVAL_MIN` | 10 | Mindestabstand zwischen Cloud-Exporten |
| `AVEN_EXPORT_TTL_MIN` | 60 | So lange bleibt ein fertiger Export abrufbar |
| `AVEN_QUOTA_MB` | 50 | Speicherplatz pro Konto |
| `AVEN_MAIL` | `console` | `smtp` für echten Versand |
| `AVEN_SMTP_HOST/PORT/SECURE/USER/PASS`, `AVEN_MAIL_FROM` | | SMTP-Zugang (Port 465 mit TLS, `AVEN_SMTP_SECURE=0` für Klartext zu einem lokalen Relay) |

Im Modus `console` schreibt der Server nur den Betreff ins Log. Der Code für die Wiederherstellung steht dann nirgends. Für echte Konten also SMTP einrichten und mit einem Testkonto prüfen.

## Datenschutz im Betrieb

- Der Server schreibt kein Zugriffslog und protokolliert keine IP-Adressen, E-Mail-Adressen oder Inhalte. Fehler erscheinen ohne Anfrageinhalt.
- Rate-Limits liegen nur im Arbeitsspeicher, mit gehashten Schlüsseln.
- Davor liegende Systeme (Reverse-Proxy, Hoster, Mailanbieter, Backups) haben eigene Logs. Sie müssen separat geprüft und so eingestellt werden, wie es die Datenschutzaussagen verlangen. Im Beispiel oben ist das Proxy-Log abgeschaltet.
- Eine Datenbank-Sicherung enthält Chiffretext und bei normalen Konten Treuhandkopien. Der `AVEN_ESCROW_KEY` darf nie im selben Backup liegen.

## Prüfen

```bash
cd server && npm test
```

Die Tests starten echte Server mit eigener Datenbank und decken Konten, Wiederherstellung, zweiten Faktor, Sync, Export, Lebenszeichen und Löschung ab. Nicht getestet ist der Versand über einen echten Mailserver und der Betrieb hinter einem TLS-Proxy.
