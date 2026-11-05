const test = require('node:test');
const assert = require('node:assert');
const { runPanic, STEPS } = require('../src/main/panic');

test('Notfall: Konto wird vor dem Abmelden gelöscht, solange die Gerätesitzung noch gilt', async () => {
  const order = [];
  const ops = Object.fromEntries(STEPS.map(([key]) => [key, async () => { order.push(key); }]));
  const actions = Object.fromEntries(STEPS.map(([key]) => [key, true]));
  await runPanic(actions, ops);
  assert.ok(order.indexOf('deleteAccount') < order.indexOf('stopSync'), `Reihenfolge war: ${order.join(', ')}`);
});

test('Notfall: Ein fehlgeschlagener Schritt bricht die übrigen nicht ab', async () => {
  const ops = {
    deleteAccount: async () => { throw new Error('offline'); },
    stopSync: async () => ({ ok: true }),
  };
  const results = await runPanic({ deleteAccount: true, stopSync: true }, ops);
  assert.deepStrictEqual(results.filter((r) => r.key !== 'cloud').map((r) => [r.key, r.ok]), [['deleteAccount', false], ['stopSync', true]]);
});
