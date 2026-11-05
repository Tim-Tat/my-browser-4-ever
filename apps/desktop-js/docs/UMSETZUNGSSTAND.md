# Umsetzungsstand Aven 0.0.2

Stand: 4. November 2026. Dieses Dokument sagt, was im Code steckt, was getestet ist und was fehlt. Es ist keine Sicherheitszusage. Die Version ist eine Alpha, es gab keinen externen Sicherheitsreview.

## Starten und testen

```bash
npm install
npm start                       # Browser (Windows)
npm test                        # Browser-Tests inklusive Ende-zu-Ende gegen einen echten Server
cd server && npm test           # Server-Tests
```

Der Sync-Server ist in [SERVER.md](SERVER.md) beschrieben, das Protokoll in [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md).

## Umgesetzt

**Browser (README, Phase 0 bis 2, soweit lokal möglich)**
- Tabs, Pins, Spaces, Adressleiste mit Suche, Navigation, Wiederherstellung nach dem Neustart, Suche auf der Seite, Lesezeichen, Verlauf, Downloads, Berechtigungsabfragen, Tastenkürzel.
- Archiv (12 Stunden Standard), Aufbewahrung pro Kategorie bis „bis ich selbst lösche“, lokaler Export (JSON, CSV, HTML), „Datenschutz & meine Daten“.
- Erststart mit Willkommen, optionaler Anmeldung (überspringbar) und kurzem Tutorial. Asset-Paket aus dem Repository (Logo, Icons, Hintergrund, Farben).
- Lokale Daten mit dem Windows-Konto verschlüsselt (DPAPI).

**Konto und Sync (Datenschutzkonzept, Phase C bis E)**
- Selbst hostbarer Server ohne Abhängigkeiten, Docker-Dateien dabei. Konten, Sitzungen und Geräte, Passwort-Hash mit Argon2id, Sperre nach Fehlversuchen, Rate-Limits.
- **Normales Konto** mit E-Mail-Wiederherstellung über eine Treuhandkopie des Schlüssels. **Ultra Privacy** ohne Klartext-E-Mail und ohne Treuhandkopie, mit Wiederherstellungsschlüssel und destruktivem Reset. Moduswechsel in beide Richtungen.
- Clientseitige Verschlüsselung (AES-256-GCM, scrypt), Sync von Spaces, Tabs, Lesezeichen, Archiv, Einstellungen und Verlauf (getrennt abschaltbar), Löschmarkierungen, Konflikte nach Zeitstempel.
- Zweiter Faktor (TOTP) mit Einmalcodes. Die Wiederherstellung umgeht ihn nicht.
- Lebenszeichen höchstens einmal pro Tag, Löschung nach Inaktivität (Ultra 180 Tage, einstellbar), Warnung 30 Tage vorher.
- Cloud-Export (ein Auftrag pro Konto, Mindestabstand, Warteschlange, Chiffretext, Entschlüsselung auf dem Gerät), Konto löschen, Notfall-Löschung mit Ausweis „ausstehend“ bei Ausfall.
- Notfallknopf mit einstellbaren Schritten: Darkweb beenden, Tabs, Verlauf/Archiv, Website-Daten, Sync stoppen, Konto löschen, Passwort-Tresor sperren oder löschen, Profil zurücksetzen. Jeder Schritt meldet sein Ergebnis einzeln.

**Passwort-Tresor** ([PASSWORD_VAULT.md](PASSWORD_VAULT.md)): Meisterpasswort, Bindung an das Windows-Konto, Wiederherstellungsschlüssel, automatische Sperre, Generator, Sicherheitscheck, Datenleck-Prüfung auf Klick, CSV-Import, verschlüsselte Sicherung, Speichern-Angebot und Ausfüllen nur auf Klick.

**Darkweb-Modus** ([DARKWEB.md](DARKWEB.md)): eigenes Fenster ohne Speicherung, nur über lokales Tor, fail-closed, lokale Ziele gesperrt, Sicherheitsstufen, verschlüsselter Container für Lesezeichen.

## Getestet

Automatische Tests: Browser-Logik, Konto-Kryptografie, Sync zwischen zwei Geräten gegen einen echten Server, Wiederherstellung, Tresor (Manipulation, Gerätebindung, Fehlversuche), Darkweb-Bausteine, Server (16 Tests). Dazu Läufe in der echten App: Konto anlegen und synchronisieren, Tresor mit Windows-Verschlüsselung, Anmeldung erkennen, Speichern und Ausfüllen auf einer Testseite, Notfallknopf, Darkweb-Fenster mit einem Ersatz-Tor (ohne Tor alles blockiert, mit Tor als Domainname am Proxy).

## Nicht getestet

- Docker-Dateien (Docker lief nicht), Betrieb hinter TLS-Proxy, Mailversand über einen echten SMTP-Server.
- Das echte Tor-Programm und das Tor-Netzwerk, Leak-Tests auf Testseiten (DNS, WebRTC, HTTP/3), Bridges.
- Installer (`npm run dist`, electron-builder), Signierung, Auto-Update.
- Last und Dauerbetrieb des Servers, Mehrgeräte-Konflikte unter Last.

## Nicht umgesetzt

| Thema | Grund |
| --- | --- |
| iOS-App | Braucht macOS und Xcode, unter Windows nicht baubar oder testbar. |
| Passkeys, FIDO2, WebAuthn | Server und Browser bräuchten eine geprüfte WebAuthn-Umsetzung, und ob Chromium in Electron Passkeys zuverlässig anbietet, ist nicht belegt. Zweiter Faktor ist TOTP. |
| Cookie- und Login-Sync | Laut Konzept ein eigenes Forschungsthema. Passwörter werden bewusst nicht synchronisiert. |
| Erweiterungen | Eigenes Thema laut README. |
| Import aus anderen Browsern (außer Passwort-CSV) | Nicht beschlossen. |
| Externer Sicherheitsreview, Rechts- und Markenprüfung | Nötig vor jeder Werbeaussage und vor einer Veröffentlichung. |
| Hostpoint | Der Server ist ein Node-Prozess und läuft nicht auf PHP-Webhosting. Die Fragen des Konzepts an den Hoster bleiben offen. |

## Offene Entscheidungen aus dem Konzept

Die offenen Punkte in Abschnitt 14 des Datenschutzkonzepts sind mit Vorgaben umgesetzt, die sich ändern lassen: Ultra Privacy erlaubt Mail-Reset nur destruktiv oder mit Wiederherstellungsschlüssel, die 180 Tage sind einstellbar, Passkeys fehlen, Export-Mindestabstand 10 Minuten. Das sind Vorschläge, keine Beschlüsse.
