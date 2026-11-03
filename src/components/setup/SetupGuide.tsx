import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, CircleAlert, FolderOpen, Info, Loader2, RefreshCw, type LucideIcon } from "lucide-react";
import type { DiscoveredTool } from "../../lib/types";

/** What the guide can check on this computer (E9, NTU-4). */
export interface SetupChecks {
  gitVersion: () => Promise<string | null>;
  tools: () => Promise<{ ok: true; tools: DiscoveredTool[] } | { ok: false; error: string }>;
  projectFolders: () => Promise<string[]>;
  openFolder: (path: string) => Promise<void>;
}

type Status = { kind: "checking" | "done" | "missing" | "unchecked" | "error"; text: string };

const STYLE: Record<Status["kind"], { icon: LucideIcon; tone: string }> = {
  checking: { icon: Loader2, tone: "text-zinc-400" },
  done: { icon: CheckCircle2, tone: "text-emerald-400" },
  missing: { icon: Circle, tone: "text-amber-300" },
  unchecked: { icon: Info, tone: "text-zinc-400" },
  error: { icon: CircleAlert, tone: "text-red-400" },
};

const checking: Status = { kind: "checking", text: "Checking..." };
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Step({ title, status, children }: { title: string; status: Status; children: React.ReactNode }) {
  const { icon: Icon, tone } = STYLE[status.kind];
  return (
    <li aria-label={title} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <p className={`flex items-center gap-1.5 text-xs ${tone}`}>
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{status.text}</span>
      </p>
      <div className="text-xs text-zinc-400 space-y-2">{children}</div>
    </li>
  );
}

const Code = ({ children }: { children: string }) => (
  <pre className="rounded-md bg-zinc-950 border border-zinc-800 p-2 font-mono text-[11px] text-zinc-200 whitespace-pre-wrap break-all">{children}</pre>
);

const PUSH = [
  'cd "<your project folder>"',
  "git init",
  "git add .",
  'git commit -m "First version"',
  "git branch -M main",
  "git remote add origin https://github.com/<your-name>/<repository>.git",
  "git push -u origin main",
].join("\n");

/** A setup guide for non-technical users: each step explained, and checked where it can be (NTU-4). */
export const SetupGuide: React.FC<{ checks: SetupChecks; onGoToProjects: () => void }> = ({ checks, onGoToProjects }) => {
  const [git, setGit] = useState<Status>(checking);
  const [tools, setTools] = useState<Status>(checking);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderStatus, setFolderStatus] = useState<Status>(checking);
  const [openProblem, setOpenProblem] = useState<string | null>(null);

  const run = useCallback(async () => {
    setGit(checking);
    setTools(checking);
    setFolderStatus(checking);
    const [g, t, f] = await Promise.allSettled([checks.gitVersion(), checks.tools(), checks.projectFolders()]);
    setGit(
      g.status === "rejected" ? { kind: "error", text: `Could not check: ${reason(g.reason)}` }
      : g.value ? { kind: "done", text: `Done: Git ${g.value} is installed` }
      : { kind: "missing", text: "Not yet: Git was not found" },
    );
    if (t.status === "rejected") setTools({ kind: "error", text: `Could not check: ${reason(t.reason)}` });
    else if (!t.value.ok) setTools({ kind: "error", text: `Could not check: ${t.value.error}` });
    else if (t.value.tools.length === 0) setTools({ kind: "missing", text: "Not yet: no AI tool was found" });
    else setTools({ kind: "done", text: `Done: found ${t.value.tools.map((x) => x.name).join(", ")}` });
    if (f.status === "rejected") {
      setFolders([]);
      setFolderStatus({ kind: "error", text: `Could not check: ${reason(f.reason)}` });
    } else {
      setFolders(f.value);
      setFolderStatus(f.value.length ? { kind: "done", text: `Done: ${f.value.length} project folder${f.value.length > 1 ? "s" : ""}` } : { kind: "missing", text: "Not yet: no project folder" });
    }
  }, [checks]);

  useEffect(() => {
    void run();
  }, [run]);

  const open = async (path: string) => {
    setOpenProblem(null);
    await checks.openFolder(path).catch((e) => setOpenProblem(reason(e)));
  };

  return (
    <section className="w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-4" aria-labelledby="setup-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="setup-heading" className="text-base font-semibold text-zinc-100">Setup guide</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Everything you need before your first project. Steps on other websites are explained here; only you can do them.</p>
        </div>
        <button type="button" onClick={() => void run()} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-200 hover:border-zinc-500">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Check again
        </button>
      </div>
      <ol aria-label="Setup steps" className="space-y-3">
        <Step title="Install an AI coding tool" status={tools}>
          <p>Install at least one: an editor with AI built in, an AI extension in your editor, or an AI agent you run in a terminal. Any of them works; OmniOrchestrator finds them by what they are, not from a fixed list.</p>
          <p>After installing, press Check again.</p>
        </Step>
        <Step title="Install Git" status={git}>
          <p>Git keeps the history of your project and sends it to GitHub. Download it from git-scm.com (type that address in your browser), run the installer and keep the default choices.</p>
        </Step>
        <Step title="Choose where your projects live" status={folderStatus}>
          <p>Your projects are ordinary folders on this computer. OmniOrchestrator looks for projects in the folders you add under Projects.</p>
          {folders.length > 0 ? (
            <ul className="space-y-1">
              {folders.map((f) => (
                <li key={f}>
                  <button type="button" onClick={() => void open(f)} aria-label={`Open ${f}`} className="flex items-center gap-1.5 text-zinc-200 hover:text-zinc-100">
                    <FolderOpen className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                    <span className="font-mono break-all">{f}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button type="button" onClick={onGoToProjects} className="px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-200 hover:border-zinc-500">
              Add a folder in Projects
            </button>
          )}
          {openProblem && <p role="alert" className="text-red-400 break-words">The folder could not be opened: {openProblem}</p>}
        </Step>
        <Step title="Create a GitHub account" status={{ kind: "unchecked", text: "Not checked: this happens on github.com" }}>
          <p>GitHub stores a copy of your project online. Go to github.com/signup in your browser and follow the steps there. It is free for personal projects.</p>
        </Step>
        <Step title="Put a project on GitHub (first push)" status={{ kind: "unchecked", text: "Not checked: this happens on github.com and in a terminal" }}>
          <p>1. On github.com/new, create an empty repository (do not add a README there).</p>
          <p>2. Open a terminal in your project folder and run these lines one by one, using your own names:</p>
          <Code>{PUSH}</Code>
          <p>The first push opens a browser window to sign in to GitHub. OmniOrchestrator&apos;s own memory files are kept out of Git when you hand a project to a tool.</p>
        </Step>
        <Step title="Open OmniOrchestrator" status={{ kind: "done", text: "Done: it is running now" }}>
          <p>To come back later, open it the same way you opened it today. Your projects and settings stay on this computer.</p>
        </Step>
      </ol>
    </section>
  );
};
