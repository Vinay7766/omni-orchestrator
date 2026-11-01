import React, { useState } from "react";
import { Skill, ToolId, InstalledTool } from "../../lib/types";
import { Folder, Layers, Search, Check, RefreshCw, X } from "lucide-react";

interface PreLaunchStagingModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  projectPath: string;
  detectedTools: InstalledTool[];
  initialSkills: Skill[];
  onLaunch: (selectedTool: ToolId, skills: Skill[], finalProjectPath: string) => Promise<void>;
}

export const PreLaunchStagingModal: React.FC<PreLaunchStagingModalProps> = ({
  isOpen,
  onClose,
  projectName,
  projectPath: defaultProjectPath,
  detectedTools,
  initialSkills,
  onLaunch,
}) => {
  const [customPath, setCustomPath] = useState(defaultProjectPath);
  const [selectedToolId, setSelectedToolId] = useState<ToolId>(
    detectedTools.find((t) => t.installed)?.id || "cursor"
  );
  const [activeSkills, setActiveSkills] = useState<Skill[]>(initialSkills);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);

  if (!isOpen) return null;

  const handleToggleSkill = (skillId: string) => {
    setActiveSkills((prev) =>
      prev.map((s) => (s.id === skillId ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const categories = ["all", "architecture", "testing", "security", "engineering", "strategy", "marketing"];

  const filteredSkills = activeSkills.filter((s) => {
    const matchesCat = selectedCategory === "all" || s.category.toLowerCase() === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const handleLaunchClick = async () => {
    setIsLaunching(true);
    try {
      await onLaunch(selectedToolId, activeSkills, customPath);
      setLaunchSuccess(true);
    } catch {
      // Handled
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
              Track A • Pre-Launch Staging
            </span>
            <h2 className="text-base font-bold text-zinc-100 mt-0.5">
              Target Environment & Staged Execution: {projectName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Dynamic Destination Directory */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-zinc-400" />
              <span>Project Destination Folder (Editable for any path)</span>
            </label>
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="e.g. C:\Users\Username\Projects\MyNewApp or /home/user/code/my-app"
              className="w-full font-mono text-xs bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-indigo-500"
            />
            <span className="text-[11px] text-zinc-500 block">
              Tiered rules and session state will be dynamically created inside this target directory.
            </span>
          </div>

          {/* Target IDE Scanner */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              Target Execution IDE
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {detectedTools.map((tool) => {
                const isSelected = selectedToolId === tool.id;

                return (
                  <button
                    key={tool.id}
                    onClick={() => setSelectedToolId(tool.id)}
                    className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                      isSelected
                        ? "bg-zinc-800 border-zinc-500 shadow-sm"
                        : "bg-zinc-900/60 border-zinc-800 opacity-70 hover:opacity-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-100">
                        {tool.name}
                      </span>
                      {tool.installed && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-400 mt-2 font-mono truncate">
                      {tool.installed ? "Detected" : "Manual path"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Equipped Skills Filter & List */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <div>
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                  Active Engineering Skills ({activeSkills.filter((s) => s.enabled).length}/{activeSkills.length})
                </label>
                <span className="text-[11px] text-zinc-500">
                  Micro-rules scoped strictly to prevent token context overhead.
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search skills..."
                    className="bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider transition-colors ${
                    selectedCategory === cat
                      ? "bg-zinc-800 text-white border border-zinc-700"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Skills Scroll List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {filteredSkills.map((skill) => (
                <div
                  key={skill.id}
                  className={`p-2.5 rounded-xl border flex items-center justify-between transition-colors ${
                    skill.enabled
                      ? "bg-zinc-900 border-zinc-700/80"
                      : "bg-zinc-900/30 border-zinc-800/60 opacity-60"
                  }`}
                >
                  <div className="truncate pr-2">
                    <span className="text-xs font-medium text-zinc-200 block truncate">
                      {skill.name}
                    </span>
                    <span className="text-[10px] text-zinc-500 truncate block">
                      By {skill.attribution.name}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={() => handleToggleSkill(skill.id)}
                    className="rounded bg-zinc-800 border-zinc-700 text-emerald-500 focus:ring-0 shrink-0 cursor-pointer"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <div className="text-xs text-zinc-400">
            Destination: <code className="text-zinc-300 font-mono text-[11px]">{customPath}</code>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleLaunchClick}
              disabled={isLaunching}
              data-testid="launch-and-build-btn"
              className="px-5 py-2 text-xs font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition-colors flex items-center gap-2 shadow"
            >
              {isLaunching ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Staging Workspace...</span>
                </>
              ) : launchSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Launched!</span>
                </>
              ) : (
                <>
                  <Layers className="w-3.5 h-3.5" />
                  <span>Stage & Launch Workspace</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};
