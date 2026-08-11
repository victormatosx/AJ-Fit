import { describe, expect, it } from 'vitest';
import type {
  CustomerInfo,
  PACKAGE_TYPE,
  PurchasesOfferings,
  PurchasesPackage,
} from 'react-native-purchases';
import {
  classifyPurchaseResult,
  classifyRestoreResult,
  getCurrentOfferingPackages,
  packagePeriodLabel,
  packagePriceString,
  packageTitle,
  resolveOfferingViewState,
  resolveSelectedPackage,
} from '../subscriptionOffer';

function makePackage({
  id,
  type,
  title,
  price,
  period,
}: {
  id: string;
  type: PACKAGE_TYPE;
  title: string;
  price: string;
  period: string | null;
}): PurchasesPackage {
  return {
    identifier: id,
    packageType: type,
    product: {
      title,
      priceString: price,
      subscriptionPeriod: period,
    },
  } as PurchasesPackage;
}

function makeCustomerInfo(hasPremium: boolean): CustomerInfo {
  return {
    entitlements: {
      active: hasPremium ? { premium: { identifier: 'premium' } } : {},
    },
  } as unknown as CustomerInfo;
}

const monthly = makePackage({
  id: '$rc_monthly',
  type: 'MONTHLY' as PACKAGE_TYPE,
  title: 'AJ Fit Mensal',
  price: 'R$ 39,90',
  period: 'P1M',
});
const annual = makePackage({
  id: '$rc_annual',
  type: 'ANNUAL' as PACKAGE_TYPE,
  title: 'AJ Fit Anual',
  price: 'R$ 299,90',
  period: 'P1Y',
});
const custom = makePackage({
  id: 'campaign-package',
  type: 'CUSTOM' as PACKAGE_TYPE,
  title: 'Plano configurado na loja',
  price: '€ 8,99',
  period: 'P3M',
});

describe('subscriptionOffer', () => {
  it('usa todos os packages do Offering atual, sem filtrar ou reconstruir objetos', () => {
    const offerings = {
      current: { availablePackages: [monthly, annual, custom] },
    } as PurchasesOfferings;

    expect(getCurrentOfferingPackages(offerings)).toEqual([monthly, annual, custom]);
    expect(getCurrentOfferingPackages(offerings)[2]).toBe(custom);
  });

  it('retorna lista vazia sem Offering atual', () => {
    expect(getCurrentOfferingPackages(null)).toEqual([]);
    expect(getCurrentOfferingPackages({ current: null } as PurchasesOfferings)).toEqual([]);
  });

  it('distingue loading, Offering pronto e ausência de packages', () => {
    expect(
      resolveOfferingViewState({
        offerings: null,
        loading: false,
        error: null,
        offline: false,
        unavailable: false,
      }),
    ).toBe('loading');
    expect(
      resolveOfferingViewState({
        offerings: {
          current: { availablePackages: [monthly] },
        } as PurchasesOfferings,
        loading: false,
        error: null,
        offline: false,
        unavailable: false,
      }),
    ).toBe('ready');
    expect(
      resolveOfferingViewState({
        offerings: { current: null } as PurchasesOfferings,
        loading: false,
        error: null,
        offline: false,
        unavailable: false,
      }),
    ).toBe('empty');
  });

  it('distingue Offering indisponível e erro offline', () => {
    expect(
      resolveOfferingViewState({
        offerings: null,
        loading: false,
        error: null,
        offline: false,
        unavailable: true,
      }),
    ).toBe('unavailable');
    expect(
      resolveOfferingViewState({
        offerings: null,
        loading: false,
        error: 'network',
        offline: true,
        unavailable: false,
      }),
    ).toBe('offline');
  });

  it('seleciona inicialmente o primeiro package na ordem do Offering', () => {
    expect(resolveSelectedPackage([monthly, annual], null)).toBe(monthly);
  });

  it('preserva e devolve o próprio objeto do package selecionado', () => {
    expect(resolveSelectedPackage([monthly, annual], annual.identifier)).toBe(annual);
  });

  it('renderiza título conhecido ou o título real da Store para package customizado', () => {
    expect(packageTitle(monthly)).toBe('Mensal');
    expect(packageTitle(annual)).toBe('Anual');
    expect(packageTitle(custom)).toBe('Plano configurado na loja');
  });

  it('deriva período do produto real e preço do priceString localizado', () => {
    expect(packagePeriodLabel(monthly)).toBe('por mês');
    expect(packagePeriodLabel(custom)).toBe('a cada 3 meses');
    expect(packagePriceString(custom)).toBe('€ 8,99');
  });

  it('classifica compra cancelada e erro sem conceder Premium', () => {
    expect(classifyPurchaseResult({ status: 'cancelled' }, 'premium')).toBe('cancelled');
    expect(classifyPurchaseResult({ status: 'error' }, 'premium')).toBe('error');
  });

  it('distingue CustomerInfo comprado com e sem entitlement Premium', () => {
    expect(
      classifyPurchaseResult(
        { status: 'purchased', customerInfo: makeCustomerInfo(true) },
        'premium',
      ),
    ).toBe('premium');
    expect(
      classifyPurchaseResult(
        { status: 'purchased', customerInfo: makeCustomerInfo(false) },
        'premium',
      ),
    ).toBe('missing-entitlement');
  });

  it('distingue restore com Premium, sem Premium e com erro', () => {
    expect(
      classifyRestoreResult(
        { status: 'restored', customerInfo: makeCustomerInfo(true) },
        'premium',
      ),
    ).toBe('premium');
    expect(
      classifyRestoreResult(
        { status: 'restored', customerInfo: makeCustomerInfo(false) },
        'premium',
      ),
    ).toBe('missing-entitlement');
    expect(classifyRestoreResult({ status: 'error' }, 'premium')).toBe('error');
  });
});
