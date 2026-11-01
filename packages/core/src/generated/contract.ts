// GENERATED from /schemas by scripts/generate-contract.mjs. Do not edit by hand.
export const SCHEMA_NAMES = ["agents-link","design-note","event","project","skill-catalog","skills-config","state"] as const;
export const VALIDATOR_EXPORTS = {"agents-link":"agentsLink","design-note":"designNote","event":"event","project":"project","skill-catalog":"skillCatalog","skills-config":"skillsConfig","state":"state"} as const;
export const FLOWS = {"build":["idea-review","research","prd","architecture","build","review","handover"],"pitch":["idea-description","idea-review","research","prd","presentation","outreach"]} as const;
export const PHASE_IDS = ["idea-review","research","prd","architecture","build","review","handover","idea-description","presentation","outreach"] as const;
/** Phases that need a confirmed Understanding check when submitted (UND-1). */
export const PLANNING_PHASES = ["idea-description","idea-review","research","prd","architecture"] as const;
