import { describe, expect, it } from 'vitest';
import { genericServingUnitFor, genericServingUnitsFor } from '../genericServingRules';

describe('genericServingUnitFor', () => {
  it('matches each staple named in the round brief', () => {
    expect(genericServingUnitFor('Ovo, de galinha, cru')).toMatchObject({ id: 'unidade', gramEquivalent: 50, provenance: 'reviewed_generic' });
    expect(genericServingUnitFor('Pão francês')).toMatchObject({ gramEquivalent: 50 });
    expect(genericServingUnitFor('Maçã, com casca, crua')).toMatchObject({ gramEquivalent: 130 });
    expect(genericServingUnitFor('Banana, prata, crua')).toMatchObject({ gramEquivalent: 90 });
    expect(genericServingUnitFor('Laranja, pêra, crua')).toMatchObject({ gramEquivalent: 180 });
    expect(genericServingUnitFor('Queijo, mussarela')).toMatchObject({ id: 'fatia', gramEquivalent: 30 });
    expect(genericServingUnitFor('Arroz, branco, cozido')).toMatchObject({ id: 'colher-servir', gramEquivalent: 60 });
    expect(genericServingUnitFor('Feijão, carioca, cozido')).toMatchObject({ gramEquivalent: 80 });
    expect(genericServingUnitFor('Leite, de vaca, integral')).toMatchObject({ gramEquivalent: 200, mlEquivalent: 200 });
  });

  it('matches accent-insensitive and orthographic variants (ç/ã handling via normalizeSearchText)', () => {
    expect(genericServingUnitFor('Maca')).toMatchObject({ gramEquivalent: 130 });
    expect(genericServingUnitFor('Queijo, muçarela')).toMatchObject({ gramEquivalent: 30 });
  });

  it('returns null for a food this table deliberately does not cover', () => {
    expect(genericServingUnitFor('Whey protein isolado')).toBeNull();
    expect(genericServingUnitFor('YoPRO Morango')).toBeNull();
  });

  it('matches real TACO head-then-variant naming, not just the simplified two-word fixture ("Pão, trigo, francês")', () => {
    expect(genericServingUnitFor('Pão, trigo, francês')).toMatchObject({ id: 'unidade', gramEquivalent: 50 });
  });
});

describe('genericServingUnitFor — egg species granularity', () => {
  it('ovo de galinha gets the reviewed whole chicken-egg weight (50 g)', () => {
    expect(genericServingUnitFor('Ovo, de galinha, inteiro, cru')).toMatchObject({ id: 'unidade', gramEquivalent: 50, provenance: 'reviewed_generic' });
    expect(genericServingUnitFor('Ovo, de galinha, inteiro, cozido/10minutos')).toMatchObject({ gramEquivalent: 50 });
    expect(genericServingUnitFor('Ovo, de galinha, inteiro, frito')).toMatchObject({ gramEquivalent: 50 });
  });

  it('ovo de codorna gets its OWN, much smaller reviewed weight (10 g) — never the chicken-egg one', () => {
    const unit = genericServingUnitFor('Ovo, de codorna, inteiro, cru');
    expect(unit).toMatchObject({ id: 'unidade', gramEquivalent: 10, provenance: 'reviewed_generic' });
    expect(unit?.gramEquivalent).not.toBe(50);
  });

  it('a fraction of an egg (clara/gema alone) never inherits a whole-egg unit, for either species', () => {
    expect(genericServingUnitFor('Ovo, de galinha, clara, cozida/10minutos')).toBeNull();
    expect(genericServingUnitFor('Ovo, de galinha, gema, cozida/10minutos')).toBeNull();
  });

  it('any other egg species with no specific reviewed rule stays grams-only, never guesses a weight', () => {
    expect(genericServingUnitFor('Ovo, de pato, inteiro, cru')).toBeNull();
    expect(genericServingUnitFor('Ovo, de ganso, inteiro, cru')).toBeNull();
    expect(genericServingUnitFor('Ovo, de avestruz, inteiro, cru')).toBeNull();
  });
});

describe('genericServingUnitFor — false-positive regression cases (dry-run audit)', () => {
  it('"Banana, maçã, crua" follows the banana family (90 g), never the maçã/apple rule (130 g) — head word wins, not substring', () => {
    expect(genericServingUnitFor('Banana, maçã, crua')).toMatchObject({ id: 'unidade', gramEquivalent: 90 });
  });

  it('"Pão, de queijo, assado/cru" never inherits the cheese "1 fatia" rule — "pão" is the head, "queijo" is just a modifier', () => {
    expect(genericServingUnitFor('Pão, de queijo, assado')).toBeNull();
    expect(genericServingUnitFor('Pão, de queijo, cru')).toBeNull();
  });

  it('other obvious compounds where the keyword is a modifier, not the head food, get no generic unit', () => {
    // "Farinha, de arroz" is flour, not cooked rice — arroz's colher/xícara units don't apply.
    expect(genericServingUnitsFor('Farinha, de arroz, enriquecida')).toEqual([]);
    // "Creme de arroz" is a powder/cream product, not cooked rice.
    expect(genericServingUnitsFor('Creme de arroz, pó')).toEqual([]);
    // "Macarrão, trigo, cru, com ovos" has eggs as an ingredient, but the food itself is pasta, not "1 unidade" of egg.
    expect(genericServingUnitFor('Macarrão, trigo, cru, com ovos')).toBeNull();
    // "Pastel, de queijo, frito" is a fried pastry, not a cheese slice.
    expect(genericServingUnitFor('Pastel, de queijo, frito')).toBeNull();
    // "Torrada, pão francês" is toast, not a whole bread roll.
    expect(genericServingUnitFor('Torrada, pão francês')).toBeNull();
    // "Creme de Leite" (heavy cream) is not "1 copo (200 ml)" of drinking milk.
    expect(genericServingUnitFor('Creme de Leite')).toBeNull();
  });

  it('excludes the prepared/liquid/powdered forms of a head food that no longer fit its raw-ingredient unit', () => {
    // Orange JUICE is not "1 unidade".
    expect(genericServingUnitFor('Laranja, da terra, suco')).toBeNull();
    expect(genericServingUnitFor('Laranja, pêra, suco')).toBeNull();
    // Condensed/powdered milk is not "1 copo (200 ml)".
    expect(genericServingUnitFor('Leite, condensado')).toBeNull();
    expect(genericServingUnitFor('Leite, de vaca, desnatado, pó')).toBeNull();
    // A banana-flavored candy bar is not "1 unidade" of fruit.
    expect(genericServingUnitFor('Banana, doce em barra')).toBeNull();
    // Petit suisse is a dessert cup, not a sliceable cheese.
    expect(genericServingUnitFor('Queijo, petit suisse, morango')).toBeNull();
  });

  it('still applies normally to every unflagged real TACO variant of the same families', () => {
    expect(genericServingUnitFor('Banana, prata, crua')).toMatchObject({ gramEquivalent: 90 });
    expect(genericServingUnitFor('Laranja, baía, crua')).toMatchObject({ gramEquivalent: 180 });
    expect(genericServingUnitFor('Leite, de cabra')).toMatchObject({ gramEquivalent: 200, mlEquivalent: 200 });
    expect(genericServingUnitFor('Queijo, mozarela')).toMatchObject({ id: 'fatia', gramEquivalent: 30 });
  });
});

describe('genericServingUnitFor — milk species/composition granularity', () => {
  it('plain dairy milk (integral/desnatado) keeps the reviewed "1 copo (200 ml)"', () => {
    expect(genericServingUnitFor('Leite, de vaca, integral')).toMatchObject({ id: 'copo', gramEquivalent: 200, mlEquivalent: 200 });
    expect(genericServingUnitFor('Leite, de vaca, desnatado')).toMatchObject({ id: 'copo', gramEquivalent: 200, mlEquivalent: 200 });
  });

  it('coconut milk never inherits the dairy-cup unit — stays grams/ml-only', () => {
    expect(genericServingUnitFor('Leite, de coco')).toBeNull();
  });

  it('other plant-based/compound milks have no confidently-reviewed cup weight — stay grams/ml-only unless a rule explicitly covers them', () => {
    expect(genericServingUnitFor('Leite, de soja')).toBeNull();
    expect(genericServingUnitFor('Leite, de aveia')).toBeNull();
    expect(genericServingUnitFor('Leite, de amêndoa')).toBeNull();
    expect(genericServingUnitFor('Leite, de arroz')).toBeNull();
  });
});

describe('genericServingUnitsFor', () => {
  it('offers both colher and xícara for arroz — multiple natural units, first is the default', () => {
    const units = genericServingUnitsFor('Arroz, branco, cozido');
    expect(units.map((unit) => unit.id)).toEqual(['colher-servir', 'xicara']);
    expect(units[1]).toMatchObject({ label: '1 xícara (150 g)', gramEquivalent: 150 });
  });

  it('returns an empty array (never null) for an uncovered food', () => {
    expect(genericServingUnitsFor('Whey protein isolado')).toEqual([]);
  });
});
