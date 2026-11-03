import React from "react";
import { FolderOpen, Lightbulb, ListChecks, Presentation, Sliders, Settings, type LucideIcon } from "lucide-react";

export type Area = "projects" | "idea" | "pitch" | "skills" | "setup" | "settings";

/** The dashboard's areas, in the order they are listed. Projects is home (APP-1). */
const AREAS: { id: Area; label: string; icon: LucideIcon }[] = [
  { id: "projects", label: "Projects", icon: FolderOpen },
  { id: "idea", label: "Start from an idea", icon: Lightbulb },
  { id: "pitch", label: "Pitch mode", icon: Presentation },
  { id: "skills", label: "Skills", icon: Sliders },
  { id: "setup", label: "Setup guide", icon: ListChecks },
  { id: "settings", label: "Settings", icon: Settings },
];

/** Side navigation between areas; the open one is marked for screen readers too. */
export const AreaNav: React.FC<{ current: Area; onChange: (area: Area) => void }> = ({ current, onChange }) => (
  <nav aria-label="Areas" className="w-14 md:w-52 shrink-0 border-r border-zinc-800 bg-zinc-950 p-2">
    <ul className="space-y-1">
      {AREAS.map(({ id, label, icon: Icon }) => {
        const active = id === current;
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onChange(id)}
              aria-current={active ? "page" : undefined}
              title={label}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="sr-only md:not-sr-only">{label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  </nav>
);
