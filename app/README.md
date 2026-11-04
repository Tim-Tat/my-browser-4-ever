# Aven – Desktop-Prototyp (v0.0.1-alpha, Phase 0)

Bewusst minimaler Umriss gemäss [Phase 0 der Roadmap](../README.md#phase-0--architektur-und-klickbarer-rahmen):

- Electron-Fenster öffnet sich
- Eine echte Webseite (`https://www.wikipedia.org/`) wird in einer `WebContentsView` angezeigt
- Statische Sidebar als Umriss (ohne Funktion)

**Nicht enthalten:** Tabs, Adressleiste, Spaces, Speicherung, Sync, Konto, Darkweb-Modus.

## Starten

Voraussetzung: Node.js (getestet mit 22) und npm.

```bash
cd app
npm install
npm start
```

Sollte der Electron-Download bei `npm install` ausbleiben, einmalig `node node_modules/electron/install.js` ausführen.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `src/main.js` | App-Lebenszyklus |
| `src/window.js` | Hauptfenster: Sidebar-Ansicht und Webseiten-Ansicht |
| `src/ui/` | Statische Sidebar (HTML/CSS) |

Webinhalte und Sidebar laufen mit `contextIsolation`, `sandbox` und ohne Node-Integration; neue Fenster werden blockiert.
