# ADR 0003: Tab-Verwaltung und Laden

**Status:** Angenommen · **Datum:** 04.11.2026

## Kontext

Phase 1 bringt echte Tabs. Zu klären war, wo der Tab-Zustand liegt und was beim Start mit vielen gespeicherten Tabs passiert.

## Entscheidung

- Der **Hauptprozess** führt alle Tabs. Die Sidebar zeigt diesen Zustand nur an und sendet Befehle über eine enge Preload-Schnittstelle.
- Tab-Daten und geladene `WebContentsView`s sind getrennt.
- Beim Start erscheinen alle Tabs in der Sidebar, geladen wird aber nur der aktive. Die anderen laden **erst beim ersten Anklicken**.

## Begründung

- Die Oberfläche bekommt keinen direkten Zugriff auf Browser-Funktionen, und es gibt nur eine Quelle für den Zustand.
- Der Start bleibt schnell, und der Speicherbedarf wächst nicht mit jedem gespeicherten Tab.
- Webseiten werden nicht bei jedem Start kontaktiert. Das passt zum Datenschutz-Anspruch.

## Folgen

- Vor der Preload-Schnittstelle braucht es einen Navigationsschutz für das Sidebar-Fenster. Sonst könnte eine fremde Seite dort landen und die Schnittstelle nutzen.
- Nicht geladene Tabs zeigen nur gespeicherte Daten wie Titel und URL.
- `WebContentsView`s liegen immer über der Oberfläche. Menüs und Vorschläge über der Webseite brauchen eine eigene Overlay-Ebene.
- Links mit `target=_blank` müssen künftig einen neuen Tab öffnen, statt blockiert zu werden.
