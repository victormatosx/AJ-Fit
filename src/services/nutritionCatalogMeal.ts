import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebaseFunctions';
import { deviceTimeZone, todayLocalDate } from '../nutrition/ui/localDate';
import type { NutritionMealSlot } from '../types/nutrition';

export interface CatalogMealOrigin { origin: 'plan' | 'alternative' | 'favorite'; documentId: string }
export async function logCatalogMealOption(origin: CatalogMealOrigin, optionId: string, slot: NutritionMealSlot, requestId: string): Promise<void> {
  await httpsCallable(functions, 'logCatalogMeal')({ ...origin, optionId, slot, requestId,
    localDate: todayLocalDate(), timezone: deviceTimeZone() });
}
