# Aven Sync-Protokoll v1 (Spezifikation)

Dieses Dokument legt Schlüsselhierarchie und Protokoll fest, bevor der Code entsteht (Datenschutzkonzept, Phase B). Es ersetzt keinen externen Security-Review.

## Ziele und Grenzen
- Konto und Sync sind optional. Der Browser funktioniert ohne beides.
- Der Server speichert nur Chiffretext. Inhalte werden auf dem Gerät mit einem zufälligen Datenschlüssel (DEK) verschlüsselt.
- **Normales Konto:** Wiederherstellung über E-Mail, deshalb liegt beim Server eine Treuhandkopie des DEK (Escrow). **Das ist nicht Zero-Knowledge** und wird nirgends so genannt.
- **Ultra Privacy:** keine Treuhandkopie, keine Klartext-E-Mail im Konto. Ohne Passwort, autorisiertes Gerät oder Wiederherstellungsschlüssel sind alte Daten unlesbar.
- Nicht zugesagt: Anonymität, Schutz vor kompromittierten Geräten, Schutz vor einem Betreiber, der manipulierte Clients ausliefert.
- Nicht synchronisiert: Cookies, Sitzungen, Passwörter.

## Schlüssel
| Schlüssel | Entstehung | Verwendung |
| --- | --- | --- |
| `kdfSalt` | 16 Zufallsbytes pro Konto, liegt auf dem Server | Salz für die Passwortableitung |
| `authKey`, `wrapKey` | `scrypt(passwort, kdfSalt, N=2^15, r=8, p=1, 64 Bytes)`, erste 32 Bytes = `authKey`, letzte 32 = `wrapKey` | `authKey` beweist die Anmeldung, `wrapKey` verlässt das Gerät nie |
| DEK | 32 Zufallsbytes, nicht aus Passwort, ID oder E-Mail abgeleitet | AES-256-GCM für alle Datensätze |
| `wrappedDek` | `AES-256-GCM(DEK, wrapKey)` | Geräte holen den DEK nach der Anmeldung |
| Wiederherstellungsschlüssel | 32 Zufallsbytes, dem Nutzer als Text gezeigt, nie gespeichert | `recoveryWrappedDek = AES-256-GCM(DEK, recoveryKey)` liegt auf dem Server |
| Escrow (nur normal) | `AES-256-GCM(DEK, AVEN_ESCROW_KEY)`, der Schlüssel liegt nur in der Server-Umgebung | E-Mail-Wiederherstellung |

Der Server prüft `authKey` mit `argon2id(authKey, serverSalt)`. Das Passwort selbst erreicht den Server nie.

## E-Mail
Kontosuche über `HMAC-SHA-256(AVEN_SEARCH_KEY, normalisierteEmail)`. Normalisierung: trimmen und kleinschreiben, sonst nichts (keine Punkt- oder Plus-Regeln). Ultra speichert nur diesen Index. Normal speichert die Adresse zusätzlich für Wiederherstellungsmails. Beim Anmelden und Registrieren liegt die Adresse kurz im Arbeitsspeicher des Servers; auch Mailanbieter sehen sie.

`/prelogin` liefert für unbekannte Adressen ein stabiles Scheinsalz, damit Adressen nicht erraten werden können.

## Datensätze
`{collection, id, blob, updatedAt, deleted}`. `blob` ist `base64(nonce(12) || ciphertext || tag(16))` über das JSON des Eintrags. Zusätzliche authentifizierte Daten (AAD): `collection + "/" + id`. Löschen erzeugt einen Tombstone. Der Server vergibt pro Konto eine steigende `seq`. Konflikte löst der Client: gewinnt der Eintrag mit dem neueren `updatedAt`.

Sammlungen: `spaces`, `tabs`, `archive`, `history`, `bookmarks`, `settings`. Jede ist einzeln abschaltbar, der Verlauf getrennt.

## Ablauf
- **Registrierung:** Client erzeugt DEK, `kdfSalt`, `wrappedDek`; Ultra zusätzlich `recoveryWrappedDek`. Normal sendet den DEK einmal für den Escrow (nur über HTTPS).
- **Anmeldung:** `/prelogin` → Ableitung → `/login`. Zweiter Faktor (TOTP oder Einmalcode) nur, wenn aktiviert.
- **Passwort vergessen, normal:** Mail-Token → Server gibt DEK über die Treuhandkopie frei → Client setzt neues Passwort. Ist 2FA aktiv, verlangt auch das einen zweiten Faktor.
- **Passwort vergessen, Ultra:** Mail-Token beweist nur Postfachzugriff. Mit Wiederherstellungsschlüssel bleibt alles lesbar, sonst gibt es nur den **destruktiven Reset** (Datensätze werden gelöscht, neuer DEK).
- **Modus wechseln:** Normal zu Ultra löscht die Treuhandkopie. Ultra zu Normal braucht ausdrückliche Zustimmung und einen DEK vom Gerät. Ältere Backups des Betreibers können Treuhandkopien noch bis zu ihrem Ablauf enthalten.
- **Lebenszeichen:** höchstens eines pro 24 Stunden, enthält nichts ausser dem Zeitpunkt. Sync und Hintergrundjobs zählen nicht.
- **Inaktivität:** Ultra standardmässig 180 Tage, normal aus (einstellbar). Der Server meldet die Restzeit, der Browser warnt 30 Tage vorher.
- **Export:** Step-up mit `authKey`, ein aktiver Auftrag pro Konto, Mindestabstand 10 Minuten, Warteschlange mit niedriger Priorität, Ergebnis nur als Chiffretext und eine Stunde gültig. Lesbar wird er erst auf dem Gerät.
- **Löschung:** `DELETE /v1/account` mit `authKey` löscht sofort. Der Client weist eine nicht bestätigte Löschung als ausstehend aus.
- **Notfall-Löschung:** `DELETE /v1/account/emergency` löscht das Konto allein mit der Gerätesitzung, damit der Notfallknopf ohne Passwort funktioniert. Wer eine gestohlene Sitzung hat, kann das Konto also löschen, aber nicht lesen. Das ist ein bewusster Kompromiss.

## Betrieb
- Kein Zugriffslog, keine IPs oder Adressen in Logs. Rate-Limits nur im Arbeitsspeicher mit gehashten Schlüsseln.
- Geheimnisse (`AVEN_SEARCH_KEY`, `AVEN_ESCROW_KEY`) nur über die Umgebung, nie im Repository.
- Davor angeordnete Systeme (Reverse-Proxy, Hoster, Mailanbieter) haben eigene Logs und müssen separat geprüft werden.
