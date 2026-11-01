import React from "react";

/** Shows which phases a skill is used in; ["all"] means every phase. */
export const PhaseBadges: React.FC<{ phases?: string[] }> = ({ phases }) => {
  if (!phases || phases.length === 0) return null;
  const labels = phases.length === 1 && phases[0] === "all" ? ["all phases"] : phases;
  return (
    <>
      {labels.map((label) => (
        <span
          key={label}
          className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700"
        >
          {label}
        </span>
      ))}
    </>
  );
};
