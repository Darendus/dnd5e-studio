// ============================================================
// core/EventBus.js, Zentrales Publish/Subscribe-System
// Entkoppelt alle Komponenten: Niemand importiert Komponenten
// direkt, alles läuft über Events.
// ============================================================

class EventBus {
  #handlers = new Map();

  /** Event abonnieren. Gibt Unsubscribe-Funktion zurück. */
  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.#handlers.get(event)?.delete(fn);
  }

  /** Event einmalig abonnieren. */
  once(event, fn) {
    const off = this.on(event, (...args) => { off(); fn(...args); });
    return off;
  }

  /** Event auslösen. */
  emit(event, payload) {
    this.#handlers.get(event)?.forEach(fn => {
      try { fn(payload); }
      catch (e) { console.error(`EventBus-Handler für "${event}" warf Fehler:`, e); }
    });
  }
}

export const bus = new EventBus();

// Zentrale Event-Namen (vermeidet Tippfehler)
export const EV = {
  CHAR_CHANGED:   'character:changed',   // { changed: string[] }
  CHAR_LOADED:    'character:loaded',
  DATA_READY:     'data:ready',
  LANG_CHANGED:   'i18n:changed',
  SOURCES_CHANGED:'sources:changed',
  ROLL_RESULT:    'dice:result',         // { total, label, detail, special }
  TOAST:          'ui:toast',            // { message, type }
};
