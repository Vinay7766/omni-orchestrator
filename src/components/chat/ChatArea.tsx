import React from "react";
import type { ChatMessage, TrackType } from "../../lib/types";
import { ChatContainer } from "./ChatContainer";
import { PromptInput } from "./PromptInput";

interface ChatAreaProps {
  track: TrackType;
  /** Every conversation's messages; only this track's are shown. */
  messages: ChatMessage[];
  /** The track whose request is running, if any. */
  loading: TrackType | null;
  onSubmit: (prompt: string, track: TrackType) => void;
  onOpenStaging?: () => void;
  onOpenTeardown: () => void;
  /** Area-specific panel above the input (the tool to launch, or the provider in use). */
  aside?: React.ReactNode;
}

/** A one-track conversation: the idea brief area or the pitch teardown area. */
export const ChatArea: React.FC<ChatAreaProps> = ({ track, messages, loading, onSubmit, onOpenStaging, onOpenTeardown, aside }) => (
  <>
    <ChatContainer
      track={track}
      messages={messages.filter((m) => m.track === track)}
      onOpenStaging={onOpenStaging}
      onOpenTeardown={onOpenTeardown}
      onSelectPhaseAction={(action) => onSubmit(action, track)}
    />
    <div className="p-4 shrink-0 space-y-2 max-w-4xl mx-auto w-full">
      {aside}
      <PromptInput currentTrack={track} onSubmit={onSubmit} isLoading={loading === track} />
    </div>
  </>
);
