# Passwort-Tresor

Ein verschlüsselter Passwort-Manager, der nur lokal arbeitet. Passwörter werden nie synchronisiert (das Konzept führt Logins und Cookies als eigenes Forschungsthema).

## Schutz im Überblick

| Schicht | Umsetzung |
| --- | --- |
| Einträge | Jeder Eintrag einzeln mit AES-256-GCM. Die ID des Eintrags ist authentifiziert (AAD), ein Eintrag lässt sich nicht unter fremder ID einschleusen. Auf der Platte liegen nur ID und Zeitstempel im Klartext. |
| Tresorschlüssel (VK) | 32 Zufallsbytes, nie aus dem Passwort abgeleitet. |
| Meisterpasswort | scrypt mit N = 2^17, r = 8, p = 1 (128 MiB Speicher, OWASP-Empfehlung). Mindestens 12 Zeichen. Der daraus entstehende Schlüssel verpackt den VK. |
| Windows-Konto | Wenn verfügbar, wird der VK zusätzlich mit Windows DPAPI (`safeStorage`) gebunden. Zum Öffnen braucht es beides. Eine kopierte Datei ist auf einem anderen Konto oder Rechner wertlos, auch mit richtigem Passwort. |
| Wiederherstellungsschlüssel | Zufällig, 256 Bit, wird beim Anlegen einmal angezeigt und nie gespeichert. Er verpackt den VK ein zweites Mal, unabhängig von Passwort und Windows-Konto. Er funktioniert auch auf einem neuen Gerät und lässt sich erneuern. |
| Fehlversuche | Nach dem vierten Fehlversuch wächst die Wartezeit (2, 4, 8 … bis 15 Minuten). Der Zähler liegt in der Datei. Gegen einen Angreifer, der die Datei offline kopiert, schützt nur die Stärke von Passwort und scrypt, nicht diese Bremse. |
| Sperren | Nach 1, 5, 15, 30 oder 60 Minuten ohne Aktion, beim Sperren von Windows, im Ruhezustand, beim Beenden und im Notfall. Der Schlüssel wird beim Sperren überschrieben. |
| Manipulation | Ein veränderter Eintrag oder eine veränderte Liste wird erkannt. Dann bleibt der Tresor zu und es liegt nichts im Speicher. Vor jedem Schreiben entsteht eine `.bak`-Kopie. |

Format und Ablauf: [`src/main/vault/vault.js`](../src/main/vault/vault.js). Ableitung und Verpackung nutzen dieselben geprüften Bausteine wie die Kontoverschlüsselung (Node `crypto`), keine eigene Kryptografie.

## Speichern und Ausfüllen

- **Speichern:** Ein Skript in der Webseite meldet nur abgeschickte Anmeldeformulare, die der Nutzer selbst ausgelöst hat (`isTrusted`), und nur aus dem Hauptframe. Es merkt sich nichts. Der Hauptprozess prüft, dass die Meldung von einem Tab kommt und zur Adresse des Tabs passt, und fragt nach, höchstens einmal pro Seite und Minute. „Nie für diese Seite“ wird verschlüsselt im Tresor gemerkt.
- **Ausfüllen:** Nur auf Klick des Nutzers (Schlüssel-Symbol), nur im sichtbaren Tab, nur auf einer passenden Seite. Passend heißt: gleicher Host (mit oder ohne `www.`), gleicher Port, kein Teilstring-Treffer. Zugangsdaten einer `https`-Seite werden nie auf `http` angeboten, und ausgefüllt wird nie über unverschlüsseltes `http` (außer `localhost`). Es gibt kein automatisches Ausfüllen beim Laden der Seite.
- **Zwischenablage:** Kopierte Passwörter werden nach 30 Sekunden gelöscht, wenn nichts anderes kopiert wurde.
- **Seiten-Schnittstelle:** Die Tresor-Aktionen sind nur von der Tresor-Seite aus erreichbar. Normale Webseiten sehen keine Schnittstelle.

## Weitere Funktionen

Passwort-Generator (kryptografischer Zufall), Stärkeschätzung, Sicherheitscheck (schwach, mehrfach verwendet, älter als ein Jahr), Datenleck-Prüfung pro Eintrag nur auf Klick (es gehen nur 5 Zeichen eines SHA-1-Hashes an `api.pwnedpasswords.com`), CSV-Import (Chrome, Firefox, Bitwarden), verschlüsselte Sicherung als Datei, Passwortverlauf pro Eintrag.

## Ehrliche Grenzen

- Wer dein entsperrtes Windows-Konto nutzt, während der Tresor offen ist, oder Schadsoftware mit Zugriff auf den Arbeitsspeicher hat, kommt an die Passwörter.
- JavaScript kann Zeichenketten im Speicher nicht zuverlässig überschreiben. Schlüssel liegen als Puffer vor und werden überschrieben, Passwörter als Text nicht.
- Die Webseite sieht ausgefüllte Werte. Das ist bei jedem Passwort-Manager so.
- Der CSV-Import liest Klartext-Dateien. Sie sollten danach gelöscht werden.
- Es gibt keine Formularerkennung für Anmeldungen, die ohne Formular-Absenden laufen (manche Einzelseiten-Apps). Dort legst du den Eintrag von Hand an.
- Kein Export als Klartext, mit Absicht.
- Es gab keinen externen Sicherheitsreview.
