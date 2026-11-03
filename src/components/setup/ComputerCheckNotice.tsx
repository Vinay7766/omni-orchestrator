import React from "react";
import { LifeBuoy } from "lucide-react";
import type { ComputerCheck } from "../../lib/computer-check";

/**
 * G: shown when the computer lacks what building with AI needs. It says what was checked and not
 * found, and offers guided help; it never guesses about the person.
 */
export const ComputerCheckNotice: React.FC<{ check: ComputerCheck; onGuide: () => void; onDismiss: () => void }> = ({ check, onGuide, onDismiss }) => {
  if (check.missing.length === 0) return null;
  return (
    <section aria-label="Computer check" className="rounded-2xl border border-sky-800/60 bg-sky-950/20 p-4 flex gap-3">
      <LifeBuoy className="w-5 h-5 mt-0.5 shrink-0 text-sky-300" aria-hidden="true" />
      <div className="space-y-2 text-sm">
        <p className="text-zinc-100">
          I checked your computer and did not find the tools you need: <strong className="font-semibold">{check.missing.join(" and ")}</strong>.
        </p>
        <p className="text-zinc-300">Are you new to this? Do you want help installing and setting them up, and learning how to use them?</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={onGuide}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            Yes, guide me
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            No, I'm set
          </button>
        </div>
        <p className="text-xs text-zinc-500">With guidance on, new projects use simple mode: fewer steps and plain explanations. You can change a project's mode on its page.</p>
      </div>
    </section>
  );
};
