import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DiscoveredSkill, ResearchQuery } from "../../lib/types";
import { Search, Plus, Check, ExternalLink, Star, RefreshCw, SlidersHorizontal, Eye, X } from "lucide-react";

interface GlobalResearchHubProps {
  onImportToLibrary: (skill: DiscoveredSkill) => void;
  initialDomain?: string;
  isStagingMode?: boolean;
}

export const DOMAIN_CATEGORIES = [
  "All", "DevOps", "Security", "Frontend", "Marketing", "Architecture", "AI Agents", "Mobile",
];

export const GlobalResearchHub: React.FC<GlobalResearchHubProps> = ({
  onImportToLibrary,
  initialDomain = "All",
  isStagingMode = false,
}) => {
  const [selectedDomain, setSelectedDomain] = useState<string>(initialDomain);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [results, setResults] = useState<DiscoveredSkill[]>([]);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [previewSkill, setPreviewSkill] = useState<DiscoveredSkill | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Auto-start research when component mounts
  useEffect(() => {
    runSearch();
  }, []);

  const runSearch = async (domainOverride?: string) => {
    setIsLoading(true);
    setHasSearched(true);
    try {
      const activeDomain = domainOverride !== undefined ? domainOverride : selectedDomain;
      const query: ResearchQuery = {
        keyword: searchQuery,
        domainOrCategory: activeDomain === "All" ? undefined : activeDomain,
      };
      const found = await invoke<DiscoveredSkill[]>("search_research_skills", { query });
      setResults(found);
    } catch (err) {
      console.error("Research search failed:", err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDomainChange = (domain: string) => {
    setSelectedDomain(domain);
    runSearch(domain);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") runSearch();
  };

  const handleImport = (skill: DiscoveredSkill) => {
    onImportToLibrary(skill);
    setImportedIds((prev) => new Set(prev).add(skill.id));
  };

  return (
    <div className="space-y-4" data-testid="global-research-hub">
      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter keywords or domain (e.g. DevOps, Security, Next.js, Flutter)..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
            data-testid="research-search-input"
          />
        </div>
        <button
          onClick={() => runSearch()}
          disabled={isLoading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>{isLoading ? "Scanning..." : "Search"}</span>
        </button>
      </div>

      {/* Domain Filter Chips */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="domain-filter-chips">
        <span className="text-[11px] text-zinc-500 mr-1 flex items-center gap-1">
          <SlidersHorizontal className="w-3 h-3" />
          <span>Filter:</span>
        </span>
        {DOMAIN_CATEGORIES.map((domain) => (
          <button
            key={domain}
            onClick={() => handleDomainChange(domain)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              selectedDomain === domain
                ? "bg-zinc-800 text-white border border-zinc-700"
                : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800"
            }`}
          >
            {domain}
          </button>
        ))}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500 text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Scanning for skills...</span>
        </div>
      ) : !hasSearched ? (
        <div className="text-center py-12 text-zinc-500 text-sm">
          Enter a keyword or select a domain above to discover skills.
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-12 text-zinc-500 text-sm">
          No results found. Try a different keyword or domain.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[460px] overflow-y-auto pr-1">
          {results.map((skill) => {
            const isImported = importedIds.has(skill.id);
            return (
              <div
                key={skill.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition-all"
                data-testid={`research-card-${skill.id}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                      {skill.domain}
                    </span>
                    {skill.starsOrUpvotes && (
                      <span className="text-xs text-amber-400 flex items-center gap-1 font-mono">
                        <Star className="w-3 h-3 fill-amber-400" />
                        {skill.starsOrUpvotes.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-zinc-100 mt-2 tracking-tight">{skill.name}</h4>
                  <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">{skill.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs">
                  <a
                    href={skill.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-500 hover:text-zinc-300 flex items-center gap-1 text-[11px] truncate max-w-[140px]"
                  >
                    <span>{skill.author}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPreviewSkill(skill)}
                      className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
                      title="Preview skill"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleImport(skill)}
                      disabled={isImported}
                      className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors ${
                        isImported
                          ? "bg-zinc-800 text-zinc-400 border border-zinc-700 cursor-default"
                          : "bg-emerald-600 hover:bg-emerald-500 text-white"
                      }`}
                      data-testid={`import-btn-${skill.id}`}
                    >
                      {isImported ? (
                        <><Check className="w-3 h-3 text-emerald-400" /><span>Added</span></>
                      ) : (
                        <><Plus className="w-3 h-3" /><span>{isStagingMode ? "Add to Run" : "Add to Library"}</span></>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {previewSkill && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">{previewSkill.name}</h3>
                <p className="text-xs text-zinc-400">By {previewSkill.author} • {previewSkill.domain}</p>
              </div>
              <button onClick={() => setPreviewSkill(null)} className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="font-mono text-xs bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-zinc-200 overflow-y-auto max-h-80 whitespace-pre-wrap">
              {previewSkill.content}
            </pre>
            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
              <button onClick={() => setPreviewSkill(null)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded">
                Close
              </button>
              <button
                onClick={() => { handleImport(previewSkill); setPreviewSkill(null); }}
                className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Import to Library</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
