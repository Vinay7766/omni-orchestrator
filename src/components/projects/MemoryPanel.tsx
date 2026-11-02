import React, { useCallback, useEffect, useState } from "react";
import type { MemoryFilesResult, NewEntry } from "../../lib/memory";
import type { DecisionResult } from "../../lib/decisions";
import { MemoryFiles } from "./MemoryFiles";
import { MemoryEntryForm } from "./MemoryEntryForm";

interface MemoryPanelProps {
  root: string;
  load: (root: string) => Promise<MemoryFilesResult>;
  add: (root: string, entry: NewEntry) => Promise<DecisionResult>;
}

const failed = (e: unknown): MemoryFilesResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

/** A project's memory (APP-2): the files, read-only, and the person's own entries (E3 slice 4a). */
export const MemoryPanel: React.FC<MemoryPanelProps> = ({ root, load, add }) => {
  const [files, setFiles] = useState<MemoryFilesResult | null>(null);
  const [outcome, setOutcome] = useState<DecisionResult | null>(null);

  useEffect(() => {
    let current = true;
    load(root)
      .then((f) => current && setFiles(f))
      .catch((e) => current && setFiles(failed(e)));
    return () => {
      current = false;
    };
  }, [root, load]);

  const record = useCallback(
    async (entry: NewEntry) => {
      const result = await add(root, entry).catch((e): DecisionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
      setOutcome(result);
      if (result.ok) setFiles(await load(root).catch(failed));
    },
    [add, load, root],
  );

  return (
    <section className="space-y-3" aria-labelledby={`memory-${root}`}>
      <h3 id={`memory-${root}`} className="text-sm font-semibold text-zinc-100">
        Project memory
      </h3>
      {!files && (
        <p role="status" className="text-xs text-zinc-400">
          Loading the memory files...
        </p>
      )}
      {files && !files.ok && (
        <p role="alert" className="text-xs text-red-400 break-words">
          The memory files could not be read: {files.error}
        </p>
      )}
      {files && files.ok && <MemoryFiles files={files.files} />}
      <h4 className="text-xs font-semibold text-zinc-300">Add an entry</h4>
      {outcome && (
        <p role={outcome.ok ? "status" : "alert"} className={`text-xs break-words ${outcome.ok ? "text-emerald-400" : "text-red-400"}`}>
          {outcome.ok ? outcome.message : `Not recorded: ${outcome.message}`}
        </p>
      )}
      <MemoryEntryForm onSubmit={record} />
    </section>
  );
};
