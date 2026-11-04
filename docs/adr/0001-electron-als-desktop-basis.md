# ADR 0001: Electron als Desktop-Basis

**Status:** Angenommen · **Datum:** 04.11.2026

## Kontext

Aven braucht unter Windows eine Browser-Basis, die ein kleines Team mit rund 10 Stunden pro Woche langfristig pflegen kann. Der Phase-0-Prototyp läuft mit Electron, zeigte aber nur, dass eine Webseite lädt. Offen war, ob Electron für einen Alltagsbrowser reicht.

Für das erste öffentliche Release ist nur der **Google-Login** eine Pflichtanforderung. Werbeblocker, Chrome-Erweiterungen und DRM (Netflix, Spotify) sind keine Bedingung.

## Entscheidung

Wir bleiben bei **Electron**. Den User-Agent verändern wir nicht.

## Begründung

- **Google-Login getestet:** Am 04.11.2026 gelang die Anmeldung mit Electron 45.2.2 (Chromium 156) und unverändertem User-Agent, inklusive Bestätigung auf dem Gerät, bis in Gmail.
- **Gleiche Engine wie Arc:** Arc nutzt ebenfalls Chromium. Eine andere Hülle brächte keine stabilere Engine.
- **Chromium-Fork:** Die Pflege wäre nach unserer Schätzung etwa 10-mal so aufwändig und würde die verfügbare Zeit allein für Updates aufbrauchen.
- **Firefox-Fork:** Bleibt die einzige ernsthafte Alternative, ist nach dem bestandenen Test aber nicht nötig.
- **CEF:** Bietet gegenüber Electron keinen Vorteil für unser Vorhaben.

## Folgen

- Chrome-Erweiterungen laufen nur teilweise, DRM fehlt vorerst.
- Passwortspeicher, Autofill und Safe Browsing fehlen in Electron. Wir lösen sie selbst oder lassen sie bewusst weg.
- Electron bringt etwa alle 8 Wochen eine neue Hauptversion und pflegt nur die letzten drei. Updates, CI und Releases müssen deshalb weitgehend automatisiert sein.
- Der Test umfasst nur ein Konto und ein Gerät. Die fertige App schreibt zudem ihren Namen in den User-Agent. Wir wiederholen den Test mit dem Installer und nach Electron-Updates.
- Ein Kurzlauf ohne `Electron` im User-Agent landete auf Googles Block-Seite. Das war ein einzelner, nicht wiederholter Lauf, spricht aber gegen eine Bereinigung.
- Datenmodell, Tab-Logik und Sync bleiben von Electron getrennt, damit ein späterer Wechsel möglich bleibt.
