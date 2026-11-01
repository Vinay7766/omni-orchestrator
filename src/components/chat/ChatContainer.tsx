import React from "react";
import type { ChatMessage } from "../../lib/types";
import { Terminal, Compass, Layers, CheckCircle, FileText } from "lucide-react";

interface ChatContainerProps {
  messages: ChatMessage[];
  onOpenStaging?: (prompt: string) => void;
  onOpenTeardown?: (productName: string) => void;
  onSelectPhaseAction?: (actionText: string) => void;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  onOpenStaging,
  onOpenTeardown,
  onSelectPhaseAction,
}) => {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl mx-auto w-full">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center h-[55vh] max-w-lg mx-auto space-y-4">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 shadow-sm">
            <Terminal className="w-5 h-5 text-zinc-300" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-100 tracking-tight">
              OmniOrchestrator
            </h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Open-source desktop engine automating high-discipline agentic software engineering and strategic product teardowns.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 w-full pt-2">
            <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-left">
              <span className="text-[11px] font-semibold text-zinc-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-zinc-400" /> Track A
              </span>
              <p className="text-xs text-zinc-300 font-medium mt-1.5">Autonomous Builder</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Tiered skills, PRD & 1-click IDE launch</p>
            </div>
            <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-left">
              <span className="text-[11px] font-semibold text-zinc-200 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-zinc-400" /> Track B
              </span>
              <p className="text-xs text-zinc-300 font-medium mt-1.5">Strategic Flywheel</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">In-app teardowns & cold outreach</p>
            </div>
          </div>
        </div>
      ) : (
        messages.map((msg) => {
          const isUser = msg.sender === "user";
          const isTrackA = msg.track === "track-a";

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1.5`}
            >
              <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {isUser ? "You" : "Orchestrator"}
                </span>
                <span className="text-[9px] px-2 py-0.5 rounded font-mono font-medium bg-zinc-900 text-zinc-400 border border-zinc-800">
                  {isTrackA ? "Track A" : "Track B"}
                </span>
                <span className="text-[10px] text-zinc-600 font-mono">{msg.timestamp}</span>
              </div>

              <div
                className={`max-w-2xl rounded-xl p-4 text-xs leading-relaxed ${
                  isUser
                    ? "bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-sm"
                    : "bg-zinc-900 text-zinc-200 border border-zinc-800 shadow-sm"
                }`}
              >
                <div className="whitespace-pre-wrap font-sans">{msg.content}</div>

                {/* Track A Launch Staging Trigger */}
                {!isUser && !msg.isError && isTrackA && onOpenStaging && (
                  <div className="mt-3.5 pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400">
                      Configure destination folder, tools & skills:
                    </span>
                    <button
                      onClick={() => onOpenStaging(msg.content)}
                      className="px-3 py-1.5 bg-zinc-100 hover:bg-white text-zinc-950 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Configure & Stage Run</span>
                    </button>
                  </div>
                )}

                {/* Track B Viewer Trigger */}
                {!isUser && !msg.isError && !isTrackA && onOpenTeardown && (
                  <div className="mt-3.5 pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400">
                      System teardown & pitch sequence ready:
                    </span>
                    <button
                      onClick={() => onOpenTeardown(msg.content)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Open Teardown Report</span>
                    </button>
                  </div>
                )}

                {/* Interactive Phase Review & Adjustment Gate (IPRAG) */}
                {!isUser && isTrackA && msg.content.includes("Phase Review") && onSelectPhaseAction && (
                  <div className="mt-3.5 pt-3 border-t border-zinc-800 space-y-2">
                    <span className="text-[11px] font-semibold text-amber-400 block">
                      Phase Review & Adjustment Checkpoint:
                    </span>
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <button
                        onClick={() => onSelectPhaseAction("Confirmed: Looks good, proceed to next phase.")}
                        className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 border border-emerald-500/30 text-emerald-300 rounded transition-colors flex items-center gap-1"
                      >
                        <CheckCircle className="w-3 h-3" />
                        <span>Confirm: Proceed to Next Phase</span>
                      </button>
                      <button
                        onClick={() => onSelectPhaseAction("I have adjustments to suggest for this phase.")}
                        className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded transition-colors"
                      >
                        Suggest Modifications
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
