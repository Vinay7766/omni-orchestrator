import React, { useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BYOKConfig, ByokProvider, KeyStorageStatus } from "../../lib/types";
import { Key, Eye, EyeOff, Save, ChevronDown, RefreshCw } from "lucide-react";

interface BYOKSettingsProps {
  config: BYOKConfig;
  /** Saves the settings; a rejection is shown and the panel stays open. */
  onChange: (config: BYOKConfig) => void | Promise<void>;
  /** Whether keys are kept between app starts (unknown until loaded). */
  keyStorage?: KeyStorageStatus;
  /** Why the saved settings could not be loaded, if they couldn't. */
  loadError?: string;
}

/** Same order the backend uses when no provider is selected. */
const PROVIDERS: { id: ByokProvider; label: string; setUpBy: keyof BYOKConfig }[] = [
  { id: "gemini", label: "Gemini", setUpBy: "geminiApiKey" },
  { id: "claude", label: "Claude", setUpBy: "anthropicApiKey" },
  { id: "openai", label: "OpenAI", setUpBy: "openaiApiKey" },
  { id: "compatible", label: "OpenAI-compatible endpoint", setUpBy: "compatibleBaseUrl" },
  { id: "ollama", label: "Ollama (local)", setUpBy: "ollamaEndpoint" },
];

const isSet = (value: unknown) => typeof value === "string" && value.trim() !== "";

/** The provider the backend will call: the selected one, else the first one set up. */
export function resolveProvider(config: BYOKConfig): ByokProvider | undefined {
  return config.activeProvider ?? PROVIDERS.find((p) => isSet(config[p.setUpBy]))?.id;
}

const FIELDS: { label: string; key: keyof BYOKConfig; placeholder: string; secret: boolean }[] = [
  { label: "Gemini API key", key: "geminiApiKey", placeholder: "AIza...", secret: true },
  { label: "Anthropic (Claude) API key", key: "anthropicApiKey", placeholder: "sk-ant-...", secret: true },
  { label: "OpenAI API key", key: "openaiApiKey", placeholder: "sk-proj-...", secret: true },
  { label: "OpenAI-compatible endpoint URL", key: "compatibleBaseUrl", placeholder: "http://localhost:8080/v1", secret: false },
  { label: "Endpoint API key (if it needs one)", key: "compatibleApiKey", placeholder: "optional", secret: true },
  { label: "Ollama endpoint (local)", key: "ollamaEndpoint", placeholder: "http://localhost:11434", secret: false },
];

const inputClass =
  "w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono placeholder-zinc-600 focus:outline-none focus:border-indigo-500";

type ModelList = { state: "idle" } | { state: "loading" } | { state: "loaded"; models: string[] } | { state: "error"; message: string };

export const BYOKSettings: React.FC<BYOKSettingsProps> = ({ config, onChange, keyStorage, loadError }) => {
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [local, setLocal] = useState<BYOKConfig>(config);
  const [modelList, setModelList] = useState<ModelList>({ state: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);

  // Opening starts from the saved settings, which may have loaded after the first render.
  const toggle = () => {
    if (!isOpen) {
      setLocal(config);
      setSaveError(null);
    }
    setIsOpen(!isOpen);
  };

  const set = (key: keyof BYOKConfig, value: string) => {
    setLocal((prev) => ({ ...prev, [key]: value === "" && key === "activeProvider" ? undefined : value }));
    if (key !== "preferredModel") setModelList({ state: "idle" });
  };

  const provider = resolveProvider(local);
  const providerReady = provider !== undefined && isSet(local[PROVIDERS.find((p) => p.id === provider)!.setUpBy]);
  // Closed, the badge shows what is saved; open, what is being edited.
  const shown = isOpen ? local : config;
  const shownLabel = PROVIDERS.find((p) => p.id === resolveProvider(shown))?.label;
  const badge = shownLabel ? `${shownLabel}${shown.preferredModel ? ` · ${shown.preferredModel}` : ""}` : "Not configured";

  const loadModels = async () => {
    if (!provider) return;
    setModelList({ state: "loading" });
    try {
      const models = await invoke<string[]>("list_byok_models", { byok: local, provider });
      setModelList({ state: "loaded", models });
    } catch (e) {
      setModelList({ state: "error", message: String(e) });
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    try {
      await onChange(local);
      setIsOpen(false);
    } catch (e) {
      setSaveError(String(e));
    }
  };

  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/60 overflow-hidden">
      <button
        onClick={toggle}
        aria-expanded={isOpen}
        className="w-full px-4 py-3 flex items-center justify-between text-xs text-zinc-300 hover:bg-zinc-800/60 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Key className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="font-medium">BYOK Configuration</span>
          <span
            className={`px-2 py-0.5 rounded font-mono text-[10px] truncate ${
              shownLabel
                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/60"
                : "bg-amber-950/60 text-amber-400 border border-amber-800/60"
            }`}
          >
            {badge}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
          {keyStorage?.available === false ? (
            <p className="text-[11px] text-amber-400 break-words" role="alert">
              Keys are not saved on this system: re-enter them after a restart. Keys are sent only to the
              provider or endpoint you set up here. {keyStorage.message}
            </p>
          ) : (
            <p className="text-[11px] text-zinc-500">
              {keyStorage?.available
                ? "Keys are kept in your system credential store (Windows Credential Manager, macOS Keychain or Secret Service), never in a settings file, and sent only to the provider or endpoint you set up here."
                : "Keys are sent only to the provider or endpoint you set up here."}
            </p>
          )}
          {loadError && (
            <p className="text-[11px] text-red-400 break-words" role="alert">
              Could not load your saved settings: {loadError}
            </p>
          )}

          <div className="flex items-center justify-end">
            <button onClick={() => setShowKeys(!showKeys)} className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1">
              {showKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showKeys ? "Hide keys" : "Show keys"}
            </button>
          </div>

          {FIELDS.map(({ label, key, placeholder, secret }) => (
            <div key={key} className="space-y-1">
              <label htmlFor={`${id}-${key}`} className="text-[11px] text-zinc-400 font-medium block">{label}</label>
              <input
                id={`${id}-${key}`}
                type={secret && !showKeys ? "password" : "text"}
                value={(local[key] as string) || ""}
                onChange={(e) => set(key, e.target.value)}
                placeholder={placeholder}
                autoComplete="off"
                className={inputClass}
              />
            </div>
          ))}

          <div className="space-y-1">
            <label htmlFor={`${id}-provider`} className="text-[11px] text-zinc-400 font-medium block">Provider</label>
            <select
              id={`${id}-provider`}
              value={local.activeProvider ?? ""}
              onChange={(e) => set("activeProvider", e.target.value)}
              className={inputClass}
            >
              <option value="">Automatic (first one set up)</option>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor={`${id}-model`} className="text-[11px] text-zinc-400 font-medium block">Model</label>
            <div className="flex gap-2">
              <input
                id={`${id}-model`}
                list={`${id}-models`}
                value={local.preferredModel || ""}
                onChange={(e) => set("preferredModel", e.target.value)}
                placeholder="Type a model name or load the list"
                autoComplete="off"
                className={inputClass}
              />
              <button
                onClick={loadModels}
                disabled={!providerReady || modelList.state === "loading"}
                className="shrink-0 px-2.5 text-[11px] text-zinc-300 border border-zinc-800 rounded-lg hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${modelList.state === "loading" ? "animate-spin" : ""}`} />
                Load models
              </button>
            </div>
            <datalist id={`${id}-models`}>
              {modelList.state === "loaded" && modelList.models.map((m) => <option key={m} value={m} />)}
            </datalist>
            {modelList.state === "loading" && <p className="text-[11px] text-zinc-500" role="status">Loading models...</p>}
            {modelList.state === "loaded" && (
              <p className="text-[11px] text-zinc-500" role="status">
                {modelList.models.length === 0
                  ? "No models listed by this provider. Type the model name instead."
                  : `${modelList.models.length} model${modelList.models.length === 1 ? "" : "s"} found`}
              </p>
            )}
            {modelList.state === "error" && (
              <p className="text-[11px] text-red-400 break-words" role="alert">{modelList.message}</p>
            )}
          </div>

          {saveError && (
            <p className="text-[11px] text-red-400 break-words" role="alert">
              Could not save: {saveError}
            </p>
          )}

          <button
            onClick={() => void handleSave()}
            className="w-full py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center justify-center gap-1.5 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Save Configuration
          </button>
        </div>
      )}
    </div>
  );
};
