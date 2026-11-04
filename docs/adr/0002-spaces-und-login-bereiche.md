# ADR 0002: Spaces und Login-Bereiche

**Status:** Angenommen · **Datum:** 04.11.2026

## Kontext

Spaces ordnen Tabs. Offen war, ob sich Spaces Logins und Cookies teilen. Das bestimmt den Aufbau der Browser-Sessions und lässt sich später nur mit Aufwand ändern.

## Entscheidung

Die Isolation ist **pro Space wählbar**. Jeder Space verweist auf einen **Login-Bereich**: entweder den gemeinsamen oder einen eigenen. Technisch entspricht ein Login-Bereich einer Electron-Partition `persist:<id>`.

## Begründung

- Getrennte Konten, etwa für Arbeit und Privat, sind ein wichtiger Nutzen von Spaces.
- Eine Pflicht zur Isolation wäre für viele unbequem, weil man sich pro Space neu anmelden müsste.
- Das Modell deckt beide Fälle ab und lässt später auch einen flüchtigen Bereich zu, etwa für den Darkweb-Modus.

## Folgen

- Das Feld für den Login-Bereich gehört von Anfang an ins Datenmodell. Die Auswahl in der Oberfläche kann bei Zeitmangel später folgen.
- Berechtigungs-Handler und weitere Sicherheitsregeln müssen zentral für **jede** Session gesetzt werden. Electron erlaubt Berechtigungen in neuen Sessions sonst automatisch.
- Wird ein Tab in einen Space mit anderem Login-Bereich verschoben, verliert er dort seine Anmeldung.
- Wird ein isolierter Space gelöscht, gehen auch seine Logins und Cookies verloren. Die Oberfläche muss davor klar warnen.
- Jeder eigene Login-Bereich braucht zusätzlichen Speicher.
