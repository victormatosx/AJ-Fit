import { describe, expect, it } from 'vitest';
import { deriveHyphenCompoundAliases, expandSynonyms } from '../aliases';

describe('expandSynonyms', () => {
  it('expands mussarela/muçarela/mozarela as one group', () => {
    expect(expandSynonyms('mussarela')).toEqual(expect.arrayContaining(['mussarela', 'mucarela', 'mozarela']));
    expect(expandSynonyms('mucarela')).toEqual(expect.arrayContaining(['mussarela', 'mucarela']));
    expect(expandSynonyms('muçarela')).toEqual(expect.arrayContaining(['mussarela', 'mucarela', 'mozarela']));
  });

  it('expands estrogonofe/strogonoff/stroganoff as one group', () => {
    expect(expandSynonyms('estrogonofe')).toEqual(expect.arrayContaining(['estrogonofe', 'strogonoff', 'stroganoff']));
    expect(expandSynonyms('strogonoff')).toEqual(expect.arrayContaining(['estrogonofe', 'strogonoff']));
  });

  it('expands contrafile/"contra file" as one group', () => {
    expect(expandSynonyms('contrafile')).toEqual(expect.arrayContaining(['contrafile', 'contra file']));
    expect(expandSynonyms('contra-filé')).toEqual(expect.arrayContaining(['contrafile', 'contra file']));
  });

  it('maps the Portuguese multivitamin query to the real English OFF label', () => {
    expect(expandSynonyms('multivitamínico')).toEqual(expect.arrayContaining([
      'multivitaminico', 'multivitamin', 'multivitamins', 'complexo vitaminico',
    ]));
  });

  it('handles the grammatical gender variation in carne moída/moído', () => {
    expect(expandSynonyms('moída')).toEqual(expect.arrayContaining(['moida', 'moido']));
  });

  it('returns just [word] for a word with no synonym group, never throws', () => {
    expect(expandSynonyms('arroz')).toEqual(['arroz']);
    expect(expandSynonyms('')).toEqual(['']);
  });

  it('is reflexive — every member of a group expands to the full group', () => {
    for (const member of expandSynonyms('mozarela')) {
      expect(expandSynonyms(member)).toEqual(expect.arrayContaining(['mussarela', 'mucarela', 'mozarela', 'muzzarella']));
    }
  });
});

describe('deriveHyphenCompoundAliases', () => {
  it('derives a concatenated alias from a hyphenated compound in the raw name', () => {
    expect(deriveHyphenCompoundAliases('Carne, bovina, capa de contra-filé, crua')).toEqual(['contrafile']);
    expect(deriveHyphenCompoundAliases('Batata-doce, cozida')).toEqual(['batatadoce']);
  });

  it('derives multiple aliases from multiple hyphenated compounds, deduped', () => {
    const aliases = deriveHyphenCompoundAliases('Pão-de-ló com contra-filé');
    expect(aliases).toEqual(expect.arrayContaining(['paodelo', 'contrafile']));
  });

  it('returns an empty array when the name has no hyphenated compound', () => {
    expect(deriveHyphenCompoundAliases('Arroz, integral, cozido')).toEqual([]);
  });
});
