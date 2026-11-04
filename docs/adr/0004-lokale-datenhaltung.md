# ADR 0004: Lokale Datenhaltung

**Status:** Angenommen · **Datum:** 04.11.2026

## Kontext

Tabs, Spaces, Pins, Archiv und Verlauf müssen lokal gespeichert werden. Sync kommt erst später, das Schema muss aber dazu passen und auch für iOS taugen.

## Entscheidung

- Desktop speichert in **SQLite** hinter einer eigenen Speicherschicht im Hauptprozess.
- Die Verschlüsselung der Datenbank folgt **später**.
- Alle Datensätze erhalten von Anfang an UUIDs, `updated_at`, Löschmarkierungen (Tombstones) und eine Schema-Version.
- Die Datenbegriffe definieren wir als versioniertes JSON-Schema. Es dient auch als Exportformat.

## Begründung

- SQLite ist bewährt, läuft lokal und kommt ohne Server aus.
- Dank der Speicherschicht lässt sich die Verschlüsselung später ergänzen, ohne die übrige App umzubauen.
- Die Sync-Felder kosten jetzt wenig und wären später teuer nachzurüsten.

## Folgen

- Der Verlauf liegt vorerst unverschlüsselt auf der Platte, wie bei den meisten Browsern. Das sagen wir im ersten Release offen.
- Cookies und Cache verwaltet Chromium selbst. Sie fallen nicht unter diese Entscheidung.
- Das Löschen per Schlüssel für den Panic-Button (Crypto-Erasure) ist erst nach der Verschlüsselung möglich.
- Das Schema stimmen wir mit dem iOS-Entwickler ab, bevor wir darauf aufbauen.
- Die konkrete SQLite-Bibliothek wählen wir bei der Umsetzung.
