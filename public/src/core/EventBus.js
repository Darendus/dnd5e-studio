// ============================================================
// core/EventBus.js, central publish/subscribe system
// Decouples all components: nobody imports components
// directly, everything runs through events.
// ============================================================

class EventBus {
  #handlers = new Map();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.#handlers.get(event)?.delete(fn);
  }

  /** Subscribe to an event once. */
  once(event, fn) {
    const off = this.on(event, (...args) => { off(); fn(...args); });
    return off;
  }

  /** Emit an event. */
  emit(event, payload) {
    this.#handlers.get(event)?.forEach(fn => {
      try { fn(payload); }
      catch (e) { console.error(`EventBus-Handler für "${event}" warf Fehler:`, e); }
    });
  }
}

export const bus = new EventBus();

// central event names (avoids typos)
export const EV = {
  CHAR_CHANGED:   'character:changed',   // { changed: string[] }
  CHAR_LOADED:    'character:loaded',
  DATA_READY:     'data:ready',
  LANG_CHANGED:   'i18n:changed',
  SOURCES_CHANGED:'sources:changed',
  ROLL_RESULT:    'dice:result',         // { total, label, detail, special }
  TOAST:          'ui:toast',            // { message, type }
};
