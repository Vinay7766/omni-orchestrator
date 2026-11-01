import React, { useState } from "react";
import type { Skill } from "../../lib/types";
import { CheckCircle2, ExternalLink, X, Save, Edit3, Eye } from "lucide-react";

interface SkillDetailModalProps {
  skill: Skill;
  onClose: () => void;
  onSave?: (skillId: string, updatedContent: string, updatedDescription: string) => Promise<void>;
  initialEditMode?: boolean;
}

export const SkillDetailModal: React.FC<SkillDetailModalProps> = ({
  skill,
  onClose,
  onSave,
  initialEditMode = false,
}) => {
  const [isEditing, setIsEditing] = useState(initialEditMode);
  const [content, setContent] = useState(skill.content);
  const [description, setDescription] = useState(skill.description);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(skill.id, content, description);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      setIsEditing(false);
    } catch {
      // Error handled
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-zinc-100">{skill.name}</h2>
              {skill.phaseScope && (
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {skill.phaseScope}
                </span>
              )}
              {skill.isCustom && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                  Custom / Modified
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400">
              <span>Author: <strong className="text-zinc-200">{skill.attribution.name}</strong></span>
              {skill.attribution.verified && (
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span className="text-zinc-600">•</span>
              <a
                href={skill.attribution.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
              >
                Source Repo <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors flex items-center gap-1.5"
            >
              {isEditing ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
              <span>{isEditing ? "View Markdown" : "Edit Skill"}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block mb-1.5">
                  Skill Description / Intent
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block mb-1.5">
                  Markdown Directives & Instructions (SKILL.md)
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={18}
                  className="w-full font-mono text-xs bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-zinc-200 focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 leading-relaxed">
                <span className="text-zinc-500 font-semibold block mb-0.5 uppercase tracking-wider text-[10px]">
                  Description
                </span>
                {skill.description}
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 overflow-x-auto">
                <pre className="font-mono text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">
                  {content}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {isEditing && (
          <div className="p-4 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              Modifications are saved locally to your OmniOrchestrator skill catalog.
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 shadow"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? "Saving..." : saveSuccess ? "Saved!" : "Save Modifications"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
