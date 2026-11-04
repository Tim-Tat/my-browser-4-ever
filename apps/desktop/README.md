# Aven – Desktop-Prototyp (v0.0.1-alpha)

Bewusst minimaler Umriss gemäss [Phase 0 der Roadmap](../../README.md#phase-0--architektur-und-klickbarer-rahmen):

- Electron-Fenster öffnet sich
- Eine echte Webseite (`https://www.wikipedia.org/`) wird in einer `WebContentsView` angezeigt
- Statische Sidebar als Umriss (ohne Funktion)

**Nicht enthalten:** Tabs, Adressleiste, Spaces, Speicherung, Sync, Konto, Darkweb-Modus.

Die Architekturentscheide stehen in den [ADRs](../../docs/adr/README.md).

## Starten

Voraussetzung: Node.js (getestet mit 22) und npm.

```bash
cd apps/desktop
npm install
npm start
```

Sollte der Electron-Download bei `npm install` ausbleiben, einmalig `node node_modules/electron/install.js` ausführen.

## Befehle

| Befehl | Aufgabe |
| --- | --- |
| `npm start` | Baut die App nach `out/` und startet sie |
| `npm run typecheck` | Prüft die TypeScript-Typen |
| `npm run build` | Baut Hauptprozess und Oberfläche nach `out/` |
| `npm run dist` | Baut den Windows-Installer nach `release/` (noch unsigniert) |

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `src/main/main.ts` | App-Lebenszyklus |
| `src/main/window.ts` | Hauptfenster: Sidebar-Ansicht und Webseiten-Ansicht |
| `src/renderer/` | Statische Sidebar (React) |
| `vite.config.mts` | Build der Oberfläche |

Webinhalte und Sidebar laufen mit `contextIsolation`, `sandbox` und ohne Node-Integration; neue Fenster werden blockiert.
