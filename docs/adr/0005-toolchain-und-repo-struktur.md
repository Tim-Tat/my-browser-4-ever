# ADR 0005: Toolchain und Repo-Struktur

**Status:** Angenommen · **Datum:** 04.11.2026

## Kontext

Der Prototyp besteht aus rund 75 Zeilen JavaScript in `app/`. Es gibt weder CI noch eine Build-Konfiguration im Repo, und für iOS fehlt ein Platz. Ein Umbau ist jetzt noch günstig.

## Entscheidung

- Der Desktop-Code wird auf **TypeScript** und **React mit Vite** umgestellt.
- Das Repo wird ein **Monorepo**:

```text
apps/desktop      Electron-App
apps/ios          SwiftUI-App
packages/schema   Gemeinsames JSON-Schema
```

- Die Build-Konfiguration für den Installer kommt ins Repo.

## Begründung

- Typen fangen Fehler früh ab, besonders an der Schnittstelle zwischen Hauptprozess und Oberfläche.
- Mit Spaces, Pins und Drag-and-drop wird die Sidebar für schlichtes HTML und JavaScript schnell mühsam.
- Windows und iOS teilen keinen UI-Code, aber das Datenschema. Es bekommt einen eigenen Platz.

## Folgen

- Der Umbau kostet etwa einen Abend, und `app/` zieht nach `apps/desktop` um.
- Der Logo-Pfad in der Sidebar zeigt heute aus `app/` hinaus und muss beim Umbau gelöst werden.
- Builds müssen reproduzierbar werden. Heute liegt nur ein lokaler Installer in `app/dist`, ohne Konfiguration im Repo.
- Es kommen neue Abhängigkeiten dazu, die wir aktuell halten müssen.
