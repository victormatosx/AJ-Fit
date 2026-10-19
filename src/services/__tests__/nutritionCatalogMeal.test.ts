import { beforeEach, describe, expect, it, vi } from 'vitest';
const { callable, factory } = vi.hoisted(() => { const callable = vi.fn(); return { callable, factory: vi.fn(() => callable) }; });
vi.mock('firebase/functions', () => ({ httpsCallable: factory }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('../../nutrition/ui/localDate', () => ({ todayLocalDate: () => '2026-10-18', deviceTimeZone: () => 'America/Sao_Paulo' }));
import { logCatalogMealOption } from '../nutritionCatalogMeal';
beforeEach(() => { callable.mockReset().mockResolvedValue({ data: { status: 'recorded' } }); });
describe('catalog meal consumer', () => {
  it.each(['plan', 'alternative', 'favorite'] as const)('sends only persisted %s reference with idempotency, never names/macros', async origin => {
    await logCatalogMealOption({ origin, documentId: 'real-doc' }, 'lunch-1', 'lunch', 'request-1234');
    expect(factory).toHaveBeenCalledWith({}, 'logCatalogMeal');
    expect(callable).toHaveBeenCalledWith({ origin, documentId: 'real-doc', optionId: 'lunch-1', slot: 'lunch',
      requestId: 'request-1234', localDate: '2026-10-18', timezone: 'America/Sao_Paulo' });
  });
  it('surfaces changed catalog failures instead of falling back to name matching', async () => {
    callable.mockRejectedValue(new Error('DIARY_CATALOG_CHANGED'));
    await expect(logCatalogMealOption({ origin: 'plan', documentId: 'p' }, 'lunch-1', 'lunch', 'request-1234')).rejects.toThrow('DIARY_CATALOG_CHANGED');
    expect(callable).toHaveBeenCalledTimes(1);
  });
});
