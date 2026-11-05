const { randomUUID } = require('crypto');
const { shell } = require('electron');

// Die Download-Liste lebt nur im Arbeitsspeicher und wird nicht gespeichert.
class Downloads {
  constructor(onChange) {
    this.onChange = onChange;
    this.list = [];
    this.items = new Map();
  }

  attach(ses) {
    ses.on('will-download', (_event, item) => {
      const rec = {
        id: randomUUID(), filename: item.getFilename(), url: item.getURL(),
        state: 'progressing', received: 0, total: item.getTotalBytes(), path: '', startedAt: Date.now(),
      };
      this.list.unshift(rec);
      this.items.set(rec.id, item);
      item.on('updated', (_e, state) => {
        rec.received = item.getReceivedBytes();
        rec.total = item.getTotalBytes();
        rec.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
        this.onChange();
      });
      item.once('done', (_e, state) => {
        rec.state = state;
        rec.path = item.getSavePath();
        rec.received = item.getReceivedBytes();
        this.items.delete(rec.id);
        this.onChange();
      });
      this.onChange();
    });
  }

  get active() {
    return this.list.filter((d) => d.state === 'progressing' || d.state === 'paused').length;
  }

  find(id) {
    return this.list.find((d) => d.id === id);
  }

  cancel(id) {
    this.items.get(id)?.cancel();
  }

  open(id) {
    const rec = this.find(id);
    if (rec?.state === 'completed' && rec.path) shell.openPath(rec.path);
  }

  show(id) {
    const rec = this.find(id);
    if (rec?.path) shell.showItemInFolder(rec.path);
  }

  clear() {
    for (const item of this.items.values()) item.cancel();
    this.list = this.list.filter((d) => d.state === 'progressing' || d.state === 'paused');
    this.onChange();
  }

  reset() {
    for (const item of this.items.values()) item.cancel();
    this.list = [];
    this.items.clear();
    this.onChange();
  }
}

module.exports = { Downloads };
