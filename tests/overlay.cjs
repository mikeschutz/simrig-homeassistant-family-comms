'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../overlay');
const { parseMessage } = require(path.join(root, 'model.js'));
for (const raw of ['null', '[]', '42', '{', '{}', '{"pending":"true"}']) assert.equal(parseMessage(raw).kind, 'invalid');
assert.equal(parseMessage('{"pending":false}').kind, 'clear');
assert.equal(parseMessage(JSON.stringify({ pending: true, id: '1', text: 'a'.repeat(181) })).kind, 'invalid');
const hostile = '<img src=x onerror=alert(1)>';
assert.equal(parseMessage(JSON.stringify({ pending: true, id: '1', text: hostile })).text, hostile);

function environment(search = '') {
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: ['message', 'settings', 'form-error', 'stale-note'].includes(id),
      value: '', checked: false, textContent: '', className: '', handlers: {},
      classList: { values: new Map(), toggle(name, value) { this.values.set(name, value); } },
      addEventListener(event, handler) { this.handlers[event] = handler; }
    });
    return elements.get(id);
  };
  const storage = () => { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; };
  const clients = [];
  const timeouts = [];
  const context = vm.createContext({
    document: { getElementById: el, body: el('body') }, URL, URLSearchParams, Date, JSON, Object,
    location: { search }, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    localStorage: storage(), sessionStorage: storage(),
    setTimeout(fn) { const timer = { fn, cancelled: false }; timeouts.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cancelled = true; }, setInterval() {},
    mqtt: { connect(url, options) {
      const client = { url, options, handlers: {}, subscriptions: [], ended: false,
        on(event, callback) { this.handlers[event] = callback; },
        subscribe(topic, options, callback) { this.subscriptions.push(topic); callback(null, [{ qos: 1 }]); },
        end() { this.ended = true; }, reconnect() {},
        publish() { throw Error('Overlay must never publish'); },
        emit(event, ...args) { this.handlers[event]?.(...args); }
      };
      clients.push(client); return client;
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'model.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'overlay.js'), 'utf8'), context);
  return { el, clients, context, timeouts };
}
const { el, clients } = environment();
assert.equal(el('settings').hidden, false);
el('broker').value = 'wss://rig-messages.example.com/mqtt';
el('username').value = 'simrig_overlay';
el('password').value = 'test-only-not-a-user-secret';
el('connect-form').handlers.submit({ preventDefault() {} });
assert.equal(clients.length, 1);
const client = clients[0];
assert.equal(client.options.clean, true);
client.emit('connect');
assert.deepEqual(client.subscriptions, ['simrig/message']);
const message = (value) => client.emit('message', 'simrig/message', { toString: () => JSON.stringify(value) });
message({ pending: true, id: 'one', text: 'Dinner in ten minutes', priority: 'normal' });
assert.equal(el('message').hidden, false);
assert.equal(el('message-text').textContent, 'Dinner in ten minutes');
assert.equal(el('message').classList.values.get('urgent'), false);
message({ pending: true, id: 'two', text: hostile, priority: 'urgent' });
assert.equal(el('message-text').textContent, hostile);
assert.equal(el('message').classList.values.get('urgent'), true);
assert.equal(el('priority').textContent, 'URGENT · HOME MESSAGE');
client.emit('close');
assert.equal(el('stale-note').hidden, false);
assert.match(el('health-text').textContent, /offline/);
client.emit('connect');
assert.equal(el('stale-note').hidden, false, 'Cached message must stay marked stale until a fresh retained state');
message({ pending: false, id: '', text: '', reply: 'Acknowledged' });
assert.equal(el('message').hidden, true);
assert.equal(el('body').classList.values.get('compact'), false);
const compactPreview = environment('?compact=1&demo=urgent');
assert.equal(compactPreview.el('body').classList.values.get('compact'), true);
assert.equal(compactPreview.el('message').hidden, false);
assert.equal(compactPreview.el('message').classList.values.get('urgent'), true);
assert.equal(compactPreview.clients.length, 0);
message({ pending: true, id: 'three', text: 'Another message' });
message({ pending: false, id: '', text: '', reply: 'Message cancelled.' });
assert.equal(el('message').hidden, true);
client.emit('message', 'simrig/message', { toString: () => '{bad json' });
assert.match(el('health-text').textContent, /format/);
client.emit('error', { code: 5, message: 'Not authorized' });
assert.equal(client.ended, true);
assert.equal(el('settings').hidden, false);
assert.equal(el('form-error').hidden, false);
el('forget').handlers.click();
assert.equal(el('password').value, '');
assert.equal(el('message').hidden, true);
assert(!fs.readFileSync(path.join(root, 'overlay.js'), 'utf8').includes('.publish('));
assert(!fs.readFileSync(path.join(root, 'overlay.js'), 'utf8').includes('innerHTML'));
console.log('PASS: strict payload parsing, normal/urgent rendering, inert HTML text, ACK/cancel clearing, reconnect/stale state, authentication failure, forget login, and read-only subscription.');
