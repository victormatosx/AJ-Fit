#!/usr/bin/env -S node --import tsx
/**
 * Fase C3 — expanded rerun of the C1/C2 search benchmark
 * (`docs/nutrition/catalog-expansion/04_search_benchmark.md`,
 * `10_c2_search_results.md`) against the REAL, deployed `foodLogCatalog`,
 * using the same anchor+refine+synonym query shape `searchFoodLogCatalog`
 * uses client-side, through the Admin SDK so this runs head-lessly as a
 * CLI report (same trust level as `catalogAudit.ts` — read-only).
 *
 * Usage: node --import tsx scripts/nutrition/foodLog/searchBenchmark.ts --project ajfit-2f321
 */
import { dedupeFoodLogSearchResults, rankFoodLogResults } from '../../../src/nutrition/foodLog/rank';
import { buildFoodLogSearchPlan, matchesRefineWords } from '../../../src/nutrition/foodLog/search';
import type { FoodLogEntry } from '../../../src/types/nutrition';

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

/** `[term, category]` — category drives the per-category coverage breakdown (round brief C3 Part 15/16). */
const BENCHMARK_TERMS: readonly (readonly [string, string])[] = [
  // Carnes/aves
  ['frango', 'carnes_aves'], ['peito de frango', 'carnes_aves'], ['filé de frango', 'carnes_aves'],
  ['file de frango', 'carnes_aves'], ['frango grelhado', 'carnes_aves'], ['frango desfiado', 'carnes_aves'],
  ['coxa', 'carnes_aves'], ['coxa de frango', 'carnes_aves'], ['sobrecoxa', 'carnes_aves'],
  ['patinho', 'carnes_aves'], ['patinho moído', 'carnes_aves'], ['carne moída', 'carnes_aves'],
  ['acém', 'carnes_aves'], ['contrafilé', 'carnes_aves'], ['contra filé', 'carnes_aves'],
  ['maminha', 'carnes_aves'], ['picanha', 'carnes_aves'], ['lombo', 'carnes_aves'],
  ['alcatra', 'carnes_aves'], ['fraldinha', 'carnes_aves'], ['frango a passarinho', 'carnes_aves'],
  ['peru', 'carnes_aves'], ['linguiça', 'carnes_aves'], ['bacon', 'carnes_aves'],
  // Peixes
  ['tilápia', 'peixes'], ['salmão', 'peixes'], ['atum', 'peixes'], ['sardinha', 'peixes'],
  ['bacalhau', 'peixes'], ['camarão', 'peixes'],
  // Ovos
  ['ovo', 'ovos'], ['ovo cozido', 'ovos'], ['clara de ovo', 'ovos'], ['omelete', 'ovos'],
  // Laticínios
  ['leite', 'laticinios'], ['iogurte', 'laticinios'], ['muçarela', 'laticinios'], ['mussarela', 'laticinios'],
  ['queijo minas', 'laticinios'], ['requeijão', 'laticinios'], ['cottage', 'laticinios'],
  ['queijo prato', 'laticinios'], ['manteiga', 'laticinios'], ['leite condensado', 'laticinios'],
  ['creme de leite', 'laticinios'], ['queijo coalho', 'laticinios'],
  // Carboidratos
  ['arroz', 'carboidratos'], ['arroz integral', 'carboidratos'], ['feijão', 'carboidratos'],
  ['feijao preto', 'carboidratos'], ['macarrão', 'carboidratos'], ['pão francês', 'carboidratos'],
  ['pao frances', 'carboidratos'], ['pão de forma', 'carboidratos'], ['tapioca', 'carboidratos'],
  ['aveia', 'carboidratos'], ['batata', 'carboidratos'], ['batata doce', 'carboidratos'],
  ['batata-doce', 'carboidratos'], ['mandioca', 'carboidratos'], ['aipim', 'carboidratos'],
  ['quinoa', 'carboidratos'], ['cuscuz', 'carboidratos'], ['farinha de trigo', 'carboidratos'],
  ['milho', 'carboidratos'], ['pão integral', 'carboidratos'],
  // Frutas
  ['banana', 'frutas'], ['maçã', 'frutas'], ['maca', 'frutas'], ['mamão', 'frutas'], ['manga', 'frutas'],
  ['morango', 'frutas'], ['abacate', 'frutas'], ['laranja', 'frutas'], ['uva', 'frutas'], ['melancia', 'frutas'],
  ['abacaxi', 'frutas'], ['limão', 'frutas'], ['pera', 'frutas'], ['kiwi', 'frutas'], ['melão', 'frutas'],
  // Legumes/verduras
  ['tomate', 'legumes_verduras'], ['alface', 'legumes_verduras'], ['cenoura', 'legumes_verduras'],
  ['brócolis', 'legumes_verduras'], ['abobrinha', 'legumes_verduras'], ['cebola', 'legumes_verduras'],
  ['pepino', 'legumes_verduras'], ['couve', 'legumes_verduras'],
  // Suplementos
  ['whey', 'suplementos'], ['whey protein', 'suplementos'], ['creatina', 'suplementos'],
  ['barra de proteína', 'suplementos'], ['barra de cereal', 'suplementos'], ['albumina', 'suplementos'],
  ['bcaa', 'suplementos'], ['multivitamínico', 'suplementos'],
  // Preparações
  ['purê', 'preparacoes'], ['purê de batata', 'preparacoes'], ['farofa', 'preparacoes'],
  ['lasanha', 'preparacoes'], ['estrogonofe', 'preparacoes'], ['strogonoff', 'preparacoes'],
  ['arroz com feijão', 'preparacoes'], ['baião de dois', 'preparacoes'], ['feijoada', 'preparacoes'],
  ['escondidinho', 'preparacoes'], ['pizza', 'preparacoes'], ['hambúrguer', 'preparacoes'],
  ['panqueca', 'preparacoes'], ['sopa', 'preparacoes'], ['salada', 'preparacoes'],
  // Bebidas
  ['refrigerante', 'bebidas'], ['suco', 'bebidas'], ['água de coco', 'bebidas'], ['café', 'bebidas'],
  ['chá', 'bebidas'], ['cerveja', 'bebidas'], ['vitamina', 'bebidas'],
  // Cereais/snacks
  ['cereal matinal', 'cereais_snacks'], ['granola', 'cereais_snacks'], ['bolacha', 'cereais_snacks'],
  ['biscoito', 'cereais_snacks'], ['salgadinho', 'cereais_snacks'], ['torrada', 'cereais_snacks'],
  ['pipoca', 'cereais_snacks'], ['chocolate', 'cereais_snacks'],
  // Marcas BR relevantes (confirmadas no corpus OFF coletado em C2/C3)
  ['sadia', 'marca'], ['perdigão', 'marca'], ['perdigao', 'marca'], ['vigor', 'marca'],
  ['piracanjuba', 'marca'], ['nestlé', 'marca'], ['nestle', 'marca'], ['yoki', 'marca'],
  ['qualy', 'marca'], ['danone', 'marca'], ['itambé', 'marca'], ['itambe', 'marca'],
  ['coca cola', 'marca'], ['nescau', 'marca'], ['camil', 'marca'], ['tio joão', 'marca'],
  ['batavo', 'marca'], ['parmalat', 'marca'], ['seara', 'marca'], ['dux', 'marca'],
  // Variações sem acento (teste explícito de busca sem acento, round brief C3 Part 5)
  ['tilapia', 'peixes'], ['salmao', 'peixes'], ['mamao', 'frutas'], ['queijo', 'laticinios'],
] as const;

const PRIORITY_TERMS = new Set([
  'frango', 'peito de frango', 'filé de frango', 'frango grelhado', 'frango desfiado', 'coxa de frango',
  'sobrecoxa', 'patinho', 'carne moída', 'acém', 'contrafilé', 'tilápia', 'salmão', 'atum', 'ovo',
  'arroz', 'feijão', 'pão francês', 'whey', 'iogurte', 'muçarela', 'mussarela', 'leite', 'aveia', 'banana',
  'estrogonofe', 'strogonoff',
]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectId = flagValue(args, '--project');
  if (!projectId) throw new Error('USAGE: --project <firebase-project-id>');
  const poolSize = Number(flagValue(args, '--pool-size') ?? '60');
  if (!Number.isInteger(poolSize) || poolSize < 20 || poolSize > 60) throw new Error('INVALID_POOL_SIZE');
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const results: { term: string; category: string; count: number; useful: boolean; reads: number;
    latencyMs: number; top: string[]; sources: string[]; priority: boolean }[] = [];
  for (const [term, category] of BENCHMARK_TERMS) {
    const { anchorTerms, refineWords } = buildFoodLogSearchPlan(term);
    const startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- sequential, bounded (~150 terms), simplicity over micro-parallelism for a one-off report.
    const snap = await db.collection('foodLogCatalog')
      .where('status', '==', 'active')
      .where('searchPrefixes', 'array-contains-any', anchorTerms.map((t) => t.slice(0, 32)))
      .orderBy('searchSourcePriority')
      .orderBy('__name__')
      .limit(poolSize).get();
    const latencyMs = performance.now() - startedAt;
    const candidates = snap.docs.map((docSnap) => docSnap.data() as FoodLogEntry);
    const refined = candidates.filter((food) => matchesRefineWords(food, refineWords));
    const pool = refined.length > 0 ? refined : candidates;
    const ranked = dedupeFoodLogSearchResults(rankFoodLogResults(pool, term));
    const plan = buildFoodLogSearchPlan(term);
    const allConcepts = [plan.anchorWord, ...plan.refineWords].filter(Boolean);
    const useful = ranked.slice(0, 5).some((food) => matchesRefineWords(food, allConcepts));
    results.push({
      term, category, count: ranked.length, useful, reads: snap.size,
      latencyMs: Number(latencyMs.toFixed(1)), top: ranked.slice(0, 5).map((food) => food.name),
      sources: [...new Set(ranked.map((food) => food.source.type))],
      priority: PRIORITY_TERMS.has(term),
    });
  }

  const totalQueries = results.length;
  const withResults = results.filter((r) => r.useful);
  const zeroResult = results.filter((r) => r.count === 0);
  const noUsefulResult = results.filter((r) => !r.useful);
  const avgResults = withResults.reduce((sum, r) => sum + r.count, 0) / (withResults.length || 1);
  const priorityResults = results.filter((r) => r.priority);
  const priorityZero = priorityResults.filter((r) => !r.useful);

  const byCategory: Record<string, { total: number; withResult: number }> = {};
  for (const r of results) {
    byCategory[r.category] ??= { total: 0, withResult: 0 };
    byCategory[r.category].total += 1;
    if (r.useful) byCategory[r.category].withResult += 1;
  }

  const sortedLatencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number) => sortedLatencies[Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * p))] ?? 0;
  const paginationTerm = 'frango';
  const paginationPlan = buildFoodLogSearchPlan(paginationTerm);
  const firstPageStartedAt = performance.now();
  const firstPage = await db.collection('foodLogCatalog').where('status', '==', 'active')
    .where('searchPrefixes', 'array-contains-any', paginationPlan.anchorTerms)
    .orderBy('searchSourcePriority').orderBy('__name__').limit(poolSize).get();
  const firstPageLatencyMs = performance.now() - firstPageStartedAt;
  let pagination: Record<string, number | string | null> = {
    term: paginationTerm, firstPageLatencyMs: Number(firstPageLatencyMs.toFixed(1)),
    firstPageQueries: 1, firstPageReads: firstPage.size, secondPageLatencyMs: null, secondPageQueries: 0, secondPageReads: 0,
  };
  if (!firstPage.empty) {
    const cursorDoc = firstPage.docs[firstPage.docs.length - 1];
    const cursorId = cursorDoc.id;
    const cursorPriority = Number(cursorDoc.get('searchSourcePriority') ?? 1);
    const secondPageStartedAt = performance.now();
    const secondPage = await db.collection('foodLogCatalog').where('status', '==', 'active')
      .where('searchPrefixes', 'array-contains-any', paginationPlan.anchorTerms)
      .orderBy('searchSourcePriority').orderBy('__name__').startAfter(cursorPriority, cursorId).limit(poolSize).get();
    pagination = { ...pagination, secondPageLatencyMs: Number((performance.now() - secondPageStartedAt).toFixed(1)),
      secondPageQueries: 1, secondPageReads: secondPage.size, nextCursor: secondPage.empty ? null : secondPage.docs[secondPage.docs.length - 1].id };
  }

  const report = {
    totalQueries,
    candidatePoolSize: poolSize,
    queriesWithUsefulResult: withResults.length,
    usefulResultRate: Number((withResults.length / totalQueries).toFixed(3)),
    zeroResultRate: Number((zeroResult.length / totalQueries).toFixed(3)),
    averageResultsPerUsefulQuery: Number(avgResults.toFixed(1)),
    priorityTermsCoverage: `${priorityResults.length - priorityZero.length}/${priorityResults.length}`,
    coverageByCategory: Object.fromEntries(Object.entries(byCategory).map(([key, value]) =>
      [key, `${value.withResult}/${value.total}`])),
    zeroResultTerms: zeroResult.map((r) => `${r.term} (${r.category})`),
    noUsefulResultTerms: noUsefulResult.map((r) => `${r.term} (${r.category})`),
    firestorePerformance: {
      queries: totalQueries, totalReads: results.reduce((sum, result) => sum + result.reads, 0),
      averageReadsPerQuery: Number((results.reduce((sum, result) => sum + result.reads, 0) / totalQueries).toFixed(1)),
      latencyMs: { average: Number((results.reduce((sum, result) => sum + result.latencyMs, 0) / totalQueries).toFixed(1)),
        p50: percentile(0.5), p95: percentile(0.95), max: sortedLatencies[sortedLatencies.length - 1] ?? 0 },
      pagination,
    },
    perTerm: results,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
