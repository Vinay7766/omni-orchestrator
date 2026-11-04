/**
 * What the person has typed but not saved into a project yet (the idea conversation, conversations
 * on documents) is kept on disk in the app's ui-state.json and read back on start (owner's v0.1
 * issue B, 2026-11-04). One JSON document; each value under its own key. Nothing is written before
 * the saved document has been read, so a slow start never overwrites it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Values = Record<string, unknown>;

let loaded: Promise<Values> | null = null;
let values: Values = {};
let timer: ReturnType<typeof setTimeout> | null = null;

function load(): Promise<Values> {
  if (!loaded) {
    loaded = invoke<string | null>("load_ui_state")
      .then((text) => {
        try {
          values = text ? (JSON.parse(text) as Values) : {};
        } catch {
          values = {};
        }
        return values;
      })
      .catch(() => (values = {}));
  }
  return loaded;
}

function saveSoon(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void invoke("save_ui_state", { text: JSON.stringify(values) }).catch(() => undefined);
  }, 400);
}

/** Forgets what was read (tests). */
export function forgetUiState(): void {
  loaded = null;
  values = {};
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * Like useState, kept on disk under `key` (null: not kept). The saved value replaces `initial`
 * once read; each change is saved shortly after.
 */
export function usePersistedState<T>(key: string | null, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  // The latest value, so a functional update (prev => next) works like useState's.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!key) return;
    let current = true;
    void load().then((all) => {
      if (!current) return;
      if (key in all) {
        latest.current = all[key] as T;
        setValue(all[key] as T);
      }
    });
    return () => {
      current = false;
    };
  }, [key]);

  const set = useCallback(
    (update: T | ((prev: T) => T)) => {
      const next = typeof update === "function" ? (update as (prev: T) => T)(latest.current) : update;
      latest.current = next;
      setValue(next);
      if (!key) return;
      void load().then(() => {
        values = { ...values, [key]: next };
        saveSoon();
      });
    },
    [key],
  );

  return [value, set];
}
