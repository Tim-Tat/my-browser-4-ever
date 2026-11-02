# My Browser 4 Ever

> **Ein Browser, der bleibt.** Ein unabhängiges, langfristig gepflegtes Open-Source-Projekt für einen modernen Desktop- und iOS-Browser.
>
> **Projektstatus:** Konzept & frühe Prototypenplanung · **Stand:** 03.11.2026 · **Produktname (Arbeitstitel):** Aven

---

## Kurzüberblick

**My Browser 4 Ever** ist der Projektname für einen Browser, der die angenehmen Ideen moderner Browser – insbesondere eine aufgeräumte Sidebar, Spaces, angeheftete Tabs und flüssige Bedienung – neu und eigenständig umsetzt.

Die Motivation ist nicht, einen bestehenden Browser zu kopieren oder künstlich am Leben zu halten. Das Ziel ist ein **eigenes Produkt mit eigenem Code, Branding und einer offenen Zukunft**. Ein möglicher Produktname ist **Aven**; dieser ist noch nicht abschliessend gewählt oder markenrechtlich geprüft.

Die erste Priorität ist ein **nutzbarer, kleiner Prototyp**, nicht ein sofort vollständiger Browser mit allen erdenklichen Funktionen.

| Bereich | Aktueller Stand |
| :-- | :-- |
| Projektname | **My Browser 4 Ever** – gesetzt als Repository-/Projektname |
| Produktname | **Aven** – klarer Favorit, **noch nicht final** |
| Zielplattformen | Windows und iOS parallel; macOS später prüfen |
| Desktop-Technologie | **Electron + Chromium** – favorisiert für den Prototyp |
| iOS-Technologie | **Swift / SwiftUI + WKWebView** – vorgeschlagen |
| Quellcode | Langfristig vollständig **Open Source**, inklusive optionalem Sync-Server |
| Nutzung | **Ohne Anmeldung**; lokale Nutzung muss vollständig funktionieren |
| Synchronisierung | Optional, später; selbst hostbar und sicher konzipiert |
| Designprozess | Direkte Prototypen **oder** Figma für iOS-, Desktop- und Web-Design |
| Team | Zwei Hauptentwickler; möglicher dritter Mitarbeiter nach Verfügbarkeit |
| Repository | Zurzeit privat/leer; spätere Veröffentlichung vorgesehen |

> **Hinweis zur Verbindlichkeit:** Dieses Dokument hält die bisherige Diskussion fest. Es ist **kein fertiges Pflichtenheft**. „Geplant“, „vorgeschlagen“ und „zu prüfen“ sind bewusst von verbindlichen Produktprinzipien getrennt.

## 1. Vision und Produktprinzipien

### Was wir bauen wollen

- Einen **schnellen, übersichtlichen, modernen Browser** mit einem eigenständigen visuellen Auftritt.
- **Desktop (zunächst Windows)** und eine **native iOS-App**, ohne dass beide exakt dieselbe Oberfläche haben müssen.
- Ein langfristig **offenes Projekt**, das auch dann geforkt und weiterentwickelt werden kann, wenn die ursprünglichen Maintainer aufhören.
- Ein Produkt, das sich unkompliziert installieren und regelmässig aktualisieren lässt – nicht nur einen GitHub-Demo-Prototyp.
- Eine hochwertige Bedienung, die sich für ehemalige Nutzer anderer moderner Browser vertraut anfühlt, aber **keine 1:1-Kopie von Arc** ist.

### Leitplanken

1. **Local First:** Browsen, Tabs und Spaces funktionieren ohne Konto und ohne eigenen Server.
2. **Keine Pflichtanmeldung:** Ein Konto darf allenfalls für freiwillige Sync-Funktionen nötig werden.
3. **Open Source als Architekturprinzip:** Client und später auch der offizielle Sync-Server sollen mit offenem Quellcode verfügbar sein.
4. **Einfachheit vor Feature-Menge:** Funktionen werden schrittweise geplant, implementiert und getestet.
5. **Sicherheit als Grundfunktion:** Keine Abkürzungen bei Isolation, Berechtigungen, Datenhaltung und Browser-Updates.
6. **Auffindbare Einstellungen:** Settings sollen logisch gruppiert und leicht erreichbar sein, ohne unnötig dominante UI.
7. **Unabhängigkeit:** Das Produkt darf nicht von einem einzigen zentralen Dienst abhängig sein, um grundlegendes Browsen zu ermöglichen.
8. **Eigene Identität:** Inspiration ist erwünscht; Code, Icons, Texte und Produktgestaltung müssen eigenständig beziehungsweise korrekt lizenziert sein.

## 2. Team und Arbeitsweise

| Rolle | Verantwortungsbereich | Erwartung |
| :-- | :-- | :-- |
| **Desktop & Produkt** | Windows-Browser, Sidebar/Tab-Logik, Website, grundlegende Release-Koordination | Hauptentwickler |
| **iOS** | Native iOS-App, SwiftUI, WebKit, TestFlight und App-Store-Veröffentlichung | Hauptentwickler mit Erfahrung aus zwei veröffentlichten Apps |
| **Backend / Infrastruktur** | Später Sync-Server, API, CI/CD oder Tests | **Optional** – Verfügbarkeit und Verbindlichkeit noch offen |

**Planungsannahme:** Für Desktop stehen ungefähr **10 Stunden pro Woche, eventuell mehr**, zur Verfügung. Der Aufwand des iOS-Entwicklers ist noch nicht festgelegt. Der Zeitplan darf **nicht voraussetzen**, dass eine dritte Person verbindlich mitarbeitet.

**Zusammenarbeit:**
- Kleine Issues und Pull Requests statt grosser Änderungen ohne Review.
- Jeder Meilenstein muss lokal startbar und überprüfbar sein.
- Technische Entscheidungen als kurze ADRs (Architecture Decision Records) festhalten.
- Keine kritischen Änderungen nur deshalb übernehmen, weil ein KI-Modell sie überzeugend präsentiert.

## 3. Technischer Unterbau

### 3.1 Desktop – Windows zuerst

**Favorisierte Ausgangsbasis: Electron**. Electron kombiniert Chromium für Webinhalte mit einer Desktop-Anwendung, deren eigene Oberfläche in Webtechnologien umgesetzt werden kann.

- **Chromium / Blink / V8:** Webdarstellung und JavaScript-Ausführung.
- **Electron Main Process:** Fenster, native Integration, Lebenszyklus und kontrollierte Browser-Funktionen.
- **WebContentsView:** Kandidat für die Darstellung einzelner Webseiten/Tab-Inhalte.
- **Eigene UI:** Sidebar, Navigation, Spaces, Pins und Einstellungen, voraussichtlich mit React + TypeScript.
- **Lokaler Zustand:** Tabs, Spaces, Fenster und Einstellungen persistent speichern; SQLite ist eine mögliche, noch zu prüfende Lösung.
- **Getrennte Schichten:** Datenmodell, Tabverwaltung und Sync-Adapter nicht an eine einzelne UI-Komponente koppeln.

**Wichtige Einschränkung:** Electron ist zwar schnell für einen Prototyp, liefert aber **nicht automatisch einen vollständigen, ausgereiften Alltagsbrowser**. Profile, Downloads, Berechtigungen, Passwortverwaltung, Sitzungswiederherstellung, Chromium-Sicherheitsupdates und gegebenenfalls Erweiterungen erfordern eigene Planung.

**Langfristige Option:** Wenn Electron für die Produktziele zu stark einschränkt, kann später eine andere Chromium-basierte Architektur geprüft werden. Ein eigener Chromium-Fork ist **kein Ziel für die erste Alpha**.

### 3.2 iOS – native App

- **Swift + SwiftUI** für die Bedienoberfläche.
- **WKWebView / WebKit** für die Darstellung von Webseiten.
- Native Navigation, Tabverwaltung und lokale Speicherung.
- **TestFlight** für frühe Testversionen; später reguläre App-Store-Veröffentlichung.
- Die Anforderungen und Berechtigungen für eine **iOS-Standardbrowser-App** müssen mit den zum Veröffentlichungszeitpunkt geltenden Apple-Vorgaben geprüft werden.

Windows und iOS teilen zunächst **Produktkonzepte und Datenformate**, nicht zwingend dieselbe UI-Codebasis.

### 3.3 Architektur-Skizze

    Windows Client (Electron + Chromium)          iOS Client (SwiftUI + WebKit)
    ├─ Browser-Oberfläche                        ├─ Native Oberfläche
    ├─ Tabs / Spaces / Pins                      ├─ Tabs / Spaces / Pins
    ├─ Lokales Datenmodell                      ├─ Lokales Datenmodell
    └─ Optionaler Sync-Adapter                   └─ Optionaler Sync-Adapter
                       │                                │
                       └──────── optional ─────────────┘
                                      │
                          Offene Sync-API (später)
                                      │
                         Verschlüsselte Sync-Daten
                                      │
                       Selbst hostbar oder Hosted-Option

**Grundsatz:** Fällt der Sync-Dienst aus, bleibt der Browser lokal verwendbar.

### 3.4 Optionaler Sync-Server

Ein Server ist für den ersten Browser-Prototyp **nicht notwendig**. Später sollen Synchronisierung und Konten freiwillig aktivierbar sein.

**Mögliche Funktionen in dieser Reihenfolge:**
1. Spaces und angeheftete Tabs
2. Offene Tabs und Sitzungsinformationen
3. Lesezeichen und ausgewählte Einstellungen
4. **Cookie-/Login-Synchronisierung – nur als Forschungs- und Langfristthema**

**Möglicher Start:** Kleine API auf bestehendem **Hostpoint-Webhosting** mit PHP und MySQL, sofern Tarif, Limits und Sicherheitsanforderungen dazu passen. Für eine grössere Nutzerzahl oder komplexe Echtzeit-Synchronisierung könnte später ein VPS nötig werden.

**Anforderungen:**
- Quellcode des Servers ebenfalls öffentlich und **selbst hostbar** (beispielsweise mit Docker).
- Dokumentierte, versionierte API und Migrationen.
- Klare Authentifizierung, Zugriffskontrolle, Rate Limits und Backupstrategie.
- Ende-zu-Ende-Verschlüsselung als Ziel für vertrauliche Sync-Daten; Schlüsselverwaltung und Gerätewechsel müssen zuerst entworfen werden.
- Kein Tracking-Zwang und kein Konto für den lokalen Browser.
- Keine Server-Secrets, API-Schlüssel oder privaten Nutzerdaten ins Git-Repository committen.

**Cookie-Sync ist besonders sensibel:** Session-Cookies können Zugriff auf eingeloggte Konten ermöglichen. Chromium- und WebKit-Datenmodelle sowie geräte- und sicherheitsgebundene Sessions sind nicht beliebig kompatibel. **Keine automatische Übernahme aktiver Logins versprechen**. Vor einer Implementierung sind ein Threat Model, eine Machbarkeitsstudie und ein extern prüfbares Sicherheitskonzept nötig. Standardmässig bleibt dieses Feature deaktiviert beziehungsweise unimplementiert.

## 4. Produktumfang nach Phasen

### Phase 0 — Architektur und klickbarer Rahmen

**Ziel:** Ein bewusst minimaler Prototyp, der sich anschauen und starten lässt.

- [ ] Projektstruktur und Entwicklungsumgebungen festlegen
- [ ] Windows: Electron-Fenster öffnet sich
- [ ] Windows: Eine echte Webseite wird angezeigt
- [ ] Windows: Einfache, zunächst statische Sidebar als Umriss
- [ ] iOS: SwiftUI-App mit einer WKWebView
- [ ] Gemeinsam: Datenbegriffe für Tab, Space und Pin klären
- [ ] Optional: Erste Wireframes in Figma

**Nicht Teil dieser Phase:** Sync, Benutzerkonto, Animationen, Browser-Erweiterungen.

### Phase 1 — Nutzbare interne Alpha

- [ ] Mehrere Tabs öffnen, wechseln und schliessen
- [ ] Adressleiste, Zurück/Vorwärts, Neu laden
- [ ] Sidebar mit nachvollziehbarem Tab-Zustand
- [ ] Erste Spaces und angeheftete Tabs
- [ ] Zustand nach Neustart wiederherstellen
- [ ] Grundlegende Fehlerfälle, Downloads und Berechtigungen prüfen
- [ ] iOS: Tabverwaltung und lokale Sitzungsdaten
- [ ] Interne Builds an die Entwickler verteilen

**Abnahmekriterium:** Beide Apps laden reguläre Webseiten, bleiben bei gewöhnlichen Bedienabläufen stabil und benötigen keine Anmeldung.

### Phase 2 — Externe Alpha

- [ ] Installer und nachvollziehbare Versionierung für Windows
- [ ] Updatestrategie, Build-Pipeline und reproduzierbare Releases
- [ ] iOS-TestFlight für einen kleinen Testerkreis
- [ ] Auffindbare Einstellungen und Importmöglichkeiten bewerten
- [ ] Datenschutz- und Sicherheitsprüfung für den tatsächlich eingebauten Funktionsumfang
- [ ] Kleine Website mit Screenshots und klarer Alpha-Kennzeichnung
- [ ] Fehlerberichte und Feedbackkanal

**Release-Gate:** Keine bekannten schwerwiegenden Sicherheitsprobleme, dokumentierte Einschränkungen und ein funktionierender Aktualisierungspfad.

### Phase 3 — Nach der ersten Veröffentlichung

- [ ] UX verfeinern: Animationen, Tastenkombinationen, Design-System
- [ ] Lesezeichen, Verlauf und weitere Alltagsfunktionen
- [ ] Optionales Konto und offene, selbst hostbare Sync-API
- [ ] Plattformübergreifende Synchronisierung **nicht-sensibler** Daten
- [ ] macOS-Version prüfen
- [ ] Import aus bestehenden Browsern prüfen
- [ ] Browser-Erweiterungen auf Desktop separat evaluieren
- [ ] Cookie-Sync nur nach eigenständiger Sicherheits- und Machbarkeitsprüfung

> **Zeitplanung:** Eine erste interne Demo nach wenigen Arbeitssitzungen ist ein sinnvoller Anspruch. Eine öffentliche Alpha **gegen Ende November 2026** wurde als ambitioniertes Ziel diskutiert – **nicht als zugesagter Termin**. Sicherheit, Stabilität und tatsächlicher Teamaufwand bestimmen das Release.

## 5. UI/UX und Figma

### Designrichtung

- Ruhige, hochwertige Oberfläche statt überladener Werkzeugleisten.
- Sidebar als zentrales Navigationselement.
- Tabs, Spaces und Pins als klar unterscheidbare Konzepte.
- Weiche Formen, sorgfältige Abstände und konsistente Interaktionen.
- Auf iOS eine **native, touchoptimierte** Interpretation derselben Produktsprache.
- Einstellungen klar auffindbar und verständlich – ohne sie ständig in den Vordergrund zu stellen.

### Figma als mögliche Arbeitsumgebung

Figma ist **eine Option, keine Pflicht und noch keine endgültige Entscheidung**.

**Sinnvolle erste Figma-Artefakte:**
- Desktop: Browserfenster mit Sidebar, Adressleiste und einem Beispiel-Tab.
- iOS: Startansicht, Tabübersicht und Webseitenansicht.
- Website: einfache Landingpage mit Hero, Produktabbildung und Download-/Waitlist-Platzhalter.
- Mini-Design-System: Farbwerte, Schriftgrössen, Abstände, Eckenradien und Icon-Stil.

**Arbeitsprinzip:** Erst Layout und Interaktionen skizzieren, dann nur einen kleinen UI-Teil implementieren. Figma soll das Team nicht von funktionierenden Prototypen abhalten.

## 6. Naming und Branding

### Namen

- **My Browser 4 Ever:** Name des Projekts und Ausdruck des langfristigen Open-Source-Gedankens.
- **Aven:** derzeit deutlicher Favorit für den späteren Produktnamen – kurz, elegant, gut für App-Icons, YouTube-Titel und Thumbnails.
- Andere diskutierte Ideen: **Veya**, **Nivo** und weitere kurze Kunstnamen.

**Noch offen:** Name endgültig festlegen, Markenrecherche, Domains, Publisher-/Entwicklername. Die bisherige Erwähnung einer bereits existierenden Firma mit dem Namen Aven bedeutet weder automatisch, dass der Name frei verwendbar ist, noch dass er ausgeschlossen ist. Eine gesonderte Prüfung ist notwendig.

### Visuelle Richtung

Ein erster **KI-generierter Logo-Entwurf** wurde als besonders gelungen bewertet:
- abstraktes, weich geformtes A beziehungsweise gefaltetes Band;
- Violett-/Pink-/Blauverläufe und plastische Tiefenwirkung;
- dunkler Hintergrund, geeignet als App-Icon.

**Branding-Risiko:** Die Nähe von „Aven“ und einem A-Symbol zu „Arc“ könnte bei einer ähnlichen Gesamtgestaltung als Kopie wahrgenommen werden. Das Motiv bleibt **ein geschätzter Konzeptentwurf**, nicht das finale Logo. Entscheidend sind eine eigene Formsprache und eigenständiges Branding. Vor Veröffentlichung: Rechte, Wiedererkennbarkeit und Varianten bei kleinen Icon-Grössen prüfen.

**Möglicher Claim:** „Your browser. Forever.“ – nur ein Vorschlag, noch nicht beschlossen.

## 7. Open Source, Organisation und Vertrieb

- Der Hauptzweck ist **Verbreitung und langfristige Nutzbarkeit**, nicht Monetarisierung.
- Offizielle Releases und Haupt-Branches bleiben unter Kontrolle der Maintainer.
- **Open Source bedeutet dennoch:** Bei einer entsprechenden Lizenz dürfen andere den Code ansehen, verwenden und forken. Direkter Schreibzugriff auf das Hauptrepository ist davon unabhängig.
- Lizenz für Browser und Server **vor der öffentlichen Freigabe** wählen; Abhängigkeiten und ihre Lizenzen prüfen.
- Releases sollen über einen klaren, vertrauenswürdigen Updatekanal verteilt werden.
- Für Windows sind Installer, Signierung/Reputation und sichere Updates einzuplanen.
- iOS-Verteilung läuft anfänglich über TestFlight, später gegebenenfalls über den App Store.
- Die Repository-Sichtbarkeit ist gegenwärtig **privat**; die spätere Open-Source-Veröffentlichung ist die erklärte Absicht.

### Sichtbarkeit / Community

Früh einen tatsächlich demonstrierbaren Prototyp veröffentlichen, ohne einen fertigen Arc-Ersatz zu behaupten. Screenshots, kurze Demos, ehrliche Release Notes und Kontakte zu kleineren Tech-Creators könnten helfen, dass Menschen das Projekt entdecken.

**Botschaft:** Ein **eigenständiger, offener Browser**, der von modernen Browsing-Workflows inspiriert ist – keine billige KI-Kopie und kein inoffizieller Arc-Nachbau.

## 8. Kontrolliertes KI-Coding

Das Team möchte KI-Modelle (beispielsweise Claude Opus) produktiv einsetzen, **ohne** dass ein einzelner Prompt unkontrolliert eine komplette Anwendung mit Zusatzfunktionen generiert.

**Arbeitsregel: Eine kleine, überprüfbare Aufgabe pro Schritt.**

1. **Zuerst skizzieren:** Welche Komponente fehlt, wo liegt ihre Verantwortung?
2. **Engen Auftrag formulieren:** Nur genau diese Funktion, keine Extras, keine „Verbesserungen“ ausserhalb des Scopes.
3. **Implementieren lassen:** Kleine Diffs, nachvollziehbare Architektur, möglichst wenige neue Abhängigkeiten.
4. **Selbst starten und testen:** Funktionalität, Sicherheit, Fehler und Verhalten beurteilen.
5. **Review & Commit:** Erst danach die nächste Aufgabe angehen.

**Vorgabe für Coding-Agents:**

> Implementiere ausschliesslich die ausdrücklich beauftragte Teilfunktion. Ergänze keine ungefragten Features, Konten, Sync-Mechanismen, Animationen oder Frameworks. Halte die Änderung klein und prüfbar. Stelle bei Architektur- oder Sicherheitsfragen eine Rückfrage. Stoppe nach dem vereinbarten Schritt und fasse die geänderten Dateien sowie Testresultate zusammen.

**Beispiel-Reihenfolge Desktop:** Leeres Fenster → einzelne Webseite → statische Sidebar → echte Tabverwaltung → Spaces → persistente lokale Speicherung. **Nicht** alles in einem Prompt.

## 9. Erstes gemeinsames Planungstreffen

Ein informelles Treffen von wenigen Stunden mit dem iOS-Entwickler (Brainstorming, eventuell erste Implementierung). **Ergebnisorientiert, aber ohne den Anspruch, schon einen vollständigen Browser zu bauen.**

| Abschnitt | Ziel |
| :-- | :-- |
| Produkt & Prinzipien | Gemeinsames Bild: eigenständig, Open Source, keine Pflichtanmeldung |
| Technik | Electron/Chromium und SwiftUI/WKWebView kurz gegen die konkreten Bedürfnisse prüfen |
| MVP | Exakt definieren, was eine interne Alpha können muss |
| Design | Erste Skizzen: Papier, direkt im Code oder testweise Figma |
| Mini-Build | Windows öffnet eine Webseite; iOS zeigt eine WKWebView |
| Nächste Schritte | Je eine kleine Aufgabe pro Hauptentwickler und nächster kurzer Check-in |

### Konkreter nächster Schritt

- [ ] Gemeinsam festlegen, ob **Electron** für den Windows-Prototyp bestätigt wird
- [ ] Gemeinsame Datenbegriffe für Tabs / Spaces / Pins festhalten
- [ ] Minimalprojekte für Windows und iOS separat starten
- [ ] Figma bei Interesse ausprobieren, ohne die Entwicklung daran zu binden
- [ ] Erst nach einer lauffähigen Demo weitere Features priorisieren

## 10. Offene Entscheidungen

| Frage | Bisherige Tendenz |
| :-- | :-- |
| Endgültiger Produktname? | **Aven** bevorzugt, noch offen |
| Finale Logoform? | KI-Konzept gefällt; mögliche Arc-Assoziation prüfen |
| Desktop-Framework endgültig? | Electron bevorzugt, Prototyp soll Entscheidung validieren |
| UI-Framework Desktop? | React + TypeScript als Vorschlag |
| Lokale Datenhaltung? | SQLite oder vergleichbare Lösung prüfen |
| Designprozess? | Figma testweise möglich, nicht vorgeschrieben |
| Erste öffentliche Alpha wann? | Ende November 2026 als **Stretch Goal** |
| Backend-Mitwirkung des Dritten? | Offen, nicht vorausplanen |
| Hosting für optionale Sync-API? | Hostpoint als möglicher Start; später evaluieren |
| Lizenz und Governance? | Vor Public Release entscheiden |
| Cookie-/Session-Sync? | Langfristige Forschungsfrage, kein MVP-Versprechen |
| macOS-Release? | Nach Windows/iOS prüfen |
| Domain und Publisher? | Später behandeln, nicht vor dem Prototyp blockieren |

---

### Projekt-Motto

**Build the outline. Make it work. Make it good. Then ship it.**

_Dieses Dokument ist eine fortlaufende Projektskizze. Es darf sich durch Prototypen, Nutzerfeedback und technische Erkenntnisse ändern – ohne die Grundprinzipien stillschweigend aufzugeben._
