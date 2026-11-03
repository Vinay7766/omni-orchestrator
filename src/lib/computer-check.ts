/**
 * G (owner decision 2026-11-03): instead of asking "are you technical?", the app checks the
 * computer for what building with AI needs, using the setup guide's own checks. A check that
 * fails is reported as unchecked, never as missing (NFR-7).
 */
import type { SetupChecks } from "../components/setup/SetupGuide";

export interface ComputerCheck {
  /** What was looked for and not found, in plain words. */
  missing: string[];
  /** What could not be checked. */
  unchecked: string[];
}

export async function checkComputer(checks: Pick<SetupChecks, "gitVersion" | "tools">): Promise<ComputerCheck> {
  const missing: string[] = [];
  const unchecked: string[] = [];
  const [git, tools] = await Promise.allSettled([checks.gitVersion(), checks.tools()]);
  if (git.status === "rejected") unchecked.push("Git");
  else if (!git.value) missing.push("Git");
  if (tools.status === "rejected" || !tools.value.ok) unchecked.push("AI coding tools");
  else if (tools.value.tools.length === 0) missing.push("an AI coding tool or editor");
  return { missing, unchecked };
}
