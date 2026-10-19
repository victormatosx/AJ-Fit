/** Backend deployment configuration only. Missing/invalid is OFF; never client controlled. */
export function catalogLinkingEnabled(): boolean {
  return process.env.NUTRITION_CATALOG_LINKING_ENABLED === 'true';
}
export const CATALOG_PLAN_SCHEMA_VERSION = '3.0.0';
export const CATALOG_PIPELINE_VERSION = 'catalog-linking-v1';
