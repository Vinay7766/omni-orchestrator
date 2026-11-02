// GENERATED from /schemas by scripts/generate-contract.mjs. Do not edit by hand.
export const SCHEMA_NAMES = ["adapter","agents-link","design-note","event","project","skill-catalog","skills-config","state"] as const;
export const VALIDATOR_EXPORTS = {"adapter":"adapter","agents-link":"agentsLink","design-note":"designNote","event":"event","project":"project","skill-catalog":"skillCatalog","skills-config":"skillsConfig","state":"state"} as const;
export const FLOWS = {"build":["idea-review","research","prd","architecture","build","review","security-pass","release","handover"],"pitch":["idea-description","idea-review","research","prd","presentation","outreach"]} as const;
export const PHASE_IDS = ["idea-review","research","prd","architecture","build","review","security-pass","release","handover","idea-description","presentation","outreach"] as const;
/** Phases that need a confirmed Understanding check when submitted (UND-1). */
export const PLANNING_PHASES = ["idea-description","idea-review","research","prd","architecture"] as const;
/** Phases whose submission must reference a complete stack ADR (STK-1..3). */
export const STACK_ADR_PHASES = ["architecture"] as const;
/** Phases a person may decline, each with the question the person is asked (GATE-1, SEC-1). */
export const OPTIONAL_PHASES: Readonly<Record<string, string>> = {"security-pass":"The build is done and ready to deploy. Before deploying, run a red-team / blue-team pass to tighten security?"};
