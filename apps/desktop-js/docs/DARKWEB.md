# Darkweb-Modus (Onion-Modus): Umsetzung

Setzt das [Ideenpapier](DARKWEB_MODUS_IDEE.md) für Windows um. Aven bringt kein Anonymisierungsnetz mit, sondern bindet das Tor-Programm als Begleitprozess ein.

> **Keine Anonymitätsgarantie.** Das ist nicht der Tor Browser. Wer ernsthaft anonym bleiben muss, nutzt den Tor Browser. Der Hinweis erscheint vor der ersten Nutzung.

## Aufbau

- **Eigenes Fenster**, eigene Sitzung ohne `persist:` (nur im Arbeitsspeicher), eigenes Design mit Badge „Onion-Modus“ in Amber. Zugang nur über *Browser > Darkweb-Fenster öffnen*. Links aus dem normalen Fenster öffnen sich nie dort.
- **Schicht 1, Transport:** Alle Anfragen laufen über einen lokalen SOCKS5-Proxy von Tor. Hostnamen gehen als Namen an den Proxy, die Namensauflösung passiert also über Tor und nicht lokal. Bei HTTPS kommt TLS dazu, bei `.onion` die Verschlüsselung der Onion-Dienste.
- **Fail-closed:** Ohne laufendes Tor zeigt der Proxy ins Leere und eine Netzwerkregel bricht jede Anfrage ab. Es gibt keinen Rückfall auf eine direkte Verbindung. Stirbt Tor, ist sofort wieder alles blockiert.
- **Lokale Ziele gesperrt:** `localhost`, private und Link-lokale Adressen, `.local` und alle Nicht-Web-Schemas (`file:`, `ftp:` …) sind gesperrt, damit Seiten keine Dienste im eigenen Netz abtasten.
- **WebRTC** nur über den Proxy (`disable_non_proxied_udp`), **alle Berechtigungen verweigert**, **Downloads blockiert** (mit Hinweis), keine Rechtschreibprüfung über das Netz, kein Passwortspeicher, kein Verlauf, keine Favicons auf der Platte. Beim Beenden werden Sitzungsdaten und Cache gelöscht.
- **Sicherheitsstufen:** Standard; Sicherer (kein WebGL, Autoplay nur nach Klick); Am sichersten (JavaScript aus). Beim Wechsel bekommen alle Tabs neue Einstellungen.
- **Adressleiste:** keine Suche, keine Vorschläge, keine Verzeichnisse. Nur Adressen, die du selbst eingibst.
- **Privatsphäre-Schleier:** Verliert das Fenster den Fokus, wird sein Inhalt abgedeckt.

## Tor-Programm

Aven liefert Tor nicht mit. Lege `tor.exe` (von torproject.org, Signatur prüfen) in den Ordner `tor` im Aven-Datenordner oder wähle die Datei im Dialog. Aven merkt sich beim ersten Start den SHA-256-Fingerabdruck und startet danach nur dieses Programm. Ändert sich die Datei, wird sie nicht mehr gestartet, bis du ihr ausdrücklich vertraust. Tor-Sicherheitsupdates musst du selbst einspielen.

Tor lauscht nur auf `127.0.0.1` an einem zufälligen Port, ohne Steuerverbindung (`ControlPort 0`), mit einem temporären Datenordner, der beim Beenden gelöscht wird. Bridges und ein Transport-Programm (zum Beispiel obfs4) lassen sich im Verbindungsdialog eintragen.

## Schicht 2, Container

Lesezeichen liegen in einem eigenen verschlüsselten Container (AES-256-GCM). Der Datenschlüssel wird zuerst mit dem Windows-Konto und das Ergebnis dann mit der Passphrase (scrypt) verpackt: zum Öffnen braucht es beide. Es gibt **keine Wiederherstellung**. Wer die Passphrase verliert, verliert die Lesezeichen. Der Container wird mit dem Fenster gesperrt. Kein Sync, kein Verlauf.

## Notfall

*Beenden* im Fenster und der Notfallknopf des Browsers beenden die Sitzung lokal und sofort, ohne Serverantwort: Fenster schließen, Tor stoppen, Sitzungsdaten verwerfen, Container sperren.

## Getestet und nicht getestet

Getestet mit einem Ersatz-Tor in der echten App (`test/fixtures/fake-tor.js`): ohne Tor ist jede Anfrage blockiert und lokale Ziele werden nie erreicht. Mit Tor kommen Anfragen als Domainnamen beim Proxy an, Tor-Absturz blockiert wieder alles, Beenden räumt auf. Dazu Unit-Tests für torrc, Prozess-Lebenszyklus, Adressregeln und Container.

**Nicht getestet:** mit dem echten Tor-Programm und dem echten Tor-Netzwerk, Leak-Tests im Browser (DNS, WebRTC auf Testseiten, HTTP/3), Bridges und Transport-Programme, Onion-Dienste. Es gab keinen unabhängigen Sicherheitsreview. Vor jeder Werbeaussage sind echte Leak-Tests und ein externer Review nötig (Phase DW-5 im Ideenpapier).

**Nicht umgesetzt:** iOS, Marken- und Rechtsprüfung für Name und Verteilung, Store-Fragen.
