import React from "react";
import { PhaseBadges } from "./PhaseBadges";
import type { Skill } from "../../lib/types";
import { CheckCircle2, ExternalLink, Eye, Edit3 } from "lucide-react";

interface SkillCardProps {
  skill: Skill;
  onToggle: (id: string, enabled: boolean) => void;
  onView?: (skill: Skill) => void;
  onEdit?: (skill: Skill) => void;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  onToggle,
  onView,
  onEdit,
}) => {
  return (
    <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700/80 rounded-xl p-4 transition-all shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-zinc-100 tracking-tight">
                {skill.name}
              </h3>
              <PhaseBadges phases={skill.phases} />
            </div>
            <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
              {skill.description}
            </p>
          </div>

          {/* Toggle Switch */}
          <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={skill.enabled}
              onChange={(e) => onToggle(skill.id, e.target.checked)}
              className="sr-only peer"
              aria-label={`Toggle ${skill.name}`}
            />
            <div className="w-8 h-4 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-300 after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>
      </div>

      {/* Footer Actions & Attribution */}
      <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
        <div className="flex items-center gap-1.5 truncate max-w-[240px]">
          <span className="text-zinc-500 text-[11px]">By:</span>
          <span className="font-medium text-zinc-300 truncate text-[11px]">
            {skill.attribution.name}
          </span>
          {skill.attribution.verified && (
            <span title="Verified Creator" className="inline-flex shrink-0">
              <CheckCircle2
                className="w-3.5 h-3.5 text-blue-400"
                data-testid="verified-badge"
              />
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onView && (
            <button
              onClick={() => onView(skill)}
              className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded transition-colors flex items-center gap-1"
              aria-label={`View ${skill.name}`}
            >
              <Eye className="w-3 h-3" />
              <span>View</span>
            </button>
          )}

          {onEdit && (
            <button
              onClick={() => onEdit(skill)}
              className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded transition-colors flex items-center gap-1"
              aria-label={`Edit ${skill.name}`}
            >
              <Edit3 className="w-3 h-3" />
              <span>Edit</span>
            </button>
          )}

          <a
            href={skill.attribution.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
            title="View Source Repository"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
