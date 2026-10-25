/* Pure message handling, also loaded by the offline tests. */
(function (root) {
  'use strict';
  function parseMessage(raw) {
    let value;
    try { value = JSON.parse(raw); } catch { return { kind: 'invalid' }; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
    if (value.pending === false) return { kind: 'clear' };
    if (value.pending !== true || typeof value.id !== 'string' || !value.id ||
        typeof value.text !== 'string' || !value.text.trim() || value.text.length > 180) {
      return { kind: 'invalid' };
    }
    return { kind: 'message', id: value.id, text: value.text,
      priority: value.priority === 'urgent' ? 'urgent' : 'normal' };
  }
  root.RigMessageModel = Object.freeze({ parseMessage });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RigMessageModel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
