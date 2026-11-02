import React, { useId } from "react";
import { Cpu, Cloud, Settings } from "lucide-react";

/**
 * PLAN-5: planning runs on the person's own model. With none set up, explain the two free ways
 * in plain words, step by step. Named products are examples of each kind, not a fixed list.
 */
export const NoKeyGuide: React.FC<{ onOpenSettings: () => void }> = ({ onOpenSettings }) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 space-y-3">
      <div>
        <h3 id={id} className="text-sm font-semibold text-zinc-100">
          Set up an AI model to plan with
        </h3>
        <p className="text-xs text-zinc-400 mt-1">
          The planning phases run on your own AI model. You can create the project now; you need a model before the first phase runs. Two free ways:
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" aria-hidden="true" /> A model on this computer
          </h4>
          <ol className="list-decimal list-inside text-xs text-zinc-400 space-y-1">
            <li>Install a local model runner, for example Ollama, or any server that speaks the OpenAI API.</li>
            <li>Download one model in it, following the runner's own instructions.</li>
            <li>In Settings, enter the runner's address (Ollama's is http://localhost:11434), choose Load models, and pick one.</li>
          </ol>
          <p className="text-xs text-zinc-500">Free and private: nothing leaves your computer. Slower on an ordinary laptop.</p>
        </div>
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5" aria-hidden="true" /> A provider's free tier
          </h4>
          <ol className="list-decimal list-inside text-xs text-zinc-400 space-y-1">
            <li>Create an account with an AI provider that offers a free tier (some do, for example Google's Gemini API).</li>
            <li>Create an API key in that provider's console.</li>
            <li>In Settings, paste the key, choose Load models, and pick one.</li>
          </ol>
          <p className="text-xs text-zinc-500">Free tiers have usage limits, and some let the provider use your prompts: read its terms first.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="px-2.5 py-1.5 text-xs rounded-lg flex items-center gap-1.5 text-zinc-300 border border-zinc-800 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Settings className="w-3.5 h-3.5" aria-hidden="true" /> Open Settings
      </button>
    </section>
  );
};
