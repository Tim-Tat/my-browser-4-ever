# Aven / My Browser 4 Ever — Datenschutz, Konten & Sicherheitsarchitektur

> **Status:** Konzept / Diskussionsstand, **keine fertige Sicherheitszusage**  
> **Stand:** 4. November 2026  
> **Projekt:** [My Browser 4 Ever](../README.md) · Produktname **Aven** (Arbeitstitel)  
> **Geltungsbereich:** Windows-/iOS-Browser, optionale Konten, Synchronisierung und Backend  
> **Priorität:** Transparenz und nachvollziehbare Sicherheit vor Marketingversprechen

---

## Inhaltsverzeichnis

1. [Vision und zentrale Grundsätze](#1-vision-und-zentrale-grundsätze)
2. [Produkt- und Datenschutzmodi](#2-produkt--und-datenschutzmodi)
3. [Datenmodell, Verlauf und Archiv](#3-datenmodell-verlauf-und-archiv)
4. [Konten, E-Mail-Adressen und Anmeldung](#4-konten-e-mail-adressen-und-anmeldung)
5. [Verschlüsselung und Schlüsselverwaltung](#5-verschlüsselung-und-schlüsselverwaltung)
6. [Passwortverlust und Kontowiederherstellung](#6-passwortverlust-und-kontowiederherstellung)
7. [Inaktivität und automatische Kontolöschung](#7-inaktivität-und-automatische-kontolöschung)
8. [Panic-Button und Notfalllöschung](#8-panic-button-und-notfalllöschung)
9. [Datenexport und Auskunft](#9-datenexport-und-auskunft)
10. [Serverprotokolle und Datenminimierung](#10-serverprotokolle-und-datenminimierung)
11. [Hosting und Betriebsmodell](#11-hosting-und-betriebsmodell)
12. [Bedrohungsmodell und Sicherheitsgrenzen](#12-bedrohungsmodell-und-sicherheitsgrenzen)
13. [Technischer Aufbau und Umsetzungsphasen](#13-technischer-aufbau-und-umsetzungsphasen)
14. [Offene Entscheidungen und Abnahmekriterien](#14-offene-entscheidungen-und-abnahmekriterien)

## Legende zur Verbindlichkeit

- **Festgelegt (Produktziel):** vom Projektinitiator ausdrücklich gewünscht.
- **Konzept (diskutiert):** gemeinsam besprochene Funktionsidee, noch nicht implementiert.
- **Empfehlung (technisch):** vorgeschlagene Umsetzung; durch Entwicklung und Review zu bestätigen.
- **Offen:** bislang nicht verbindlich entschieden.

**Wichtig:** Dieses Dokument beschreibt Ziele und einen möglichen technischen Weg. Es bestätigt **weder**, dass Funktionen bereits existieren, **noch**, dass konkrete Sicherheits- oder Löschgarantien erfüllt sind.

---

## 1. Vision und zentrale Grundsätze

Der Browser soll modern und angenehm wie ein produktiver Sidebar-/Spaces-Browser sein, dabei aber mit deutlich nachvollziehbarerem Umgang mit Nutzerdaten überzeugen.

**Festgelegte Produktziele:**

1. **Ohne Konto vollständig nutzbar.** Browsen, Tabs und lokale Organisation funktionieren auch ohne Registrierung.
2. **Konto und Synchronisierung sind optional.** Niemand wird für die Browser-Grundfunktionen zur Anmeldung gezwungen.
3. **Datensparsamkeit als Standard.** Der Browser-Anbieter speichert nur Daten, die für aktivierte Dienste technisch und funktional erforderlich sind.
4. **Wahlfreiheit.** Wer maximale Privatsphäre will, kann einen strengeren Kontomodus aktivieren; Sicherheitsmassnahmen sollen weitgehend konfigurierbar sein.
5. **Transparenz statt Versprechen.** Jede relevante Speicherung, Übertragung, Verschlüsselung, Protokollierung und Löschaktion wird verständlich erklärt.
6. **Nutzerkontrolle.** Daten dürfen vom Nutzer langfristig aufbewahrt, selektiv gelöscht und exportiert werden.
7. **Kein Lock-in.** Exporte verwenden dokumentierte, maschinenlesbare Formate. Ein universeller Import in andere Browser ist **kein** zugesagtes Feature.
8. **Sicherheitskritische Funktionen werden unabhängig geprüft**, bevor sie für gefährdete Personengruppen beworben werden.

Ein Journalist, eine Rechercheperson oder ein datenschutzbewusster Alltagsnutzer könnte von clientseitiger Verschlüsselung, geringer Anbieter-Einsicht und einfacher Bedienung profitieren. Das ist **keine** Aussage, dass Aven die Anonymitätseigenschaften von Tor Browser oder anderen spezialisierten Lösungen erreicht.

---

## 2. Produkt- und Datenschutzmodi

Die Diskussion hat drei miteinander verwandte, aber **nicht identische** Konzepte hervorgebracht: normales Konto, Ultra Privacy und einen zusätzlichen Notfall-/Safety-Modus.

| Eigenschaft | Ohne Konto | Normales Konto | Ultra Privacy (Konto) |
| --- | --- | --- | --- |
| Browsen ohne Backend | Ja | Ja | Ja |
| Lokale Tabs / Spaces / Verlauf | Ja | Ja | Ja |
| Optionale Geräte-Synchronisierung | Nein | Ja | Ja |
| Anmeldung per E-Mail/Passwort | Entfällt | Möglich | Möglich, ohne dauerhaft gespeicherte Klartext-E-Mail |
| Passkey / Hardware-Schlüssel | Entfällt | Optional | Optional |
| Passwort-Reset über E-Mail | Entfällt | Ja | Kontozugang ggf. zurücksetzbar; **alte Sync-Daten nicht dadurch entschlüsselbar** |
| Wiederherstellung aller Sync-Daten nur über E-Mail | Entfällt | **Produktziel: Ja** | **Nein** |
| Einsicht des Betreibers in Sync-Klartext | Keine Cloud-Daten | Technisch bei serverseitiger Recovery **möglich** | Soll kryptographisch ausgeschlossen sein |
| Automatische Inaktivitätslöschung | Entfällt | Offen | Ziel: ca. **180 Tage** |
| Datenexport | Lokal | Lokal + Cloud | Lokal + Cloud, entschlüsselt auf berechtigtem Gerät |

### 2.1 Normales Konto

**Festgelegt (Produktziel):** Ein gewöhnlicher Nutzer soll sein Passwort vergessen dürfen und **alle synchronisierten Browserdaten allein über die Kontrolle seiner E-Mail-Adresse** zurückerhalten können. Die Bedienung soll einfach sein.

**Technische Konsequenz:** Ein solcher Recovery-Pfad braucht einen unabhängig vom verlorenen Passwort verfügbaren Datenschlüssel beziehungsweise einen durch den Dienst wiederherstellbaren Zugriff. Deshalb lässt sich für dieses Modell **keine strikte Zero-Knowledge-Garantie gegenüber dem Betreiber** behaupten. Der Dienst kann die Daten im Normalbetrieb verschlüsselt speichern und nur auf dem Client anzeigen, verfügt aber prinzipiell über einen Recovery-Pfad.

### 2.2 Ultra Privacy Mode

**Festgelegt (Produktziel):** Der Anbieter soll möglichst wenig über den Nutzer wissen und insbesondere **keine E-Mail-Adresse im Klartext dauerhaft speichern oder aus einem gespeicherten Wert rekonstruieren können**. Synchronisierte Inhalte sollen für den Anbieter ohne Nutzerschlüssel nicht entschlüsselbar sein.

**Konzept:** E-Mail bleibt als eingegebener Anmeldename möglich. Der Server kann den Account über einen nicht direkt umkehrbaren Suchindex finden (Details in Abschnitt 4). Ein Passwort-Reset beweist dann **nicht** den Besitz des bisherigen Entschlüsselungsschlüssels. Ohne Wiederherstellungsschlüssel oder autorisiertes Gerät müssen alte Sync-Daten unzugänglich bleiben.

**Offen:** Ob nach E-Mail-verifiziertem Reset ein leeres Konto unter derselben Kennung eröffnet oder das alte Konto vollständig gelöscht und ein neues erstellt wird. Beides muss gegen Kontoübernahme und Account-Löschmissbrauch abgesichert werden.

### 2.3 Safety / Emergency / Panic Mode

Ein zusätzlich **optionaler** Notfallmodus mit dauerhaft sichtbarem Knopf oben rechts, sofern aktiviert. Er ist **kein Synonym** für Ultra Privacy und kann grundsätzlich unabhängig vom Kontomodus existieren.

Die einzelnen Lösch- und Sperraktionen sollen granular konfigurierbar sein. Details: Abschnitt 8.

---

## 3. Datenmodell, Verlauf und Archiv

### 3.1 Vorgesehene Datenarten

| Kategorie | Inhalt / Beispiele | Synchronisierung |
| --- | --- | --- |
| Spaces | Name, Anordnung, zugewiesene Tabs | Optional |
| Angeheftete Tabs / Pins | URL, Titel, Zuordnung, Reihenfolge | Optional |
| Offene Tabs | URL, Titel, Zustand, Fenster-/Space-Bezug | Optional |
| **Archiv** | Automatisch abgelegte Tabs (Arc-artiges Konzept) | Optional |
| **Verlauf** | Tatsächlich besuchte Seiten mit Zeitangaben | Optional; aufgrund Sensitivität getrennt steuerbar |
| Lesezeichen | URL, Titel, Ordner, Reihenfolge | Optional |
| Einstellungen | Ausgewählte browserübergreifende Präferenzen | Optional |
| Weitere Browserdaten | Nur nach eigener Sicherheitsprüfung | Noch nicht festgelegt |

**Archiv ist nicht Verlauf.** Bei der bisher besprochenen Bedienlogik werden nicht angeheftete Tabs standardmässig **nach ungefähr zwölf Stunden** aus der aktiven Tabansicht ins Archiv verschoben. Das ist nicht gleichbedeutend mit dem Löschen der Einträge oder mit dem Browserverlauf.

### 3.2 Aufbewahrung

**Festgelegt (Produktziel):** Der Nutzer soll bestimmen können, wie lange Daten aufbewahrt werden. Dazu gehört ausdrücklich die Option:

> **Auf unbestimmte Zeit speichern, bis ich einzelne Daten oder Kategorien selbst lösche.**

Diese Wahl kann für Archiv, Verlauf und weitere speicherwürdige Kategorien unabhängig vorgesehen werden. Löschen einzelner Objekte muss sich auch korrekt auf synchronisierte Geräte auswirken (Löschmarkierungen/Tombstones, Konfliktauflösung).

**Wichtige Grenze:** „Für immer speichern“ ist eine Aufbewahrungspräferenz, keine Garantie für unbegrenzte Serverkapazität, Unzerstörbarkeit oder ewige Kontoexistenz. Eine gegebenenfalls aktivierte automatische **Kontolöschung nach Inaktivität** hat Vorrang vor den gespeicherten Daten-Aufbewahrungspräferenzen. Der Browser muss diese Wechselwirkung klar anzeigen.

**Besonders sensibel:** Cookies, Session-Tokens und gespeicherte Passwörter sind nicht mit gewöhnlichen Lesezeichen gleichzusetzen. Plattformübergreifende Login-/Cookie-Synchronisierung bleibt gemäss der Projekt-README ein **eigenständiges langfristiges Forschungs- und Sicherheitsvorhaben**, kein zugesicherter Funktionsumfang.

---

## 4. Konten, E-Mail-Adressen und Anmeldung

### 4.1 Grundmodell

- Jeder Account erhält eine **zufällige, eindeutige interne Account-ID**.
- Passwörter werden **niemals im Klartext gespeichert**, sondern mit einem geeigneten speicherharten Passwort-Hash-Verfahren (Empfehlung: **Argon2id** mit individuellem Salt und geprüften Parametern) verifiziert.
- Die interne Account-ID ist **kein Verschlüsselungsschlüssel** und wird nicht zu einem gemacht.
- Anmeldung kann mit E-Mail und Passwort, Passkey oder weiteren aktivierten Faktoren erfolgen. Die konkrete Regelkombination ist konfigurierbar und noch zu definieren.

### 4.2 E-Mail ohne Klartextspeicherung (Ultra Privacy)

**Technischer Vorschlag:** Der Nutzer gibt seine E-Mail beim Login ein. Der Server bildet nach definierten, vorsichtigen Normalisierungsregeln einen **deterministischen, geheim geschlüsselten Suchindex**, beispielsweise:

`email_index = HMAC-SHA-256(server_search_key, normalized_email)`

Der Datenbankeintrag enthält den Suchindex, **nicht** die E-Mail. Beim nächsten Login erzeugt der Server mit der eingegebenen E-Mail denselben Index und kann so den Account finden.

Warum **kein einfacher SHA-256-Hash der E-Mail**? E-Mail-Adressen stammen aus einem begrenzten, erratbaren Wertebereich; Angreifer können häufige Adressen offline durchprobieren. Ein sicher verwalteter HMAC-Schlüssel erschwert diesen Angriff auf eine entwendete Datenbank deutlich.

**Einschränkungen, die nicht verschwiegen werden dürfen:**

- Während Registrierung und Login liegt die eingegebene E-Mail **kurzzeitig im Arbeitsspeicher des verarbeitenden Systems** vor. „Wir können sie unter keinen Umständen sehen“ wäre deshalb eine zu starke Behauptung, wenn der Server die E-Mail entgegennimmt.
- Ein Betreiber mit vollständiger Kontrolle über den laufenden Anmeldedienst könnte künftig Eingaben protokollieren oder den Suchschlüssel verwenden. Ein HMAC schützt die **gespeicherte Datenbank**, nicht vor jedem denkbaren Betreiberangriff.
- E-Mail-Versand erfordert während der Zustellung die Zieladresse; auch Mailanbieter und Transit-Systeme verarbeiten Metadaten.
- IP-Adressen, Zeitpunkte und Netzwerkanfragen können beim Hosting/Transport sichtbar sein.
- Die E-Mail-Normalisierung ist schwierig: insbesondere keine unüberlegte Vereinheitlichung von Punkten, Plus-Aliassen oder unterschiedlichen Providern.
- Schlüsselrotation, Backup und Schutz des HMAC-Schlüssels benötigen ein dokumentiertes Verfahren.

**Produktziel präzise formuliert:** *Keine dauerhaft gespeicherte Klartext-E-Mail im Ultra-Privacy-Kontodatensatz; keine Klartext-E-Mail in unseren Anwendunglogs.* Eine weitergehende Aussage verlangt ein gesondertes, überprüftes Systemdesign.

### 4.3 Verifikation und zusätzliche Faktoren

- **Passkeys:** WebAuthn/FIDO2; möglichst phishingresistente Anmeldung. Auch gerätegebundene Passkeys und physische FIDO2-Sicherheitsschlüssel (z. B. YubiKey) sind denkbar.
- **Physischer Schlüssel:** optional; kann ein Passkey-Authenticator sein und ist nicht zwangsläufig ein zusätzlicher, unabhängiger Faktor zu einem Passkey.
- **OTP:** steht für *One-Time Password* (Einmalpasswort), beispielsweise TOTP aus einer Authenticator-App; das ist **nicht** die Bezeichnung für den physischen Schlüssel.
- **Passwort + Passkey/Schlüssel:** als optionale strengere Anmeldeanforderung.
- **Mehrere Authenticatoren und Recovery-Codes:** empfohlen, um Aussperrungen zu reduzieren.
- **Klassische Sicherheitsfragen:** **nicht empfohlen**; Antworten sind oft recherchierbar, erratbar oder aus Datenlecks bekannt.

**Festgelegt:** Zusätzliche Sicherheitsfaktoren sollen **optional und konfigurierbar** sein, nicht global erzwungen werden.

**Sicherheitsvorbehalt:** Wenn ein Nutzer eine verpflichtende Mehrfaktor-Anmeldung konfiguriert, darf ein blosses E-Mail-Passwort-Reset diese Schutzstufe nicht unbemerkt umgehen. Account-Recovery braucht eine explizite Sicherheitsrichtlinie (z. B. zusätzliche Bestätigung, vorhandenes Gerät, Recovery-Code, Benachrichtigungen und Sperrfristen).

---

## 5. Verschlüsselung und Schlüsselverwaltung

### 5.1 Prinzip: Zufälliger Datenschlüssel pro Konto

Ein Client erzeugt einen kryptographisch zufälligen Schlüssel für die zu synchronisierenden Daten. Inhalte werden **vor der Übertragung** mit authentifizierter Verschlüsselung geschützt (z. B. eine korrekt implementierte AEAD-Konstruktion wie AES-256-GCM oder XChaCha20-Poly1305).

Der Account-ID wird lediglich ein **Schlüsseldatensatz zugeordnet**; der Datenschlüssel wird **nicht aus der ID, der E-Mail oder direkt aus einem beliebigen Passwort-Hash abgeleitet**.

```text
Browsergerät
  ├── Lokale Daten: Tabs, Spaces, Pins, Archiv, Verlauf
  ├── Zufälliger Account-Datenschlüssel
  ├── Clientseitige Verschlüsselung
  └── HTTPS → Sync-API → verschlüsselte Datensätze
                              │
                              └── Kein Klartext-Logging der Inhalte
```

### 5.2 Unterschied zwischen den Kontomodi

**Normales Konto – wiederherstellbar:**

- Der Datenschlüssel wird mit einer **serverseitig kontrollierten Recovery-Möglichkeit** abgesichert, beispielsweise als gesondert verschlüsselter Schlüssel unter einem vom Betreiber verwalteten KMS-Schlüssel.
- Nach einer legitimierten E-Mail-Recovery kann der Dienst dem neuen Gerät wieder Zugang zum Datenschlüssel verschaffen.
- **Konsequenz:** Ein entsprechend privilegierter Serverbetreiber oder ein Angreifer mit Zugang zum Recovery-System könnte theoretisch entschlüsseln. Daher **nicht als Zero-Knowledge oder strikt Ende-zu-Ende-verschlüsselt gegenüber dem Anbieter bewerben**.
- Zugriff auf Recovery-Schlüssel: strikt begrenzen, auditieren und technisch absichern; keine Rohschlüssel in Logs/Backups.

**Ultra Privacy – kein Betreiber-Recovery-Schlüssel:**

- Der Server speichert **keine für den Betreiber entschlüsselbare Kopie des Datenschlüssels**.
- Zugriff erhalten Geräte über einen geeigneten lokal geschützten Schlüsselmechanismus, ein bereits autorisiertes Gerät oder einen **nur dem Nutzer bekannten Wiederherstellungsschlüssel**.
- Ein Wiederherstellungscode sollte hohe, zufällige Entropie besitzen; ein menschlich gewähltes kurzes Passwort allein reicht ohne sorgfältigen Schutz gegen Offline-Angriffe möglicherweise nicht aus.
- **Passkey-Authentifizierung allein entschlüsselt keine Sync-Daten.** Gerätefreigabe/Key-Wrapping oder WebAuthn-PRF (nur nach Plattformprüfung) benötigen ein separates Konzept.
- Ein E-Mail-Passwort-Reset erzeugt **keinen alten Datenschlüssel**.

### 5.3 Modi wechseln

**Empfehlung:** Ein Wechsel von Normal zu Ultra Privacy darf nicht bloss ein UI-Schalter sein. Der Client muss den Schlüsselpfad neu einrichten, serverseitige Recovery-Fähigkeiten entfernen und verständlich warnen, dass ältere Backups/Schlüsselkopien möglicherweise bis zu ihrem Ablauf bestehen. Ohne verifizierte Bereinigung darf keine rückwirkende „nie einsehbar“-Garantie entstehen.

Ein Wechsel zurück zum normalen Modus darf nur nach bewusster Einwilligung erfolgen, wenn der Nutzer seinen vorhandenen Datenschlüssel auf einem berechtigten Gerät verfügbar hat und freiwillig eine serverseitige Recovery-Möglichkeit anlegt.

---

## 6. Passwortverlust und Kontowiederherstellung

| Situation | Normales Konto | Ultra Privacy |
| --- | --- | --- |
| Passwort vergessen, E-Mail-Postfach vorhanden | **Ziel:** Konto **und bisherige Sync-Daten** wiederherstellen | Anmeldezugang ggf. neu aufsetzen; **alte Daten bleiben ohne Schlüssel unlesbar** |
| Autorisiertes Gerät vorhanden | Bestehende Sitzung und Daten nutzbar; Re-Authentisierung gemäss Richtlinie | Gerät kann weiteren Zugriff beziehungsweise neuen Geräteschlüssel autorisieren |
| Privater Wiederherstellungsschlüssel vorhanden | Optional nutzbar | Ermöglicht Datenrettung nach sicherem Nachweis |
| Weder Schlüssel noch vertrauenswürdiges Gerät | E-Mail-Recovery-Pfad möglich | **Keine Wiederherstellung der alten Sync-Daten durch den Betreiber** |
| Alle Account-Daten nach Reset zurücksetzen | Nicht die Standardidee | Als expliziter Reset-/Neustartpfad möglich |

**Wichtige Trennung:** „Beweis des E-Mail-Postfachzugriffs“ ist kein hundertprozentiger Identitätsbeweis und keine kryptographische Autorisierung der alten Sync-Daten. Auch eine Regierung oder ein kompromittiertes Postfach könnte über diesen Weg unter Umständen die Account-Kontrolle erlangen. Im Ultra-Modus darf das nicht zur Entschlüsselung alter Sync-Daten führen.

**Offen:** Ob der Ultra-Modus **gar keinen E-Mail-Reset** unterstützt oder nur einen **destruktiven Reset**, der das alte verschlüsselte Konto nicht zugänglich macht. Im UI muss vor Datenverlust unmissverständlich gewarnt werden.

---

## 7. Inaktivität und automatische Kontolöschung

**Diskutiertes Ziel für Ultra Privacy:** Automatische Löschung des **Kontos und sämtlicher zugeordneter synchronisierter Serverdaten** nach ungefähr **180 Tagen** ohne echtes Browser-Lebenszeichen.

### 7.1 Lebenszeichen (Heartbeat)

- Ein authentifiziertes Gerät meldet, dass der Browser **tatsächlich benutzt** wurde.
- Empfehlung: höchstens **ein Lebenszeichen pro 24 Stunden**; der Server hält nur den aktuellen letzten Nutzungszeitpunkt vor.
- Ein rein automatischer Hintergrund-Sync oder periodischer Serverjob darf die Frist **nicht** unbeabsichtigt verlängern.
- Keine besuchten URLs, Tabtitel oder Surf-Historie im Heartbeat.
- Ein offline benutzter Browser kann keinen aktuellen Server-Heartbeat liefern.

### 7.2 Ablauf

1. Server aktualisiert `last_active_at` nach gültiger Nutzeraktivität.
2. Eine regelmässige Hintergrundaufgabe sucht abgelaufene Konten.
3. Falls vorgesehen: Warnhinweis im Browser z. B. **30 Tage vor Ablauf**, sofern das Gerät den Dienst noch kontaktiert. Ohne Kontakt ist diese Warnung nicht garantiert.
4. Nach Ablauf: Anmeldeberechtigungen widerrufen, aktive Serverdaten und Schlüsselmaterial nach dokumentiertem Verfahren löschen.
5. Backups, Replikate, Caches, Exportdateien und Logs haben **separate Löschfristen** und müssen in den Angaben berücksichtigt werden.

**Wichtig:** Lokale Daten auf einem über Monate offline betriebenen Gerät können weiter bestehen, während sein Cloud-Konto abgelaufen ist. Das darf nicht als „alle Daten überall gelöscht“ dargestellt werden.

**Offen:** Exakte Frist, Kulanz, Benachrichtigungen, ob nur Ultra Privacy oder auch das normale Konto eine konfigurierbare Frist erhält, und mögliche Aufbewahrungspflichten.

---

## 8. Panic-Button und Notfalllöschung

### 8.1 Gewünschtes Verhalten

**Festgelegt (Produktziel):** Ein **optional aktivierbarer, ständig sichtbarer Knopf oben rechts** soll eine unmittelbar zugängliche Notfallaktion auslösen. Der Nutzer muss vorher **präzise konfigurieren** können, was *wann, wo und in welcher Reihenfolge* geschieht. Denkbare Namen: **Safety Mode**, **Emergency Mode**, **Panic Mode**.

Beispielhafte **einzeln konfigurierbare** Aktionen:

| Aktion | Lokal | Cloud / andere Geräte | Hinweis |
| --- | --- | --- | --- |
| Offene Tabs schliessen | Sofort möglich | Nicht automatisch | Schliessen ist keine sichere Löschung |
| Verlauf und Archiv entfernen | Lokal ausführbar | Nur nach Sync-/Löschauftrag | Persistierte Kopien separat beachten |
| Cookies und Website-Daten löschen | Nach Browser-API | Nicht pauschal | Websites könnten bereits eigene Daten besitzen |
| Gespeicherte Passwörter/Schlüssel entfernen | Nur soweit vom Browser verwaltet | Server-Schlüsselmaterial separat | OS-Keychain / Credential Store beachten |
| Lokales Profil zurücksetzen | Je nach Dateizugriff | Keine automatische Cloud-Löschung | Laufende Prozesse/Locks berücksichtigen |
| Lokalen Entschlüsselungsschlüssel verwerfen | Bei korrekter Schlüsselhaltung schnell möglich | Remote-Kopien bleiben davon unabhängig | **Crypto-Erasure** erschwert Zugriff, ersetzt keinen Nachweis vollständiger physischer Löschung |
| Sync stoppen und Sitzungen sperren | Lokal möglich | Online-Server-Revocation möglich | Offline-Geräte nicht sofort erreichbar |
| Account/Sync-Daten löschen | Anfrage lokal auslösbar | Server muss Löschung **bestätigen** | Ohne Netz keine Sofortgarantie |
| Browser deinstallieren | Plattformabhängig | Keine Cloud-Wirkung | Kann Admin-/OS-Bestätigung erfordern |

### 8.2 Interaktion

- Der Knopf kann bei Aktivierung **ständig sichtbar** bleiben; Details von Grösse, Position und Symbol sind Designfragen.
- Schutz vor versehentlicher Aktivierung: z. B. **Gedrückthalten**, konfigurierbare Bestätigung oder anderer bewusster Auslöser. Keine feste 2-Sekunden-Regel ohne UX-Tests.
- Aktionen müssen **vorher** mit Konsequenzen angezeigt werden. Im akuten Notfall darf eine gewünschte lokale Schutzaktion nicht erst auf Admin-Rechte oder eine Serverantwort warten.
- Bei laufender Aktion: so wenig Klartext-/Auditspuren wie möglich; trotzdem muss der Nutzer verlässlich erfahren, ob lokal, serverseitig oder gar nicht gelöscht wurde.
- Nachher Wahl zwischen **leerem Browserprofil** und **zusätzlicher Deinstallation**. Letztere hängt vom Betriebssystem ab und ist kein Ersatz für lokale Datenlöschung.

### 8.3 Grenzen und ehrliche Hinweise

**Kein 100-%-Löschversprechen.** Mögliche verbleibende Kopien: SSD-/Dateisystem-Snapshots, Browser-Caches, Swap, Betriebssystem-Backups, Cloud-Replikate, bereits heruntergeladene Exporte, andere Endgeräte, DNS-/Netzwerkprotokolle sowie Daten auf besuchten Websites.

**Notfalltext (Entwurf):**

> Diese Funktion versucht, die ausgewählten Browserdaten möglichst schnell zu löschen beziehungsweise unzugänglich zu machen. Eine vollständige Entfernung aller Spuren auf sämtlichen Geräten, Datenträgern und Servern kann nicht garantiert werden. Welche Schritte erfolgreich waren, wird einzeln angezeigt.

**Wichtige Sicherheitseigenschaft:** Server-Löschung und Widerruf müssen gegen den Fehlerfall „offline / Timeout / Serverüberlastung“ getestet werden. Eine ausstehende Cloud-Löschung darf **nicht** als erfolgreich markiert werden.

---

## 9. Datenexport und Auskunft

### 9.1 Produktziel

**Festgelegt:** Nutzer sollen ihre eigenen Daten einfach exportieren können. Der Anspruch lautet **möglichst sofort**, bei vollständigen Serverexporten **angestrebte Bereitstellung binnen höchstens einer Stunde** statt einer langwierigen manuellen Bearbeitung.

Das ist zunächst ein **Serviceziel, keine rechtliche oder technische Garantie**. Sehr grosse Konten, Störungen und Sonderfälle benötigen ehrliche Status- und Fehlermeldungen; rechtliche Auskunftsrechte/-fristen bleiben davon unberührt.

### 9.2 Zwei Exportwege

**A. Lokaler Sofortexport (bevorzugt):**

- Aus einem **bereits angemeldeten/entsperrten Browsergerät**.
- Erstellung lokal und ohne zusätzliche Belastung des Sync-Servers, soweit alle Daten vorliegen.
- Keine künstlichen Download-Limits für lokale Daten.
- Optional passwortgeschütztes Archiv auf Nutzerwunsch.

**B. Vollständiger Cloud-Datenexport:**

- Anforderung von einem **angemeldeten, autorisierten Gerät**.
- Bei sensiblen Daten optional erneute Authentisierung per Passwort, Passkey oder Hardware-Schlüssel (**Step-up-Authentifizierung**).
- Server liefert die **gespeicherten Daten** bzw. verschlüsselten Datensätze; im Ultra-Modus darf der Server sie nicht selbst entschlüsseln. Entschlüsselung und Erstellung eines lesbaren Exports erfolgen auf dem berechtigten Client.
- Asynchrone Verarbeitung mit **niedrigerer Priorität** als Login, Sync und sicherheitskritische API-Operationen.
- Transparente Zustände wie „angefordert“, „in Warteschlange“, „wird verarbeitet“, „bereit“ und „fehlgeschlagen“.
- **Optionaler Versand per E-Mail** nur nach ausdrücklicher Wahl; sensible Klartextdaten besser **nicht direkt als Mail-Anhang** versenden. Stattdessen höchstens ein kurz gültiger, zusätzlich geschützter Downloadweg und klare Warnung vor E-Mail-Risiken.
- Auch bei E-Mail-Export darf der Ultra-Modus seine Schlüssel- und Klartextregeln nicht unterlaufen.

### 9.3 Datenformate

- **JSON** für strukturierte Komplettdaten mit dokumentiertem Schema und Versionierung.
- **CSV** für tabellarische Teilmengen wie Verlauf, wo sinnvoll.
- **HTML** für einen menschenlesbaren Bericht, wenn technisch vertretbar.
- Ein komprimiertes Archiv (z. B. ZIP) als Verpackung ist möglich.

**Nicht beschlossen:** Eigener universeller Import anderer Browser-Exporte. Das Projekt will zunächst **Exportierbarkeit** ermöglichen, ohne die Erwartung zu wecken, dass andere Browser ein proprietäres Aven-Format unterstützen.

### 9.4 Schutz vor Spam und Serverüberlastung

- **Rate-Limits** für serverseitige Exportaufträge, nicht für lokale Exporte.
- Pro Konto **maximal ein aktiver Cloud-Exportjob** als erster Ansatz.
- Wiederholte, identische Anfragen zusammenführen; keine teure Neuberechnung ohne Anlass.
- Zeitabstände, Speicher-/Downloadquoten, globale Queue-Limits und faire Behandlung vieler Nutzer.
- Kurzlebige Exportartefakte; **keine unnötigen unverschlüsselten Exportkopien** auf dem Server.
- Beispiel aus der Diskussion: ein neuer Serverexport frühestens ungefähr **alle zehn Minuten**; finaler Wert durch Lasttests festlegen.
- Keine benutzerseitige Dauersperre, die berechtigte Datenzugriffs- oder Auskunftsrechte vereitelt.

---

## 10. Serverprotokolle und Datenminimierung

### 10.1 Betrieb ohne Konto

**Kernprinzip:** Wer den Browser ohne Konto nutzt, braucht **keinen** Aven-Account und soll möglichst wenig Kontakt zum eigenen Backend haben. Webseitenanfragen laufen nicht pauschal über den Aven-Server.

Trotzdem können **optional oder funktionsbedingt** Kontakte entstehen, beispielsweise für:

- Softwareupdates / Update-Manifeste;
- Sicherheitsmeldungen oder Versionsabfragen;
- freiwillig aktivierte Onlinedienste.

Bei einer solchen Anfrage sieht ein empfangender Server technisch mindestens Netzwerkmetadaten (etwa Quell-IP während der Verbindung). **Sehen, verarbeiten und dauerhaft speichern sind verschiedene Dinge.** Ein Betrieb ganz ohne persistente Access-Logs ist technisch in manchen Konfigurationen möglich; Hosting und vorgelagerte Systeme müssen das erlauben.

### 10.2 Gewünschte Logging-Policy

- Kein unnötiges Tracking von URL-Verlauf, Tabs oder Surfverhalten über das Backend.
- Kein Login-Passwort, Recovery-Schlüssel, Klartext-Token, Sync-Klartext oder unmaskierte E-Mail in Logs.
- Datenschutzfreundliche Fehlerdiagnostik und minimale, begrenzte Security-/Rate-Limit-Metadaten.
- IP-basierte Kurzzeit-Zähler für Missbrauchsschutz wo erforderlich, mit möglichst kurzer Aufbewahrung und klarer Zweckbindung.
- Eigene **Anwendungslogs**, **Webserver-/Reverse-Proxy-Logs**, **Hostingprovider-Logs**, **CDN-/DDoS-Logs**, **E-Mail-Dienst-Logs**, **Backups** getrennt dokumentieren.
- Aussagekräftige Löschregeln je Log-Kategorie; keine „wir loggen nichts“-Behauptung, solange andere Systeme doch speichern.

### 10.3 Transparenzansicht im Browser

Vorgesehener Einstellungsbereich **„Datenschutz & meine Daten“**, der pro Datenkategorie zeigt:

| Frage | Erwartete Auskunft |
| --- | --- |
| Was wird gespeichert? | Konkrete Datenfelder und Zweck |
| Wo? | Lokal, offizieller Sync-Server, Drittanbieter/Hosting |
| In welcher Form? | Klartext, gehasht, verschlüsselt, providerseitige Metadaten |
| Wer kann es lesen? | Nutzergerät, Anbieter mit Recovery-Zugriff, andere Dienstleister |
| Wie lange? | Individuelle Aufbewahrung, Heartbeat-/Inaktivitätsfrist, Backup-Frist |
| Wann wird übertragen? | Login, Sync, Updatecheck, manuelle Exportanforderung usw. |
| Was passiert bei Reset/Löschung? | Lokale und entfernte Folgen, Bestätigungen und Einschränkungen |

---

## 11. Hosting und Betriebsmodell

### 11.1 Hostpoint als mögliche produktive Plattform

Im Gespräch wurde das **bestehende Hostpoint-Hosting** grundsätzlich als seriöse und naheliegende Option eingeschätzt. Zugleich wurde über **Hostinglogs und ihre tatsächlichen Aufbewahrungsfristen** diskutiert.

**Noch nicht verifiziert:** Es wurde eine Grössenordnung von etwa **30 Tagen** für bestimmte Logs genannt; daneben stand die Möglichkeit anderer, längerer Fristen. Diese Angaben sind **keine schriftlich bestätigte Hostpoint-Regel** für die konkrete Hostingkonfiguration.

**Empfohlene direkte Fragen an Hostpoint:**

1. Welche Logs fallen auf Hosting-, Apache-/Reverse-Proxy-, Infrastruktur-, Sicherheits- und Backup-Ebene an?
2. Welche Felder (IP-Adresse, Zeitstempel, Pfad, User-Agent etc.) werden jeweils gespeichert?
3. Welche **konkreten** Aufbewahrungsfristen gelten je Kategorie und Tarif?
4. Lassen sich Access-Logs abschalten, IP-Adressen kürzen oder Fristen auf **24 Stunden oder 7 Tage** reduzieren?
5. Was lässt sich vertraglich bzw. schriftlich zum Datenschutz und zur Löschung zusichern?
6. Welche Grenzen gelten für API-/Sync-Verkehr, Worker, Warteschlangen, Speicher und Hintergrundjobs?

**Wichtig:** Kein Wechsel des Hostings ist beschlossen. Erst Antworten und reale technische Anforderungen ermitteln.

### 11.2 SideForge-Raspberry-Pi

Es existiert ein gemeinsam genutzter **Raspberry Pi im Keller eines Kollegen**, der auch den SideForge-Server und Monitoring-Komponenten (Grafana/Prometheus) betreibt.

Bekannte Einschränkungen aus dem Gespräch:

- zeitweise **stark überlastet** und Dienste nicht zuverlässig erreichbar;
- dort wird **direkt auf dem laufenden System entwickelt**, ohne saubere Staging-Trennung;
- Hardwaredetails (Pi-Modell, Speicher-/Datenträgerart) sind noch unbekannt;
- Bereitschaft des Eigentümers zur Mitnutzung für den Browser ist **ungeklärt**.

**Einordnung:** Geeignet höchstens als freiwillige, isolierte Test-/Entwicklungsumgebung nach Absprache, **nicht** als vorausgesetzter produktiver Browser-Sync-Server. Eigener physischer Zugriff erleichtert Logkontrolle, ersetzt aber keine Verfügbarkeits-, Backup-, Patch- und Zugangssicherheit.

### 11.3 Open-Source- und Selbsthosting-Ziel

Die bestehende Projekt-README nennt als langfristige Richtung **Open Source auch für den Sync-Server** und eine mögliche **Self-Hosting-Option**. Das Konzept soll mit dieser Linie kompatibel bleiben: klar definierte API, dokumentierte Konfiguration, keine hardcodierten Hosting-Abhängigkeiten.

---

## 12. Bedrohungsmodell und Sicherheitsgrenzen

### 12.1 Was geschützt werden soll

- Inhalte synchronisierter Tabs, Spaces, Archiv, Verlauf und Lesezeichen;
- Kontozuordnung und E-Mail-Vertraulichkeit;
- Zugang zu Accounts und Wiederherstellung;
- lokale Schlüssel und gespeicherte Profildaten;
- Lösch- und Exportfunktionen gegen Missbrauch.

### 12.2 Relevante Angreifer und Fehlerfälle

- Datendiebstahl beim Hostinganbieter oder aus einem Datenbank-Backup;
- Account-Übernahme über Phishing, kompromittiertes E-Mail-Postfach oder schwache Recovery;
- missbrauchte API-Aufrufe, Export-Spam und DoS;
- kompromittierter Client, gestohlener Laptop oder entsperrtes Telefon;
- privilegierter Mitarbeiter/Administrator mit Zugriff auf den Server;
- Provider-/Netzwerkprotokolle und Metadaten-Korrelation;
- unvollständige Remote-Löschung oder verlorener Netzwerkzugang;
- versehentliche Löschung und Verlust von Recovery-Schlüsseln.

### 12.3 Keine unzulässigen Garantien

Auch Ultra Privacy garantiert **nicht**:

- Anonymität beim Surfen oder Schutz vor Browser-Fingerprinting;
- Verbergen der IP-Adresse vor Websites oder Netzwerkbetreibern;
- Schutz auf einem bereits kompromittierten Endgerät;
- Unmöglichkeit eines Angriffs durch einen Betreiber, der künftig manipulierte Clients/Server ausliefert;
- absolut spurenfreie Datenlöschung auf SSDs, in Backups oder auf fremden Systemen;
- hundertprozentigen Nachweis einer realen Identität.

**Sicherheitsanforderung:** Open Source, nachprüfbare Kryptografie, zeitnahe Browser-Engine-Updates, strikte Prozessisolation, sichere Update-Signaturen und möglichst unabhängige Audits sind Voraussetzung für glaubwürdige hohe Sicherheitsansprüche. „Zero Knowledge“ nur dort verwenden, wo das konkrete Schlüssel- und Bedrohungsmodell es rechtfertigt.

---

## 13. Technischer Aufbau und Umsetzungsphasen

### 13.1 Komponenten (Zielbild)

```text
Windows (Electron/Chromium)       iOS (SwiftUI/WKWebView)
         │                                  │
         ├── Browserprofil, Tabs, Verlauf   ├── Browserprofil, Tabs, Verlauf
         ├── Verschlüsselungs-/Key-Modul    ├── Verschlüsselungs-/Key-Modul
         ├── Export-/Panic-Modul            ├── Export-/Panic-Modul
         └───────────┬──────────────────────┘
                     │ optional HTTPS
             ┌───────▼──────────┐
             │ Auth & Sync API  │
             ├──────────────────┤
             │ Account-ID       │
             │ E-Mail-Suchindex │
             │ Credentials      │
             │ Ciphertext       │
             │ Letzte Aktivität │
             │ Lösch-/Exportjobs│
             └───────┬──────────┘
                     │
            Hosting-/Betriebsebene
          (Logs, Queue, Backup, Monitoring)
```

### 13.2 Empfohlene Reihenfolge

**Phase A — Lokaler Browser (Vorrang vor Cloud-Features)**

- [ ] Windows- und iOS-Grundfunktionen, Sidebar, Spaces und Tabs stabilisieren.
- [ ] Lokales Archiv und Verlauf definieren; zwölfstündige Standardarchivierung.
- [ ] Nutzerseitige Aufbewahrungsregeln, inklusive „bis zur manuellen Löschung“.
- [ ] Lokalen Datenexport mit dokumentiertem Format testen.

**Phase B — Dateninventar und Bedrohungsmodell**

- [ ] Inventar aller lokalen, übertragenen und serverseitigen Datenfelder.
- [ ] Bedrohungsmodell und Recovery-Matrix verbindlich beschliessen.
- [ ] Kryptografische Protokolle und Schlüsselverwaltung **vor** der Implementierung spezifizieren.
- [ ] Protokollierungs- und Löschfristen des tatsächlichen Hosting-Stacks prüfen.

**Phase C — Optionales normales Konto und Sync**

- [ ] Freiwillige Registrierung und Sitzungsverwaltung.
- [ ] Sichere Passwort-Hashes und Passkey-Unterstützung.
- [ ] Datenverschlüsselung im Client und geräteübergreifende Synchronisierung.
- [ ] **E-Mail-only-Datenwiederherstellung** für das normale Konto implementieren und Sicherheitsgrenzen offenlegen.
- [ ] Serverlast, Rate-Limits, Queue-Verhalten und Multi-Device-Konflikte testen.

**Phase D — Ultra Privacy**

- [ ] E-Mail-Suchindex ohne persistente Klartextadresse.
- [ ] Kein serverseitig entschlüsselbarer Recovery-Pfad.
- [ ] Vertrauenswürdige Geräte / Recovery-Key-Verfahren.
- [ ] Destruktiver Reset, Modiwechsel und Löschung nach Inaktivität.
- [ ] End-to-End-Tests: Server-/DB-Operator kann Ciphertext **nicht** entschlüsseln.

**Phase E — Export, Panic-Mode und externe Prüfung**

- [ ] Lokaler Sofortexport und asynchroner vollständiger Cloud-Export.
- [ ] Granulare Panic-Konfiguration, nachvollziehbare Aktionszustände.
- [ ] Lokal-/Cloud-/Backup-Löschpfade mit Fehlersimulationen testen.
- [ ] Unabhängiger Security-Review vor sicherheitskritischen Werbeaussagen.

### 13.3 Beispielhafte Prüffälle

| Test | Erwartetes Ergebnis |
| --- | --- |
| Browser ohne Konto und ohne Netz starten | Lokale Browserfunktionen laufen weiter |
| Ultra-Privacy-Datenbankkopie gestohlen | Keine Klartext-E-Mail oder lesbare Sync-Inhalte aus der DB allein |
| Passwort für Ultra Privacy verloren | Altdaten ohne Geräte-/Recovery-Schlüssel nicht wiederherstellbar |
| Normales Konto via E-Mail zurücksetzen | Sync-Daten wieder zugänglich **gemäss gewähltem Recovery-Modell** |
| Zweiter Faktor konfiguriert | Recovery umgeht nicht stillschweigend die Account-Sicherheitsrichtlinie |
| Browser 180 Tage nur offline genutzt | Cloud-Konto ggf. gelöscht, lokale Daten auf dem Gerät weiterhin vorhanden |
| Panic-Reset während Serverausfall | Lokale Aktion erfolgreich; Cloud-Löschung **als ausstehend/fehlgeschlagen** ausgewiesen |
| Export 100-mal angefordert | Lokaler Export möglich; Server-Queue geschützt |
| Ein Tab im Archiv selektiv gelöscht | Löschzustand auf verbundenen Geräten konsistent |
| Hostpoint-Logs überprüft | Dokumentierte reale Aufbewahrung statt angenommener Dauer |

---

## 14. Offene Entscheidungen und Abnahmekriterien

### Noch verbindlich zu entscheiden

1. **Ultra-Privacy-Recovery:** keinerlei E-Mail-Reset oder ein ausschliesslich destruktiver Neustart?
2. **180 Tage:** feste Frist oder nutzerkonfigurierbar? Nur Ultra Privacy?
3. **Heartbeat:** Definition von „tatsächlicher Browsernutzung“ auf Windows und iOS, besonders bei Hintergrundausführung.
4. **Normalmodus-Schlüssel-Escrow:** konkrete Architektur, Zugriffsschutz, Auditierung und Missbrauchsfolgen.
5. **Passkeys/OTP/FIDO2:** welche Kombinationen sind auswählbar, welche Recovery-Absicherung gilt?
6. **Panic-Button:** genaue Aktionen, Auslösegesten, lokale Speicherorte und Offline-Verhalten.
7. **Cloud-Export:** zulässige Datenmenge, Queue-SLA, Retention temporärer Exporte und optionaler E-Mail-Versand.
8. **Aufbewahrung:** Standardwerte und Speicherlimits pro Datentyp; „unbegrenzt“ als explizite Nutzeroption.
9. **Hosting:** schriftliche Hostpoint-Antworten zu Logs, Backupfristen und API-/Worker-Möglichkeiten.
10. **Externe Prüfung:** Umfang und Budget für unabhängige Audits vor Veröffentlichung.

### Mindestanforderung für eine öffentliche Datenschutzbehauptung

- [ ] Datenflussdiagramm und aktuelle Dateninventarliste vorhanden.
- [ ] Dokumentierte, tatsächlich implementierte Verarbeitungs- und Logfristen.
- [ ] Schlüsselverwaltung und Recovery im Sicherheitsreview geprüft.
- [ ] Kein falscher Anspruch auf E2EE/Zero Knowledge im normalen Recovery-Modus.
- [ ] Lösch- und Exportfunktionen mit Erfolg, Timeout und Teilfehler getestet.
- [ ] Nutzer kann pro Datenklasse nachvollziehen, was lokal und auf Servern passiert.
- [ ] Einschränkungen klar formuliert und nicht hinter Warntexten versteckt.
- [ ] Hosting- und Drittanbieterprozesse passen zu den veröffentlichten Aussagen.

---

## Zusammenfassung der Produktidee

**Aven soll Privatsphäre kontrollierbar statt mystisch machen:** Ein Browser ohne Kontozwang, mit frei wählbarer Synchronisierung, individuell langer Datenspeicherung, einem bequemen wiederherstellbaren Standardkonto, einem strengeren Ultra-Privacy-Konto ohne serverseitigen Zugriff auf Sync-Klartext, optionalen starken Anmeldefaktoren, einer konfigurierbaren Notfalllöschung und einem schnellen, datenschutzfreundlichen Export.

Der entscheidende technische Trade-off bleibt sichtbar: **E-Mail-only-Wiederherstellung sämtlicher Sync-Daten im Normalmodus** und **strikte Zero-Knowledge-Vertraulichkeit im Ultra-Modus** sind unterschiedliche Schutzmodelle. Sie dürfen nicht als dasselbe beworben werden.

---

*Arbeitsdokument auf Grundlage der Produktdiskussion am 3./4. November 2026. Ergänzungen und Korrekturen sollten in kleinen, nachvollziehbaren Commits beziehungsweise ADRs erfolgen. Keine der beschriebenen Funktionen gilt allein durch dieses Dokument als umgesetzt.*
