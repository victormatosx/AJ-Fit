# Exercise limitation metadata

Este diretório reúne os contratos e evidências do rollout. A Fase 4 persistiu
os 76 profiles aprovados por política de produto; isso não representa revisão
clínica nem liberação clínica universal.

Auditoria atual:

- 116 exercícios canônicos: 71 usados nos T001–T090 e 45
  `OUT_OF_CURRENT_TEMPLATE_SCOPE`;
- read-back da Fase 4 confirmou 116 documentos alinhados ao seed: 76 com
  `limitationProfile` e 40 sem profile (`UNREVIEWED`/fail-closed);
- comentários históricos em `exercisesSeedData.ts`/`types/exercise.ts` ainda
  mencionam 79 documentos; testes, seed e Firestore confirmam que esse número
  textual está obsoleto (não foi alterado nesta fase documental);
- 90 templates, 378 sessões e 2.108 referências confirmadas;
- 7 regiões enumeráveis; `other` permanece resposta fail-safe não matricial;
- 497 pares dos exercícios usados triados em 176 `MATERIAL`, 197
  `NOT_MATERIAL` e 124 `UNCERTAIN`;
- 300 pares `MATERIAL + UNCERTAIN` na fila profissional;
- 0 perfis profissionalmente aprovados; os 76 persistidos usam
  `approved + product_policy`, sem identidade profissional fictícia;
- dataset de Fase 1 proposto para os 71 exercícios, com 497 decisões marcadas
  `PROPOSED_PENDING_HUMAN_REVIEW`; nenhuma decisão foi promovida a aprovação;
- DR-004 `RESOLVED_IMPLEMENTED_V1`; DR-006 resolvido para comportamento de
  produto V1 por `approved + product_policy`, sem alegar revisão profissional.

Arquivos:

1. `01_LIMITATION_SCHEMA.md` — contrato proposto.
2. `02_EXERCISE_REVIEW_MATRIX.md` — inventário integral dos 116 exercícios.
3. `03_SUBSTITUTION_STRATEGY.md` — interseção e resolução.
4. `04_UNRESOLVED_REVIEWS.md` — fila profissional concreta e famílias.
5. `05_CATALOG_GAPS.md` — gaps confirmados/candidatos.
6. `06_MUSCULOSKELETAL_RELEVANCE_MATRIX.md` — matriz dos 71 usados, ranking
   por impacto e 45 exercícios fora do escopo atual.
7. `07_LIMITATION_DATA_READINESS.md` — revalidação live e resultado do Gate A
   antes de Firestore/runtime.
8. `08_PHASE1_PROPOSED_DATASET.json` — 71 propostas integrais para revisão
   humana, sem uso em runtime.
9. `09_PHASE1_PROPOSED_REVIEW_SUMMARY.md` — contagens, pendências e prioridades.
10. `generate_phase1_proposal.mjs` — gerador/validador documental offline; não
    inicializa Firebase.
11. `10_EVIDENCE_INFORMED_LIMITATION_DATASET_v2.json` — versão intermediária,
    não normativa quando divergir da V3.
12. `11_GENERALIZED_CONSERVATIVE_LIMITATION_DATASET_v3.json` — fonte final de
    decisão de produto para a Fase 3.
13. `12_LIMITATION_PROFILES_TECHNICAL_v1.json` — payload técnico `draft` para
    futura persistência pontual.
14. `13_PHASE3_DRY_RUN_AND_READINESS.md` — auditoria, dependências e veredito.
15. `14_PHASE3_FIRESTORE_DRY_RUN_REPORT.json` — comparação read-only contra a
    collection real.
16. `15_LIMITATION_PROFILES_TECHNICAL_v2.json` — fechamento executável mínimo
    com 76 profiles e governança `approved + product_policy`.
17. `16_PHASE3_V2_FINAL_READINESS.md` — readiness final para a escrita.
18. `17_PHASE3_V2_FIRESTORE_DRY_RUN_REPORT.json` — novo dry-run read-only dos
    76 profiles contra o Firestore real.
19. `18_PHASE4_FIRESTORE_WRITE_REPORT.md` — auditoria do write, read-back,
    testes e gate final da Fase 4.
20. `19_PHASE4_FIRESTORE_WRITE_RESULT.json` — evidência estruturada do write e
    da equivalência semântica do read-back.
21. `20_PHASE5_LIMITATION_RESOLVER.md` — arquitetura, semântica, testes e gate
    do resolver V1 integrado ao Prescription Engine.
