import React, { useState } from "react";
import { FileText } from "lucide-react";
import type { MemoryFile } from "../../lib/memory";

/** The project's memory files, read-only (MEM-5). They are rebuilt from the event log. */
export const MemoryFiles: React.FC<{ files: MemoryFile[] }> = ({ files }) => {
  const [selected, setSelected] = useState(files[0]?.name);
  const file = files.find((f) => f.name === selected) ?? files[0];
  if (!file) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400">
        These files are generated from the project's event log, so they are read-only here. To change what they say, add an
        entry below; it is recorded and then appears in them.
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Memory files">
        {files.map((f) => (
          <button
            key={f.name}
            onClick={() => setSelected(f.name)}
            aria-pressed={f.name === file.name}
            className={`px-2 py-1 rounded-md text-xs font-mono flex items-center gap-1 border focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              f.name === file.name ? "border-indigo-500 text-zinc-100 bg-zinc-800" : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
            }`}
          >
            <FileText className="w-3 h-3" aria-hidden="true" />
            {f.name}
          </button>
        ))}
      </div>
      {file.content === null ? (
        <p className="text-xs text-zinc-500">{file.name} has not been written yet.</p>
      ) : (
        <pre
          aria-label={file.name}
          tabIndex={0}
          className="max-h-96 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 whitespace-pre-wrap break-words focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {file.content}
        </pre>
      )}
    </div>
  );
};
