import React, { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Workflow, WorkflowNode } from "@omni/core";
import { NodeEvents, nodeName, nodeStatusWords, statusStyle } from "./WorkflowDetails";

interface Column {
  phase: WorkflowNode;
  gate?: WorkflowNode;
  tasks: WorkflowNode[];
}

/** Phases in flow order, each with its gate and the tasks linked under it; plus tasks no phase links to. */
function layout(workflow: Workflow) {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const linked = new Set<string>();
  const columns: Column[] = workflow.nodes
    .filter((n) => n.kind === "phase")
    .map((phase) => {
      const tasks = workflow.edges
        .filter((e) => e.from === phase.id)
        .map((e) => byId.get(e.to))
        .filter((n): n is WorkflowNode => n?.kind === "task");
      tasks.forEach((t) => linked.add(t.id));
      const gate = workflow.edges.map((e) => (e.from === phase.id ? byId.get(e.to) : undefined)).find((n) => n?.kind === "gate");
      return { phase, gate, tasks };
    });
  const loose = workflow.nodes.filter((n) => n.kind === "task" && !linked.has(n.id));
  return { byId, columns, loose };
}

const SHAPE = { phase: "rounded-md", gate: "rounded-full", task: "rounded" } as const;

function NodeButton({ node, selected, onSelect }: { node: WorkflowNode; selected: boolean; onSelect: (id: string) => void }) {
  const { icon: Icon, tone } = statusStyle(node.status);
  return (
    <button
      type="button"
      aria-label={nodeName(node)}
      aria-pressed={selected}
      onClick={() => onSelect(node.id)}
      className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs text-left ${SHAPE[node.kind]} ${
        selected ? "border-indigo-500 bg-indigo-600/15" : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
      } focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500`}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="text-zinc-100">{node.label}</span>
      <span className={tone}>{nodeStatusWords(node)}</span>
      {node.kind === "phase" && node.isNext && <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300">Next</span>}
    </button>
  );
}

const Arrow = () => <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-600" aria-hidden="true" />;

function ListItem({ node, children }: { node: WorkflowNode; children?: React.ReactNode }) {
  return (
    <li className="space-y-1">
      <p className="text-sm text-zinc-100">{nodeName(node)}</p>
      <div className="ml-4">
        <NodeEvents node={node} />
      </div>
      {children}
    </li>
  );
}

/** The project's workflow as connected nodes coloured by status, with each node's details and an
 * equivalent list for keyboard and screen-reader use (E8, VIS-1..3). Live through the page's reloads. */
export const WorkflowChart: React.FC<{ workflow: Workflow }> = ({ workflow }) => {
  const [view, setView] = useState<"chart" | "list">("chart");
  const [selected, setSelected] = useState<string | null>(null);
  const { byId, columns, loose } = useMemo(() => layout(workflow), [workflow]);
  const current = selected ? byId.get(selected) : undefined;
  const toggle = (v: "chart" | "list", label: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => setView(v)}
      className={`px-2 py-1 text-xs rounded ${view === v ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100"}`}
    >
      {label}
    </button>
  );

  return (
    <section aria-labelledby="workflow-heading" className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 id="workflow-heading" className="text-sm font-semibold text-zinc-100">
          Workflow
        </h3>
        <div className="flex gap-1" aria-label="Show the workflow as" role="group">
          {toggle("chart", "Chart")}
          {toggle("list", "List")}
        </div>
      </div>

      {view === "chart" ? (
        <>
          <div role="group" aria-label="Workflow chart" className="overflow-x-auto pb-1">
            <div className="flex items-start gap-1 min-w-max">
              {[...columns.map((c) => ({ ...c, key: c.phase.id })), ...(loose.length ? [{ key: "loose", phase: undefined, gate: undefined, tasks: loose }] : [])].map((c, i) => (
                <div key={c.key} className="flex flex-col gap-2">
                  <div className="flex items-center gap-1">
                    {i > 0 && c.phase && <Arrow />}
                    {c.phase && <NodeButton node={c.phase} selected={selected === c.phase.id} onSelect={setSelected} />}
                    {c.gate && <Arrow />}
                    {c.gate && <NodeButton node={c.gate} selected={selected === c.gate.id} onSelect={setSelected} />}
                  </div>
                  {c.tasks.length > 0 && (
                    <div className={`flex flex-col gap-1 border-l border-zinc-700 pl-2 ${c.phase ? "ml-6" : "ml-1"}`}>
                      {c.tasks.map((t) => (
                        <NodeButton key={t.id} node={t} selected={selected === t.id} onSelect={setSelected} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {current ? (
            <section aria-label={`Details: ${current.label}`} className="rounded-lg border border-zinc-800 p-3 space-y-2">
              <h4 className="text-xs font-semibold text-zinc-200">{nodeName(current)}</h4>
              <NodeEvents node={current} />
            </section>
          ) : (
            <p className="text-xs text-zinc-500">Select a phase, gate or task to see what memory records for it.</p>
          )}
        </>
      ) : (
        <ol aria-label="Workflow as a list" className="space-y-3">
          {columns.map((c) => (
            <ListItem key={c.phase.id} node={c.phase}>
              {(c.gate || c.tasks.length > 0) && (
                <ol className="ml-4 space-y-2">
                  {c.tasks.map((t) => (
                    <ListItem key={t.id} node={t} />
                  ))}
                  {c.gate && <ListItem node={c.gate} />}
                </ol>
              )}
            </ListItem>
          ))}
          {loose.map((t) => (
            <ListItem key={t.id} node={t} />
          ))}
        </ol>
      )}
    </section>
  );
};
