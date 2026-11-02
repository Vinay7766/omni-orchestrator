import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ProjectDetailResult } from "../../lib/projects";
import { PhaseHistory } from "./PhaseHistory";

interface ProjectDetailProps {
  root: string;
  load: (root: string) => Promise<ProjectDetailResult>;
  onBack: () => void;
}

/** One project: its phase history, read from its memory (E3, GATE-5). */
export const ProjectDetail: React.FC<ProjectDetailProps> = ({ root, load, onBack }) => {
  const [detail, setDetail] = useState<ProjectDetailResult | null>(null);

  useEffect(() => {
    let current = true;
    setDetail(null);
    load(root)
      .then((d) => current && setDetail(d))
      .catch((e) => current && setDetail({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      current = false;
    };
  }, [root, load]);

  return (
    <section className="w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <button onClick={onBack} className="text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1.5">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        Back to projects
      </button>
      {!detail && (
        <p role="status" className="text-sm text-zinc-400">
          Loading the project...
        </p>
      )}
      {detail && !detail.ok && (
        <p role="alert" className="text-sm text-red-400 break-words">
          The project memory could not be read: {detail.error}
        </p>
      )}
      {detail && detail.ok && (
        <>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{detail.name}</h2>
            <p className="text-xs font-mono text-zinc-500 break-all">{root}</p>
          </div>
          <PhaseHistory entries={detail.history} />
        </>
      )}
    </section>
  );
};
