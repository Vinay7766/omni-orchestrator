import React, { useState } from "react";
import type { BYOKConfig } from "../../lib/types";
import { Key, Eye, EyeOff, Save, ChevronDown } from "lucide-react";

interface BYOKSettingsProps {
  config: BYOKConfig;
  onChange: (config: BYOKConfig) => void;
}

export const BYOKSettings: React.FC<BYOKSettingsProps> = ({ config, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [local, setLocal] = useState<BYOKConfig>(config);

  const handleSave = () => {
    onChange(local);
    setIsOpen(false);
  };

  const activeProvider = local.anthropicApiKey ? "Claude" 
    : local.geminiApiKey ? "Gemini" 
    : local.openaiApiKey ? "OpenAI" 
    : local.ollamaEndpoint ? "Ollama (Local)" 
    : "Not configured";

  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/60 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between text-xs text-zinc-300 hover:bg-zinc-800/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-zinc-400" />
          <span className="font-medium">BYOK Configuration</span>
          <span className={`px-2 py-0.5 rounded font-mono text-[10px] ${
            activeProvider === "Not configured" 
              ? "bg-amber-950/60 text-amber-400 border border-amber-800/60" 
              : "bg-emerald-950/60 text-emerald-400 border border-emerald-800/60"
          }`}>
            {activeProvider}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
          <p className="text-[11px] text-zinc-500">
            Keys are stored locally only. Never sent to any server except the provider you choose.
          </p>

          <div className="flex items-center justify-end">
            <button
              onClick={() => setShowKeys(!showKeys)}
              className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
            >
              {showKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showKeys ? "Hide keys" : "Show keys"}
            </button>
          </div>

          {[
            { label: "Gemini API Key", key: "geminiApiKey" as keyof BYOKConfig, placeholder: "AIza..." },
            { label: "Anthropic (Claude) API Key", key: "anthropicApiKey" as keyof BYOKConfig, placeholder: "sk-ant-..." },
            { label: "OpenAI API Key", key: "openaiApiKey" as keyof BYOKConfig, placeholder: "sk-proj-..." },
            { label: "Ollama Endpoint (Local)", key: "ollamaEndpoint" as keyof BYOKConfig, placeholder: "http://localhost:11434" },
          ].map(({ label, key, placeholder }) => (
            <div key={key} className="space-y-1">
              <label className="text-[11px] text-zinc-400 font-medium block">{label}</label>
              <input
                type={showKeys ? "text" : "password"}
                value={(local[key] as string) || ""}
                onChange={(e) => setLocal((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}

          <div className="space-y-1">
            <label className="text-[11px] text-zinc-400 font-medium block">Preferred Model</label>
            <select
              value={local.preferredModel || ""}
              onChange={(e) => setLocal((prev) => ({ ...prev, preferredModel: e.target.value }))}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Auto-select based on key</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
              <option value="claude-opus-4-5">Claude Opus 4.5</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="ollama-local">Ollama (Local)</option>
            </select>
          </div>

          <button
            onClick={handleSave}
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
