const { contextBridge, ipcRenderer } = require('electron');

// Nur die internen Aven-Seiten bekommen eine Schnittstelle; normale Webseiten nicht.
// Der Hauptprozess prüft den Absender zusätzlich bei jedem Aufruf.
if (location.protocol === 'file:' && /\/pages\/aven\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('avenPages', {
    invoke: (name, payload) => ipcRenderer.invoke('aven:page', name, payload),
  });
}

// Meldet abgeschickte Anmeldeformulare an den Hauptprozess, damit er anbieten kann, sie zu speichern.
// Nur eigene Nutzeraktionen zählen (isTrusted). Das Passwort wird nie auf der Seite gespeichert.
if (/^https?:$/.test(location.protocol)) {
  window.addEventListener('submit', (event) => {
    if (!event.isTrusted || !(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    const password = form.querySelector('input[type=password]');
    if (!password || !password.value) return;
    const inputs = [...form.querySelectorAll('input')];
    const before = inputs.slice(0, inputs.indexOf(password)).reverse();
    const user = before.find((el) => ['text', 'email', 'tel', ''].includes(el.type) && el.value);
    ipcRenderer.send('aven:cred-submit', { url: location.href, username: user ? user.value : '', password: password.value });
  }, true);
}
