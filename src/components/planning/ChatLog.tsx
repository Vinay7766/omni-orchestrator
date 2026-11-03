import React, { useEffect, useRef } from "react";
import { Sparkles, User } from "lucide-react";
import type { ChatMessage } from "../../lib/idea-chat";

/**
 * A conversation between the person and their AI (C), as message bubbles. Model text is shown as
 * plain text only. New messages are announced to screen readers (role="log").
 */
export const ChatLog: React.FC<{ label: string; messages: ChatMessage[]; thinking: boolean; className?: string }> = ({ label, messages, thinking, className = "" }) => {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages.length, thinking]);

  return (
    <div role="log" aria-label={label} aria-live="polite" className={`rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 sm:p-4 space-y-4 overflow-y-auto ${className}`}>
      {messages.map((m, i) => (
        <div key={i} className={`flex gap-2.5 ${m.role === "person" ? "flex-row-reverse" : ""}`}>
          <span
            aria-hidden="true"
            className={`mt-0.5 shrink-0 w-7 h-7 rounded-full grid place-items-center ${m.role === "person" ? "bg-zinc-800 text-zinc-300" : "bg-indigo-600/20 text-indigo-300 ring-1 ring-indigo-500/30"}`}
          >
            {m.role === "person" ? <User className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
          </span>
          <div
            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
              m.role === "person" ? "bg-indigo-600 text-white rounded-tr-md" : "bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-md"
            }`}
          >
            <span className="sr-only">{m.role === "person" ? "You: " : "AI: "}</span>
            {m.text}
          </div>
        </div>
      ))}
      {thinking && (
        <div className="flex gap-2.5" aria-label="The AI is thinking">
          <span aria-hidden="true" className="mt-0.5 shrink-0 w-7 h-7 rounded-full grid place-items-center bg-indigo-600/20 text-indigo-300 ring-1 ring-indigo-500/30">
            <Sparkles className="w-3.5 h-3.5" />
          </span>
          <div className="rounded-2xl rounded-tl-md bg-zinc-900 border border-zinc-800 px-3.5 py-3 flex gap-1" aria-hidden="true">
            {[0, 150, 300].map((d) => (
              <span key={d} className="w-1.5 h-1.5 rounded-full bg-zinc-500 motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
};
