import React, { useState } from "react";
import type { TeardownResponse } from "../../lib/types";
import { Copy, Check, Download, X, FileText, Send, Sparkles, Edit3, Eye } from "lucide-react";

interface TeardownViewerProps {
  teardown: TeardownResponse;
  onClose?: () => void;
  /**
   * Saves through the system's save dialog (retest bug 4): resolves with the path chosen, or null
   * when the person cancels. Without it, the file is downloaded by the browser instead.
   */
  onExport?: (fileName: string, content: string) => Promise<string | null>;
}

export const TeardownViewer: React.FC<TeardownViewerProps> = ({
  teardown,
  onClose,
  onExport,
}) => {
  const [activeTab, setActiveTab] = useState<"report" | "outreach">("report");
  const [isEditing, setIsEditing] = useState(false);
  const [reportContent, setReportContent] = useState(teardown.markdownReport);
  const [outreachContent, setOutreachContent] = useState(teardown.coldOutreachSequence);
  const [copied, setCopied] = useState(false);

  const handleCopyOutreach = async () => {
    try {
      await navigator.clipboard.writeText(outreachContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const [exported, setExported] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleDownloadMarkdown = async () => {
    const content = reportContent + "\n\n---\n\n## Executive Cold Outreach\n\n" + outreachContent;
    const name = `${teardown.targetName.toLowerCase()}-strategic-teardown.md`;
    if (onExport) {
      setExportError(null);
      try {
        const saved = await onExport(name, content);
        setExported(saved ? `Saved to ${saved}` : "Not saved: the save dialog was closed.");
      } catch (e) {
        setExported(null);
        setExportError(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    // Freed a moment later: freeing it at once can cancel the save in some web views (issue D).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(`Download started: ${name} (look in your downloads folder).`);
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-zinc-100 max-w-4xl mx-auto my-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              Track B • Strategic Teardown
            </span>
            <h2 className="text-base font-bold text-white">
              Executive Teardown: {teardown.targetName}
            </h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            System analysis, growth loops, and cold outreach kit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {isEditing ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
            <span>{isEditing ? "View" : "Edit"}</span>
          </button>

          <button
            onClick={() => void handleDownloadMarkdown()}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 rounded-lg transition-colors flex items-center gap-1.5"
            aria-label="Download Markdown"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Markdown</span>
          </button>
          {exported && (
            <span role="status" className="text-xs text-emerald-400 break-all">
              {exported}
            </span>
          )}
          {exportError && (
            <span role="alert" className="text-xs text-red-400 break-words">
              {exportError}
            </span>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
              aria-label="Close Teardown Viewer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Attributions Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-zinc-400 font-medium text-[11px]">Framework Attributions:</span>
        <div className="flex flex-wrap gap-1.5">
          {teardown.authorAttributions.map((auth, idx) => (
            <span
              key={idx}
              className="bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-0.5 rounded text-[11px] font-mono"
            >
              {auth}
            </span>
          ))}
        </div>
      </div>

      {/* Levers Badges */}
      {teardown.strategicGrowthLevers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mr-1">
            Growth Levers:
          </span>
          {teardown.strategicGrowthLevers.map((lever, idx) => (
            <span
              key={idx}
              className="px-2.5 py-0.5 bg-zinc-900 text-zinc-300 border border-zinc-800 rounded text-xs font-medium flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>{lever}</span>
            </span>
          ))}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex border-b border-zinc-800 gap-4">
        <button
          onClick={() => setActiveTab("report")}
          className={`pb-2.5 text-xs font-semibold transition-all relative flex items-center gap-1.5 ${
            activeTab === "report"
              ? "text-zinc-100 border-b-2 border-indigo-500"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>System Teardown Report</span>
        </button>
        <button
          onClick={() => setActiveTab("outreach")}
          className={`pb-2.5 text-xs font-semibold transition-all relative flex items-center gap-1.5 ${
            activeTab === "outreach"
              ? "text-zinc-100 border-b-2 border-indigo-500"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Cold Outreach Pitch Sequence</span>
        </button>
      </div>

      {/* Content Section */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 overflow-y-auto max-h-[500px]">
        {activeTab === "report" ? (
          isEditing ? (
            <textarea
              value={reportContent}
              onChange={(e) => setReportContent(e.target.value)}
              rows={16}
              className="w-full bg-zinc-950 font-mono text-xs text-zinc-200 p-4 rounded-lg border border-zinc-800 focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
            />
          ) : (
            <pre className="font-mono text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">
              {reportContent}
            </pre>
          )
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-zinc-950 p-3 rounded-lg border border-zinc-800">
              <span className="text-xs text-zinc-400">
                Outreach sequence prepared for leadership pitch.
              </span>
              <button
                onClick={handleCopyOutreach}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition-colors flex items-center gap-1.5 shadow"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied to Clipboard" : "Copy Sequence"}</span>
              </button>
            </div>
            {isEditing ? (
              <textarea
                value={outreachContent}
                onChange={(e) => setOutreachContent(e.target.value)}
                rows={12}
                className="w-full bg-zinc-950 font-mono text-xs text-zinc-200 p-4 rounded-lg border border-zinc-800 focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
              />
            ) : (
              <pre className="text-xs font-mono bg-zinc-950 p-4 rounded-lg border border-zinc-800 text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {outreachContent}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
