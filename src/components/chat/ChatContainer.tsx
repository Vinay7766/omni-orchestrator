import React from "react";
import type { ChatMessage, TrackType } from "../../lib/types";
import { Compass, Layers, CheckCircle, FileText } from "lucide-react";

/** What each area does, shown before its first message. */
const EMPTY_TEXT: Record<TrackType, string> = {
  "track-a": "Describe the product you want to build. You get a project brief, then choose the folder, tool and skills before anything is launched.",
  "track-b": "Name a company or product to get a teardown and outreach drafts from your own model (set it up in Settings).",
};

interface ChatContainerProps {
  /** Which area this conversation belongs to. */
  track: TrackType;
  messages: ChatMessage[];
  onOpenStaging?: (prompt: string) => void;
  onOpenTeardown?: (productName: string) => void;
  onSelectPhaseAction?: (actionText: string) => void;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  track,
  messages,
  onOpenStaging,
  onOpenTeardown,
  onSelectPhaseAction,
}) => {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl mx-auto w-full">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center h-[45vh] max-w-lg mx-auto space-y-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            {track === "track-a" ? <Layers className="w-5 h-5 text-zinc-300" aria-hidden="true" /> : <Compass className="w-5 h-5 text-zinc-300" aria-hidden="true" />}
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">{EMPTY_TEXT[track]}</p>
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
