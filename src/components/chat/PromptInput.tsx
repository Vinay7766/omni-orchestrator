import React, { useState, KeyboardEvent } from "react";
import type { TrackType } from "../../lib/types";
import { TrackDropdown } from "./TrackDropdown";
import { ArrowRight, Sparkles, Loader2 } from "lucide-react";

interface PromptInputProps {
  currentTrack: TrackType;
  onTrackChange: (track: TrackType) => void;
  onSubmit: (prompt: string, track: TrackType) => void;
  isLoading?: boolean;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  currentTrack,
  onTrackChange,
  onSubmit,
  isLoading = false,
}) => {
  const [text, setText] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!text.trim() || isLoading) return;
    onSubmit(text.trim(), currentTrack);
    setText("");
  };

  const placeholders: Record<TrackType, string> = {
    "track-a":
      "Describe the product you want to build (e.g. 'Local markdown knowledge base with full-text search')...",
    "track-b":
      "Enter target company or product (e.g. 'Notion', 'Linear', 'Perplexity') for executive teardown & outreach...",
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-zinc-900 border border-zinc-800 rounded-xl p-3 shadow-xl transition-all focus-within:border-zinc-700">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholders[currentTrack]}
        rows={3}
        className="w-full bg-transparent text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none resize-none px-2 py-1 leading-relaxed font-sans"
        aria-label="Prompt Input"
      />

      <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2.5 mt-1 px-1">
        <div className="flex items-center gap-2">
          <TrackDropdown currentTrack={currentTrack} onTrackChange={onTrackChange} />
          <span className="text-[11px] text-zinc-500 hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 font-mono">↵ Enter</kbd> to submit
          </span>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!text.trim() || isLoading}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
            !text.trim() || isLoading
              ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-800"
              : currentTrack === "track-a"
              ? "bg-zinc-100 hover:bg-white text-zinc-950"
              : "bg-indigo-600 hover:bg-indigo-500 text-white"
          }`}
          aria-label="Submit Prompt"
        >
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Processing...</span>
            </span>
          ) : currentTrack === "track-a" ? (
            <>
              <span>Stage & Build</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Run Teardown</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
