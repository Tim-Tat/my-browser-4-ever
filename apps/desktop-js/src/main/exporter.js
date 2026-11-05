const SCHEMA_VERSION = 1;

function buildExport({ appVersion, spaces, tabs, profile, now = new Date() }) {
  return {
    format: 'aven-export',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    app: { name: 'Aven', version: appVersion },
    settings: profile.settings,
    spaces: spaces.map(({ id, name, color }) => ({ id, name, color })),
    tabs: tabs.map(({ id, spaceId, pinned, url, title }) => ({ id, spaceId, pinned, url, title })),
    archive: profile.archive,
    bookmarks: profile.bookmarks,
    history: profile.history,
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  // Zellen, die eine Tabellenkalkulation als Formel lesen würde, entschärfen.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function historyToCsv(history) {
  const rows = history.map((e) => [new Date(e.visitedAt).toISOString(), e.title, e.url].map(csvCell).join(','));
  return ['besucht_am,titel,adresse', ...rows].join('\r\n') + '\r\n';
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function section(title, header, rows) {
  const head = header.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<h2>${escapeHtml(title)} (${rows.length})</h2><table><tr>${head}</tr>${body}</table>`;
}

function toHtmlReport(data) {
  const date = (ms) => new Date(ms).toLocaleString('de-CH');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Aven-Datenexport</title>
<style>body{font:14px system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;margin-bottom:2rem}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;word-break:break-all}</style></head>
<body><h1>Aven-Datenexport</h1><p>Erstellt am ${escapeHtml(new Date(data.exportedAt).toLocaleString('de-CH'))} mit Aven ${escapeHtml(data.app.version)}.</p>
${section('Spaces', ['Name'], data.spaces.map((s) => [s.name]))}
${section('Offene Tabs', ['Titel', 'Adresse', 'Angeheftet'], data.tabs.map((t) => [t.title, t.url, t.pinned ? 'ja' : 'nein']))}
${section('Lesezeichen', ['Titel', 'Adresse', 'Hinzugefügt'], data.bookmarks.map((b) => [b.title, b.url, date(b.addedAt)]))}
${section('Archiv', ['Titel', 'Adresse', 'Archiviert'], data.archive.map((a) => [a.title, a.url, date(a.archivedAt)]))}
${section('Verlauf', ['Titel', 'Adresse', 'Besucht'], data.history.map((h) => [h.title, h.url, date(h.visitedAt)]))}
</body></html>`;
}

module.exports = { buildExport, historyToCsv, toHtmlReport, SCHEMA_VERSION };
