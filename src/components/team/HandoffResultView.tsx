import React, { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import type { HandOffOutcome } from "../../lib/team";

/** What happened when the build was handed to one tool: files, MCP, start, and the package. */
export const HandoffResultView: React.FC<{ name: string; outcome: HandOffOutcome }> = ({ name, outcome }) => {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  if (!outcome.ok) {
    return (
      <p role="alert" className="text-xs text-red-400 break-words">
        {name} was not set up: {outcome.error}
      </p>
    );
  }
  const { result, handoffPackage, buildStarted, buildProblem } = outcome;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handoffPackage ?? "");
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <section aria-label={`Handoff to ${name}`} className="space-y-2 text-xs text-zinc-300">
      <p className={result.launched ? "text-emerald-400" : "text-zinc-300"}>{result.message}</p>
      {buildStarted && <p>The build phase has started.</p>}
      {buildProblem && <p role="alert" className="text-red-400 break-words">{buildProblem}</p>}
      {result.files.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5">
          {result.files.map((line) => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      )}
      {result.mcp && <p className="break-words">{result.mcp.message}</p>}
      {result.mcpProblem && (
        <div className="flex gap-2 text-amber-300">
          <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <pre className="whitespace-pre-wrap break-words font-mono">{result.mcpProblem}</pre>
        </div>
      )}
      {handoffPackage !== undefined && (
        <div className="space-y-1.5">
          <label htmlFor={`package-${result.toolId}`} className="block text-zinc-400">
            Handoff package (also saved in .agents/handoff/latest.md). Paste it into {name}.
          </label>
          <textarea
            id={`package-${result.toolId}`}
            readOnly
            value={handoffPackage}
            rows={8}
            className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 font-mono text-zinc-200"
          />
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
          >
            {copied === "yes" ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
            {copied === "yes" ? "Copied" : "Copy"}
          </button>
          {copied === "failed" && <p role="alert" className="text-red-400">Copying was not allowed here; select the text and copy it yourself.</p>}
        </div>
      )}
    </section>
  );
};
