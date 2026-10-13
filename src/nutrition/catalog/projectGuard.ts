/**
 * Fase 33 round brief §13: refuse to let a catalog/rollout write target
 * whatever `.firebaserc` calls "production" — never trust the caller's
 * `--project` flag alone. Reads `.firebaserc` content directly (passed in,
 * not read from disk here) so this stays correct if that alias is ever
 * repointed, and so it's trivially unit-testable without touching the
 * filesystem.
 *
 * `allowCurrentTestProjectOverride` is the later round's explicit, scoped
 * escape hatch (round brief §11): the `.firebaserc` "production" alias is
 * the only Firebase project this repo has ever pointed at, and that round
 * explicitly authorizes using it as the current test environment (it has
 * no public real users yet). The override must still name the EXACT same
 * project id being written to — it is not a blanket bypass, it's a second,
 * explicit confirmation that the caller means it.
 */
export function assertNotProductionProject(
  projectId: string, firebaseRcContent: string, allowCurrentTestProjectOverride?: string,
): void {
  const rc = JSON.parse(firebaseRcContent) as { projects?: Record<string, string> };
  const productionProjectId = rc.projects?.production;
  if (!productionProjectId || projectId !== productionProjectId) return;
  if (allowCurrentTestProjectOverride === projectId) return;
  throw new Error(`REFUSING_PRODUCTION_PROJECT: --project ${projectId} matches .firebaserc's "production" alias. `
    + `Pass the id of a separate test/dev Firebase project, or if this project is explicitly authorized as the `
    + `current test environment, pass --allow-current-test-project ${projectId} to confirm explicitly.`);
}
