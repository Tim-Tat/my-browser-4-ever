const STEPS = [
  ['endDarkweb', 'Darkweb-Sitzung beenden (Fenster, Tor, Sitzungsdaten, Schlüssel)'],
  ['closeTabs', 'Offene Tabs schließen'],
  ['clearHistoryArchive', 'Verlauf, Archiv und Download-Liste entfernen'],
  ['clearSiteData', 'Cookies, Cache und Website-Daten löschen'],
  ['stopSync', 'Sync stoppen, Sitzung beenden, lokale Schlüssel verwerfen'],
  ['deleteAccount', 'Konto und Sync-Daten auf dem Server löschen'],
  ['lockVault', 'Passwort-Tresor sperren'],
  ['deleteVault', 'Passwort-Tresor unwiderruflich löschen'],
  ['resetProfile', 'Lokales Profil zurücksetzen (Lesezeichen, Einstellungen)'],
];

// Führt die gewählten Schritte nacheinander aus. Ein Fehler bricht die übrigen
// Schritte nicht ab; jeder Schritt meldet sein eigenes Ergebnis.
async function runPanic(actions, ops) {
  const results = [];
  for (const [key, label] of STEPS) {
    if (!actions[key]) continue;
    try {
      const outcome = await ops[key]();
      results.push({ key, label, ok: outcome && 'ok' in outcome ? outcome.ok : true, ...(outcome?.detail ? { detail: outcome.detail } : {}) });
    } catch (err) {
      results.push({ key, label, ok: false, detail: String(err?.message || err) });
    }
  }
  results.push({
    key: 'cloud',
    label: 'Cloud und andere Geräte',
    ok: null,
    detail: 'Andere Geräte behalten ihre lokalen Daten. Ihre Sitzungen enden erst, wenn der Server die Konto-Löschung bestätigt hat.',
  });
  return results;
}

const PANIC_NOTE =
  'Diese Funktion versucht, die ausgewählten Browserdaten möglichst schnell zu löschen. ' +
  'Eine vollständige Entfernung aller Spuren auf Datenträgern (z. B. SSD-Reste, Backups, Auslagerungsdatei), ' +
  'in Screenshots oder auf Websites kann nicht garantiert werden.';

module.exports = { runPanic, PANIC_NOTE, STEPS };
