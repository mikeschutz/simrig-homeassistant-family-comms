(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  // Caddy serves this page and the MQTT endpoint on the same HTTPS origin.
  if (location.protocol === 'https:') $('broker').value = 'wss://' + location.host + '/mqtt';
  const STORAGE_KEY = 'simrig-overlay-login-v1';
  let client = null;
  let generation = 0;
  let current = null;
  let receivedAt = 0;
  let connected = false;
  let previewTimer = null;
  let readyTimer = null;
  let receivedState = false;
  let awaitingStateTimer = null;
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo');
  const compact = params.get('compact') === '1';
  document.body.classList.toggle('compact', compact);
  const storageGet = (storage) => { try { return JSON.parse(storage.getItem(STORAGE_KEY)); } catch { return null; } };
  const storageRemove = (storage) => { try { storage.removeItem(STORAGE_KEY); } catch {} };
  function storeLogin(config, remember) {
    storageRemove(localStorage); storageRemove(sessionStorage);
    try { (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(config)); }
    catch { /* A browser may block storage; the connection still works. */ }
  }
  function health(text, state = '') {
    clearTimeout(readyTimer);
    $('health').hidden = false;
    $('health').className = 'health ' + state;
    $('health-text').textContent = text;
  }
  function ready() {
    health('Messages ready', 'connected');
    readyTimer = setTimeout(() => { if (connected && receivedState) $('health').hidden = true; }, 3500);
  }
  function render() {
    $('message').hidden = !current;
    if (!current) return;
    $('message').classList.toggle('urgent', current.priority === 'urgent');
    $('priority').textContent = current.priority === 'urgent' ? 'URGENT · HOME MESSAGE' : 'HOME MESSAGE';
    // Never interpret a household message as HTML.
    $('message-text').textContent = current.text;
    $('stale-note').hidden = (connected && receivedState) || Boolean(demo);
    const seconds = Math.max(0, Math.floor((Date.now() - receivedAt) / 1000));
    $('age').textContent = demo ? 'Preview' : seconds < 60 ? 'Received now' : 'Received ' + Math.floor(seconds / 60) + 'm ago';
  }
  function accept(raw) {
    const parsed = RigMessageModel.parseMessage(raw);
    if (parsed.kind === 'invalid') {
      health('Message format not recognized', 'error');
      return;
    }
    receivedState = true;
    clearTimeout(awaitingStateTimer);
    if (parsed.kind === 'clear') current = null;
    else {
      if (!current || current.id !== parsed.id) receivedAt = Date.now();
      current = parsed;
    }
    render();
    if (connected) ready();
  }
  function preview(urgent) {
    clearTimeout(previewTimer);
    $('settings').hidden = true;
    current = { id: 'preview', text: urgent ? 'Please come upstairs as soon as you can.' : 'Dinner in 10 minutes. See you when you finish.', priority: urgent ? 'urgent' : 'normal' };
    receivedAt = Date.now();
    render();
    $('stale-note').hidden = true;
    health('Preview — not a real message');
    if (!demo) previewTimer = setTimeout(() => { current = null; render(); if (client) client.reconnect(); else $('settings').hidden = false; }, 7000);
  }
  function stop() {
    generation++;
    clearTimeout(readyTimer); clearTimeout(previewTimer); clearTimeout(awaitingStateTimer);
    if (client) client.end(true);
    client = null;
    connected = false;
  }
  function connect(config, remember) {
    let url;
    try { url = new URL(config.broker); } catch { throw new Error('Enter a valid secure MQTT address.'); }
    if (url.protocol !== 'wss:' || url.username || url.password) throw new Error('Use wss:// and the separate username/password fields.');
    if (!config.username || !config.password) throw new Error('Enter the read-only MQTT username and password.');
    if (typeof mqtt === 'undefined') throw new Error('The local MQTT client could not load. Check the vendor files.');
    stop();
    const mine = generation;
    receivedState = false;
    storeLogin(config, remember);
    $('settings').hidden = true;
    $('form-error').hidden = true;
    health('Connecting…');
    client = mqtt.connect(url.href, {
      username: config.username, password: config.password,
      clientId: 'simrig-overlay-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16),
      clean: true, protocolVersion: 4, reconnectPeriod: 4000, connectTimeout: 12000,
      keepalive: 20, resubscribe: true
    });
    client.on('connect', () => {
      if (mine !== generation) return;
      connected = true; receivedState = false; render();
      health('Connected — waiting for message state');
      client.subscribe('simrig/message', { qos: 1 }, (err, granted) => {
        if (mine !== generation) return;
        if (err || !granted || granted.some((item) => item.qos === 128)) {
          health('Message access denied — check account permissions', 'error');
          return;
        }
        if (!receivedState) awaitingStateTimer = setTimeout(() => {
          if (connected && !receivedState) health('Connected — no message state from HA yet');
        }, 6000);
      });
    });
    client.on('message', (topic, payload) => { if (mine === generation && topic === 'simrig/message') accept(payload.toString()); });
    client.on('close', () => {
      if (mine !== generation) return;
      connected = false; health('Messages offline — reconnecting', 'error'); render();
    });
    client.on('error', (err) => {
      if (mine !== generation) return;
      if (err.code === 4 || err.code === 5 || /not authorized|bad user|bad password/i.test(err.message)) {
        stop();
        health('Login rejected', 'error');
        $('settings').hidden = false;
        $('form-error').textContent = 'MQTT login rejected. Check the read-only account and password.';
        $('form-error').hidden = false;
        render();
      } else { health('Messages offline — check the secure connection', 'error'); }
    });
  }
  $('open-settings').addEventListener('click', () => { $('settings').hidden = !$('settings').hidden; });
  $('close-settings').addEventListener('click', () => { $('settings').hidden = true; });
  $('preview-normal').addEventListener('click', () => preview(false));
  $('preview-urgent').addEventListener('click', () => preview(true));
  $('connect-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try { connect({ broker: $('broker').value.trim(), username: $('username').value.trim(), password: $('password').value }, $('remember').checked); }
    catch (err) { $('form-error').textContent = err.message; $('form-error').hidden = false; }
  });
  $('forget').addEventListener('click', () => {
    stop(); storageRemove(localStorage); storageRemove(sessionStorage);
    $('password').value = ''; $('remember').checked = false;
    current = null; render(); health('Disconnected'); $('settings').hidden = false;
  });
  setInterval(render, 10000);
  if (demo === 'normal' || demo === 'urgent') { preview(demo === 'urgent'); return; }
  const remembered = storageGet(localStorage);
  const saved = remembered || storageGet(sessionStorage);
  if (saved) {
    $('broker').value = saved.broker;
    $('username').value = saved.username;
    $('password').value = saved.password;
    $('remember').checked = Boolean(remembered);
    try { connect(saved, Boolean(remembered)); }
    catch (err) { $('settings').hidden = false; $('form-error').textContent = err.message; $('form-error').hidden = false; }
  } else { health('Set up messages'); $('settings').hidden = false; }
  if (params.get('settings') === '1') $('settings').hidden = false;
})();
