import React, { useState, useRef, useEffect } from "react";
import type { TrackType } from "../../lib/types";
import { ChevronDown, Layers, Compass } from "lucide-react";

interface TrackDropdownProps {
  currentTrack: TrackType;
  onTrackChange: (track: TrackType) => void;
}

export const TrackDropdown: React.FC<TrackDropdownProps> = ({
  currentTrack,
  onTrackChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const tracks: { id: TrackType; label: string; badge: string; desc: string; icon: typeof Layers }[] = [
    {
      id: "track-a",
      label: "Track A",
      badge: "Autonomous Builder",
      desc: "Ideate, stage tiered skills, generate PRD/TDD specs & launch IDE",
      icon: Layers,
    },
    {
      id: "track-b",
      label: "Track B",
      badge: "Strategic Flywheel",
      desc: "Instant executive teardowns, ICP analysis & cold outreach pitch",
      icon: Compass,
    },
  ];

  const activeTrackObj = tracks.find((t) => t.id === currentTrack) || tracks[0];
  const IconComponent = activeTrackObj.icon;

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800/90 hover:bg-zinc-700/90 border border-zinc-700 text-zinc-200 transition-all shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-500"
        aria-label="Select Execution Track"
      >
        <IconComponent className="w-3.5 h-3.5 text-zinc-400" />
        <span>{activeTrackObj.label}: {activeTrackObj.badge}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 bottom-full mb-2 w-72 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl p-1.5 z-50">
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800 mb-1">
            Execution Track Engine
          </div>
          {tracks.map((track) => {
            const TrackIcon = track.icon;
            const isSelected = currentTrack === track.id;

            return (
              <button
                key={track.id}
                onClick={() => {
                  onTrackChange(track.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left p-2.5 rounded-lg text-xs transition-colors flex flex-col gap-0.5 ${
                  isSelected
                    ? "bg-zinc-800 text-white font-medium"
                    : "text-zinc-300 hover:bg-zinc-800/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-100 flex items-center gap-1.5">
                    <TrackIcon className="w-3.5 h-3.5 text-zinc-400" />
                    {track.label} • {track.badge}
                  </span>
                  {isSelected && (
                    <span className="text-[10px] text-emerald-400 font-mono">ACTIVE</span>
                  )}
                </div>
                <span className="text-[11px] text-zinc-400 pl-5 leading-snug">
                  {track.desc}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
