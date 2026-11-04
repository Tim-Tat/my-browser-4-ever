# Aven / My Browser 4 Ever — Idee: Darkweb-Modus (zweifach verschlüsselt)

> **Status:** Idee / Konzeptskizze, **nichts davon ist umgesetzt oder zugesagt**
> **Stand:** 4. November 2026
> **Projekt:** [My Browser 4 Ever](../README.md) · Produktname **Aven** (Arbeitstitel)
> **Verwandt:** [Datenschutz, Konten & Sicherheitsarchitektur](PRIVACY_SECURITY_CONCEPT.md)
> **Priorität:** Eine Idee festhalten und einen realistischen Einbauweg skizzieren – **kein Marketingversprechen**

---

## Inhaltsverzeichnis

1. [Die Idee in Kürze](#1-die-idee-in-kürze)
2. [Was „zweifach verschlüsselt“ bedeuten soll](#2-was-zweifach-verschlüsselt-bedeuten-soll)
3. [Ehrliche Grenzen](#3-ehrliche-grenzen)
4. [Wie man den Modus einbauen könnte](#4-wie-man-den-modus-einbauen-könnte)
5. [Bedienung und Oberfläche](#5-bedienung-und-oberfläche)
6. [Zusammenspiel mit Konto, Sync und Panic-Button](#6-zusammenspiel-mit-konto-sync-und-panic-button)
7. [Umsetzungsphasen](#7-umsetzungsphasen)
8. [Prüffälle](#8-prüffälle)
9. [Rechtliches und Plattformregeln](#9-rechtliches-und-plattformregeln)
10. [Offene Entscheidungen](#10-offene-entscheidungen)

## Legende zur Verbindlichkeit

Gleiche Begriffe wie im [Datenschutzkonzept](PRIVACY_SECURITY_CONCEPT.md#legende-zur-verbindlichkeit):

- **Idee:** vom Projektinitiator vorgeschlagen, noch nicht diskutiert oder entschieden.
- **Empfehlung (technisch):** vorgeschlagene Umsetzung; durch Prototyp und Review zu bestätigen.
- **Offen:** bislang nicht entschieden.

---

## 1. Die Idee in Kürze

**Idee:** Aven bekommt einen optionalen **Darkweb-Modus**: ein klar abgetrennter Browsermodus, in dem Webseiten – insbesondere **`.onion`-Adressen** (Onion Services im Tor-Netzwerk) – über ein Anonymisierungsnetz geladen werden und in dem **zwei voneinander unabhängige Verschlüsselungsschichten** gelten:

| Schicht | Was sie schützt | Kurzbeschreibung |
| --- | --- | --- |
| **Schicht 1 — Transport** | Daten *unterwegs* | Verkehr läuft geschichtet verschlüsselt über mehrere Knoten (Onion-Routing); darüber liegt bei Webseiten die normale Ende-zu-Ende-Verschlüsselung (HTTPS beziehungsweise die Verschlüsselung der Onion Services). |
| **Schicht 2 — Lokal** | Daten *auf dem Gerät* | Das Darkweb-Profil (z. B. gespeicherte `.onion`-Lesezeichen, Einstellungen) liegt nur in einem eigenen verschlüsselten Container, dessen Schlüssel **doppelt abgesichert** ist (Gerät + Nutzergeheimnis). |

Der Modus ist eine **Funktion für Neugierige, Journalisten, Rechercheure und Menschen in zensierten Regionen** – nicht „der Browser, mit dem man sich unsichtbar macht“. Aven kuratiert, listet oder bewirbt **keine** Darkweb-Inhalte.

> **Einordnung:** Das Tor-Netzwerk gibt es bereits; Aven soll **kein eigenes Anonymisierungsnetz erfinden**. Das wäre kryptografisch und organisatorisch ein eigenes Grossprojekt. Der Modus *bindet* ein bewährtes Netz ein und sorgt für saubere Isolation im Browser.

---

## 2. Was „zweifach verschlüsselt“ bedeuten soll

„Zwei Mal verschlüsseln“ ist nicht automatisch doppelt so sicher. Dieselben Daten zweimal mit demselben Schlüssel oder demselben Verfahren zu verpacken bringt kaum Gewinn. Sinnvoll sind **zwei unabhängige Schichten mit unterschiedlichen Aufgaben und Schlüsseln**, damit der Ausfall einer Schicht nicht alles offenlegt.

### 2.1 Schicht 1 — Transport

**Empfehlung (technisch):**

- Der Datenverkehr des Modus läuft über einen **Tor-Client**. Tor verpackt Daten in mehreren Schichten, jeder Knoten entfernt nur seine eigene (daher „Onion“). Kein einzelner Knoten kennt gleichzeitig Absender und Ziel.
- Bei `https://`-Seiten kommt die **normale TLS-Verschlüsselung zwischen Browser und Zielserver** hinzu; bei `.onion`-Adressen ist die Verbindung Ende-zu-Ende durch das Onion-Service-Protokoll geschützt.
- Das ergibt **ohne zusätzlichen Eigenbau** zwei Verschlüsselungsebenen im Transport (Netzwerkschicht + Anwendungsschicht).

**Alternative Auslegung (nicht empfohlen für den Anfang):** Zwei hintereinandergeschaltete Dienste (z. B. VPN **und** Tor). Das bringt oft mehr Komplexität, Fehlerquellen und zusätzliche Vertrauenspunkte, aber nicht zwingend mehr Schutz. Höchstens als späterer, bewusst aktivierter Expertenschalter prüfen.

### 2.2 Schicht 2 — Lokale Verschlüsselung („doppelt verpackter Schlüssel“)

**Empfehlung (technisch):**

```text
Darkweb-Profil (Lesezeichen, Einstellungen, ggf. Verlauf)
        │  verschlüsselt mit AEAD (z. B. XChaCha20-Poly1305 oder AES-256-GCM)
        ▼
  Zufälliger Datenschlüssel (DEK)  ← nie im Klartext gespeichert
        │  wird zweimal unabhängig „eingepackt“ (Key-Wrapping)
        ├── Hülle A: Geräteschlüssel (Windows DPAPI / iOS Keychain mit Secure Enclave)
        └── Hülle B: Schlüssel aus Nutzer-Passphrase (Argon2id)
```

- Der Datenschlüssel ist **kryptografisch zufällig**, nicht aus Passwort oder Account-ID abgeleitet (gleiche Linie wie in [Abschnitt 5 des Datenschutzkonzepts](PRIVACY_SECURITY_CONCEPT.md#5-verschlüsselung-und-schlüsselverwaltung)).
- **Hülle A** schützt gegen einen kopierten Datenträger: Ohne dieses Gerät/OS-Konto ist der Container nicht lesbar.
- **Hülle B** schützt gegen jemanden, der das entsperrte Gerät oder das Betriebssystemkonto nutzt: Ohne Passphrase bleibt der Container zu.
- Variante: Beide Hüllen sind **gleichzeitig** nötig (der Schlüssel wird zuerst mit A, das Ergebnis dann mit B verpackt) oder **alternativ** (A *oder* B reicht, zum Beispiel für Komfort). Für den Darkweb-Modus ist **„beide nötig“** die sicherere Voreinstellung. **Offen**, ob optional umschaltbar.
- Der Container wird beim Beenden des Modus gesperrt, der Klartext-Schlüssel aus dem Speicher entfernt.

---

## 3. Ehrliche Grenzen

Diese Punkte gehören in jede Beschreibung des Modus, auch im Browser selbst:

1. **Das ist nicht der Tor Browser.** Der Tor Browser ist auf *einheitliche* Fingerabdrücke (Fingerprinting-Schutz, feste Fenstergrösse, vereinheitlichte Schriften usw.) gehärtet. Ein Chromium-/WebKit-basierter Aven-Modus erreicht diesen Schutz **nicht** automatisch. Wer ernsthaft anonym bleiben muss, sollte den Tor Browser verwenden. Aven darf **keine Tor-Browser-Gleichwertigkeit** behaupten.
2. **Das Wort „Tor“ ist eine geschützte Marke** des Tor Project. Name und Logo nur nach Prüfung der Markenrichtlinien verwenden; der Modus kann neutral „Darkweb-Modus“ oder „Onion-Modus“ heissen.
3. **Doppelte Verschlüsselung ersetzt keine Anonymität.** Sie schützt Inhalte und Daten, nicht vor Verhalten des Nutzers (Anmeldung mit echtem Namen, Dateien öffnen, Skripte, Browserfehler).
4. **Leak-Risiken sind die eigentliche Gefahr.** DNS-Anfragen, WebRTC, QUIC/HTTP/3 (UDP), Plugins, Downloads, Hintergrundverbindungen oder Update-Pings, die *am Proxy vorbei* gehen, würden die echte IP verraten.
5. **Ein kompromittiertes Gerät bleibt kompromittiert.** Malware, Keylogger oder Bildschirmfreigabe hebeln beide Schichten aus.
6. **Lokale Spuren ausserhalb der App** (Betriebssystem-Caches, Swap, Screenshots, Thumbnails, Taskwechsler-Vorschau) lassen sich nur eingeschränkt kontrollieren.
7. Der Modus ändert die Aussage in [Abschnitt 12.3 des Datenschutzkonzepts](PRIVACY_SECURITY_CONCEPT.md#123-keine-unzulässigen-garantien) („Anonymität beim Surfen wird nicht garantiert“) **nicht**: Auch hier wird Anonymität nicht zugesichert, sondern höchstens *angestrebt* und klar eingeschränkt.

---

## 4. Wie man den Modus einbauen könnte

### 4.1 Grundprinzip: ein eigener, abgeschotteter Browserkontext

Der Darkweb-Modus ist **kein Schalter im normalen Fenster**, sondern ein **eigener Kontext** mit eigenem Sitzungsspeicher, eigener Netzwerkanbindung und eigenem Fenster:

```text
Aven Hauptfenster (normal)            Aven Darkweb-Fenster
├─ normale Sitzung                    ├─ eigene, flüchtige Sitzung (nicht persistent)
├─ direkte Verbindung                 ├─ alle Anfragen NUR über lokalen Tor-Proxy
└─ Sync (optional)                    ├─ kein Sync (Standard), kein Passwort-/Autofill
                                      └─ verschlüsselter Container (Schicht 2)

            lokaler Tor-Client (Begleitprozess, nur bei Bedarf gestartet)
            127.0.0.1:<zufälliger Port> (SOCKS5)  →  Tor-Netzwerk  →  Ziel / .onion
```

**Wichtig:** Fällt der Tor-Client aus oder ist nicht verbunden, darf der Darkweb-Kontext **niemals** auf eine direkte Verbindung zurückfallen („Kill-Switch“ / Fail-Closed).

### 4.2 Tor-Client einbinden

**Empfehlung (technisch):**

- Tor als **eigenen Begleitprozess („Sidecar“)** mitliefern, nicht in den Browserprozess einkompilieren. Zur Auswahl: klassisches **C-Tor** (ausgereift) oder **Arti** (Rust-Neuimplementierung). Den Reifegrad der Onion-Service-Unterstützung von Arti **zum Zeitpunkt der Umsetzung prüfen**, bevor man sich festlegt.
- Start erst beim Öffnen des Darkweb-Fensters, Stopp beim Schliessen. Kontrollverbindung und Port zufällig und nur auf `127.0.0.1`, nicht im Netzwerk erreichbar.
- Binärdateien und Updates **signiert und per Hash geprüft**; Tor-Sicherheitsupdates sind ein fester Teil des Release-Prozesses (analog zu Chromium-Updates in der [README](../README.md)).
- **Bridges / Pluggable Transports** (z. B. obfs4, Snowflake) als Option für Länder, in denen Tor blockiert wird.
- Stream-Isolation: pro Tab beziehungsweise pro Seite getrennte Tor-Schaltkreise, damit Webseiten ihre Besuche nicht verknüpfen können.

### 4.3 Desktop (Windows, Electron + Chromium)

**Empfehlung (technisch), im Prototyp zu verifizieren:**

- Eigene **nicht-persistente Session** für den Modus (Electron-Partition ohne `persist:`-Präfix), damit Cookies, Cache und Website-Daten nur im Arbeitsspeicher liegen.
- Proxy dieser Session fest auf den lokalen SOCKS5-Tor-Port setzen (`session.setProxy`), Ausnahmen für Direktverbindungen **entfernen**.
- **Fail-Closed:** Solange Tor nicht „bereit“ meldet, werden alle Anfragen dieser Session blockiert (z. B. über `webRequest`-Abbruch).
- **DNS** muss über den Proxy aufgelöst werden; „Secure DNS“/DoH in dieser Session ausschalten. Per Leak-Test prüfen.
- **WebRTC** und andere UDP-Pfade (z. B. QUIC) deaktivieren oder auf „nur über Proxy“ erzwingen; WebRTC-IP-Richtlinie auf „keine nicht geproxten Verbindungen“ setzen.
- **Berechtigungen** (Kamera, Mikrofon, Standort, Benachrichtigungen, USB …) in diesem Modus standardmässig verweigern.
- Keine Erweiterungen, kein Passwortspeicher, kein Autofill, keine Cloud-Rechtschreibprüfung, keine Safe-Browsing-Anfragen an Dritte, keine Telemetrie.
- Kein Festplatten-Cache, keine gespeicherten Favicons und Tab-Vorschaubilder auf Datenträger.

### 4.4 iOS (SwiftUI + WKWebView)

**Empfehlung (technisch), zu prüfen:**

- `WKWebView` mit einem **nicht-persistenten Datenspeicher** (`WKWebsiteDataStore.nonPersistent()`).
- Proxy-Anbindung über die Proxy-Konfiguration des Datenspeichers (verfügbar ab iOS 17, SOCKS5 auf einen lokalen Port). Die unterstützte Mindestversion und das tatsächliche Verhalten (DNS, WebSockets, Hintergrund) sind **im Prototyp zu prüfen**.
- Tor-Client als eingebettete Bibliothek (nicht als separater Prozess, da iOS das nicht erlaubt). Hintergrundverhalten und Speicherlimits von iOS testen: Verbindung kann bei App-Wechsel abbrechen; das muss sicher scheitern, nicht unsicher weiterlaufen.
- Screenshot beim Wechsel in den Taskwechsler abdecken (Sichtschutz-Overlay).
- Apples Richtlinien vor einer App-Store-Einreichung prüfen (siehe [Abschnitt 9](#9-rechtliches-und-plattformregeln)).

### 4.5 Schicht 2 (lokaler Container) einbauen

- Eigenes, kleines **Speichermodul** (getrennt von der normalen SQLite-Datenhaltung), das den Darkweb-Container nach dem Schema aus [Abschnitt 2.2](#22-schicht-2--lokale-verschlüsselung-doppelt-verpackter-schlüssel) verwaltet.
- Nur das speichern, was der Nutzer ausdrücklich behält (z. B. Lesezeichen); **Verlauf standardmässig aus**.
- Schlüssel nur im Arbeitsspeicher, solange der Modus entsperrt ist; beim Sperren, Schliessen und Panic aktiv überschreiben, soweit die Plattform das erlaubt.
- Keine selbst entworfene Kryptografie: geprüfte Bibliotheken (z. B. libsodium oder die Plattform-APIs) verwenden und das Format versionieren.

### 4.6 Sicherheitsstufen (optional, später)

Ähnlich wie beim Tor Browser könnten Stufen den Funktionsumfang gegen Schutz abwägen:

| Stufe | Wirkung (Idee) |
| --- | --- |
| **Standard** | Normale Webseiten laufen; Leak-Schutz aktiv. |
| **Sicherer** | JavaScript nur auf Nutzerbestätigung; Medien-Autoplay und riskante Schnittstellen aus. |
| **Am sichersten** | JavaScript und die meisten aktiven Inhalte aus; viele Seiten laufen eingeschränkt. |

---

## 5. Bedienung und Oberfläche

- **Einstieg:** Eigener Menüpunkt „Darkweb-Fenster öffnen“ (nicht als Standardschaltfläche). Beim ersten Start eine kurze, ehrliche Erklärung samt Grenzen aus Abschnitt 3.
- **Erkennbarkeit:** Eigenes Fensterdesign (z. B. dunkle Farbgebung, Badge „Onion-Modus“ in der Adressleiste), damit niemand versehentlich im falschen Kontext surft.
- **Verbindungsstatus:** „Verbinde … / Verbunden / Getrennt (alle Anfragen blockiert)“ sichtbar; Fehlermeldungen verständlich statt still.
- **Kein automatischer Wechsel:** Links aus dem Normalfenster öffnen *nie* automatisch im Darkweb-Fenster und umgekehrt; Verlinkungen zwischen den Kontexten nur nach bewusster Aktion.
- **Keine Inhaltsempfehlungen:** Kein Verzeichnis, keine Vorschläge, keine „beliebten Seiten“. Der Nutzer gibt Adressen selbst ein.
- **Warnhinweise:** Beim Download von Dateien Hinweis, dass geöffnete Dateien ausserhalb des geschützten Modus ausgeführt werden und IP-Adressen verraten können.

---

## 6. Zusammenspiel mit Konto, Sync und Panic-Button

| Bereich | Vorschlag (Idee) |
| --- | --- |
| **Ohne Konto** | Modus funktioniert vollständig lokal, ohne Aven-Backend. |
| **Sync** | **Standardmässig kein Sync** von Darkweb-Tabs, -Verlauf und -Lesezeichen. Falls je erlaubt: nur als zusätzlich verschlüsselter Datensatz, nie in normalen Sync-Kategorien, und im Ultra-Privacy-Modus nur mit dem dort geltenden Schlüsselkonzept. |
| **Normales Konto (Recovery über E-Mail)** | Darkweb-Container darf **nicht** in die serverseitig wiederherstellbaren Schlüssel einbezogen werden. Sonst wäre Schicht 2 wirkungslos. |
| **Heartbeat / Inaktivitätslöschung** | Keine Darkweb-Aktivität (Adressen, Zeiten) im Heartbeat. |
| **Panic-Button** | Eigene Aktion „Darkweb-Sitzung sofort beenden“: Fenster schliessen, Tor-Prozess beenden, Sitzungsdaten verwerfen, Container sperren und Schlüssel aus dem Speicher entfernen. Lokal sofort ausführbar, ohne Serverantwort. |
| **Export** | Darkweb-Daten sind **nicht** Teil des normalen Cloud-Exports; lokaler Export nur ausdrücklich und verschlüsselt. |

---

## 7. Umsetzungsphasen

Reihenfolge ist bewusst klein gehalten (vgl. „Eine kleine, überprüfbare Aufgabe pro Schritt“ in der [README](../README.md#8-kontrolliertes-ki-coding)). Der Modus beginnt erst **nach** dem stabilen lokalen Browser.

**Phase DW-0 — Entscheidung und Recherche**

- [ ] ADR: Ist der Darkweb-Modus gewünscht? Name, Zielgruppe, Abgrenzung zum Tor Browser.
- [ ] Tor-Client wählen (C-Tor vs. Arti), Lizenz und Marken prüfen.
- [ ] Rechtliche und Store-Fragen klären (Abschnitt 9).

**Phase DW-1 — Desktop-Prototyp (Netzwerk)**

- [ ] Tor-Begleitprozess starten/stoppen.
- [ ] Eigene nicht-persistente Session, nur über lokalen SOCKS5-Proxy.
- [ ] Fail-Closed, wenn Tor nicht bereit ist.
- [ ] Leak-Tests: DNS, WebRTC, QUIC, Fehlerfälle.

**Phase DW-2 — Oberfläche und Isolation**

- [ ] Eigenes Fenster, Statusanzeige, Hinweistexte.
- [ ] Berechtigungen, Passwort/Autofill, Erweiterungen aus.
- [ ] Panic-Aktion „Darkweb beenden“.

**Phase DW-3 — Schicht 2 (lokaler Container)**

- [ ] Schlüsselhierarchie (DEK, Gerätehülle, Passphrasenhülle) spezifizieren und implementieren.
- [ ] Sperren/Entsperren, Schlüsselentfernung im Speicher, Format-Versionierung.

**Phase DW-4 — iOS**

- [ ] Nicht-persistente WKWebView mit Proxy-Anbindung prüfen.
- [ ] Tor-Bibliothek einbetten, Hintergrund-/Abbruchverhalten testen.
- [ ] Sichtschutz im Taskwechsler.

**Phase DW-5 — Prüfung vor jeder Werbeaussage**

- [ ] Unabhängiger Security-Review (Netzwerk-Leaks und Schlüsselverwaltung).
- [ ] Texte so formulieren, dass keine Anonymitätsgarantie entsteht.

---

## 8. Prüffälle

| Test | Erwartetes Ergebnis |
| --- | --- |
| Tor-Prozess wird beendet, während eine Seite offen ist | Alle Anfragen werden blockiert, keine Direktverbindung |
| Tor ist beim Öffnen des Fensters nicht erreichbar | Verständliche Fehlermeldung, nichts wird geladen |
| DNS-Leak-Test im Darkweb-Fenster | Keine DNS-Anfragen am Proxy vorbei |
| WebRTC-Test-Seite | Keine lokale oder öffentliche IP-Adresse sichtbar |
| QUIC/HTTP/3-fähige Seite | Kein UDP-Verkehr am Proxy vorbei |
| Darkweb-Fenster schliessen | Session, Cookies und Cache weg; Tor-Prozess beendet |
| Container-Datei auf anderen Rechner kopiert | Ohne Gerätehülle **und** Passphrase nicht lesbar |
| Falsche Passphrase / richtiges Gerät | Container bleibt gesperrt |
| Normales Konto per E-Mail wiederhergestellt | Darkweb-Container nicht wiederherstellbar durch den Dienst |
| Panic-Button während Serverausfall | Lokale Darkweb-Sitzung wird trotzdem sofort beendet |
| Link aus normalem Fenster | Öffnet nicht automatisch im Darkweb-Fenster |
| Wechsel der App im Hintergrund (iOS) | Inhalte abgedeckt, Verbindung scheitert sicher |

---

## 9. Rechtliches und Plattformregeln

- **Tor-Software:** Lizenzbedingungen der verwendeten Tor-Komponenten und deren Abhängigkeiten prüfen; Markenrichtlinien des Tor Project beachten.
- **Rechtslage:** Tor selbst zu nutzen ist in den meisten Ländern erlaubt, in einigen eingeschränkt. Der Browser sollte die Nutzer darauf hinweisen, dass sie selbst für rechtmässiges Verhalten verantwortlich sind. Aven darf **keine** Hilfe für rechtswidrige Inhalte oder Handlungen anbieten. Vor Veröffentlichung juristisch beraten lassen.
- **Apple App Store:** Anforderungen an Browser-Apps, eingebettete Netzwerkkomponenten und Inhaltsregeln zum Veröffentlichungszeitpunkt prüfen. Es gibt Tor-basierte Apps im Store, das ersetzt aber nicht die aktuelle Prüfung.
- **Exportkontrolle:** Kryptografie in Software kann länderabhängige Regeln berühren; vor internationaler Verteilung kurz abklären.
- **Missbrauchsschutz:** Keine eigenen Hidden-Service-Verzeichnisse, keine Inhaltsanbieter. Der Browser bleibt ein neutrales Werkzeug.

---

## 10. Offene Entscheidungen

1. **Wollen wir den Modus überhaupt?** Zielgruppe, Nutzen und Risiko (Missbrauch, Support, Plattformregeln) gegen den Aufwand abwägen.
2. **Name:** „Darkweb-Modus“, „Onion-Modus“ oder neutraler (z. B. „Privater Tunnel“)? Markenprüfung beachten.
3. **Tor-Client:** C-Tor oder Arti? Wie wird er aktuell gehalten?
4. **Zweite Schicht:** Reichen Transport-Verschlüsselung (Tor + HTTPS) und lokaler Container, oder soll es zusätzlich einen weiteren Transport-Dienst geben?
5. **Container-Schlüssel:** Beide Hüllen immer nötig oder Komfortvariante? Was passiert bei verlorener Passphrase (Vorschlag: Daten unwiederbringlich, keine Betreiber-Recovery)?
6. **Verlauf:** Standardmässig aus; soll er optional im Container speicherbar sein?
7. **Sicherheitsstufen:** Ab Start oder erst später?
8. **Plattform-Reihenfolge:** Erst Windows, iOS erst nach Machbarkeitsprüfung?
9. **Bridges:** Standardmässig anbieten oder nur in den Einstellungen?
10. **Externe Prüfung:** Umfang und Budget, bevor irgendeine Sicherheitsaussage veröffentlicht wird.

---

## Zusammenfassung

Der Darkweb-Modus ist ein **abgeschotteter Browserkontext**, der seinen gesamten Verkehr durch einen eingebetteten Tor-Client leitet (**Schicht 1**, Transport: Onion-Routing plus HTTPS/Onion-Service-Verschlüsselung) und seine lokalen Daten in einem **verschlüsselten Container mit doppelt abgesichertem Schlüssel** hält (**Schicht 2**, Gerät + Passphrase). Der Einbau ist machbar, aber die eigentliche Arbeit liegt in **Isolation, Leak-Schutz und ehrlicher Kommunikation**. Eine Anonymitätsgarantie darf Aven dafür nicht aussprechen.

---

*Ideenpapier auf Grundlage der Projektdiskussion vom 4. November 2026. Änderungen bitte als kleine, nachvollziehbare Commits beziehungsweise ADRs einbringen. Keine der beschriebenen Funktionen gilt allein durch dieses Dokument als umgesetzt.*
