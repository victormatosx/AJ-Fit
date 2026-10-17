/** READ ONLY release gate. Explicit project; no writes, imports, or AI calls. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onboardingCatalogFoods } from '../../src/nutrition/catalog/onboardingCatalog';
async function main() {
const projectId = process.argv[process.argv.indexOf('--project') + 1];
if (!process.argv.includes('--project') || !projectId) throw new Error('USAGE: --project project-id');
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
const snapshots = await db.getAll(...onboardingCatalogFoods.map((food) => db.collection('nutritionFoods').doc(food.id)));
const invalid = snapshots.filter((snapshot) => !snapshot.exists || snapshot.get('generationStatus') !== 'approved'
  || snapshot.get('name') !== onboardingCatalogFoods.find((food) => food.id === snapshot.id)?.name);
console.log(JSON.stringify({ projectId, checked: snapshots.length, incompatibleIds: invalid.map((snapshot) => snapshot.id) }));
if (invalid.length) process.exitCode = 1;

}
void main().catch((error) => { console.error(error instanceof Error ? error.message : 'CATALOG_CHECK_FAILED'); process.exitCode = 1; });
