import type { CustomerInfo, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';

export function getCurrentOfferingPackages(
  offerings: PurchasesOfferings | null,
): PurchasesPackage[] {
  return offerings?.current?.availablePackages ?? [];
}

export type OfferingViewState =
  | 'loading'
  | 'ready'
  | 'offline'
  | 'error'
  | 'empty'
  | 'unavailable';

export function resolveOfferingViewState({
  offerings,
  loading,
  error,
  offline,
  unavailable,
}: {
  offerings: PurchasesOfferings | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
  unavailable: boolean;
}): OfferingViewState {
  if ((!offerings && !error && !unavailable) || (loading && !offerings)) return 'loading';
  if (unavailable) return 'unavailable';

  const packages = getCurrentOfferingPackages(offerings);
  if (error && packages.length === 0) return offline ? 'offline' : 'error';
  return packages.length > 0 ? 'ready' : 'empty';
}

/** Keeps a valid user selection, otherwise follows the Offering's own order. */
export function resolveSelectedPackage(
  packages: PurchasesPackage[],
  selectedId: string | null,
): PurchasesPackage | null {
  return packages.find((pkg) => pkg.identifier === selectedId) ?? packages[0] ?? null;
}

export function packageTitle(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'ANNUAL':
      return 'Anual';
    case 'MONTHLY':
      return 'Mensal';
    case 'WEEKLY':
      return 'Semanal';
    case 'SIX_MONTH':
      return 'Semestral';
    case 'THREE_MONTH':
      return 'Trimestral';
    case 'TWO_MONTH':
      return 'Bimestral';
    case 'LIFETIME':
      return 'Vitalício';
    default:
      return pkg.product.title;
  }
}

export function packagePeriodLabel(pkg: PurchasesPackage): string {
  if (pkg.packageType === 'LIFETIME') return 'pagamento único';

  const period = pkg.product.subscriptionPeriod;
  const match = period?.match(/^P(\d+)([DWMY])$/);
  if (!match) return '';

  const amount = Number(match[1]);
  const labels = {
    D: ['dia', 'dias'],
    W: ['semana', 'semanas'],
    M: ['mês', 'meses'],
    Y: ['ano', 'anos'],
  } as const;
  const [singular, plural] = labels[match[2] as keyof typeof labels];
  return amount === 1 ? `por ${singular}` : `a cada ${amount} ${plural}`;
}

export function packagePriceString(pkg: PurchasesPackage): string {
  return pkg.product.priceString;
}

type PurchaseResult =
  | { status: 'purchased'; customerInfo: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'error' };

type RestoreResult =
  | { status: 'restored'; customerInfo: CustomerInfo }
  | { status: 'error' };

export type PurchaseResultKind = 'premium' | 'missing-entitlement' | 'cancelled' | 'error';
export type RestoreResultKind = 'premium' | 'missing-entitlement' | 'error';

function hasActiveEntitlement(customerInfo: CustomerInfo, entitlementId: string): boolean {
  return Boolean(customerInfo.entitlements.active[entitlementId]);
}

export function classifyPurchaseResult(
  result: PurchaseResult,
  entitlementId: string,
): PurchaseResultKind {
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'error') return 'error';
  return hasActiveEntitlement(result.customerInfo, entitlementId)
    ? 'premium'
    : 'missing-entitlement';
}

export function classifyRestoreResult(
  result: RestoreResult,
  entitlementId: string,
): RestoreResultKind {
  if (result.status === 'error') return 'error';
  return hasActiveEntitlement(result.customerInfo, entitlementId)
    ? 'premium'
    : 'missing-entitlement';
}
