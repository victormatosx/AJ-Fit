# Fase 4 — escrita dos limitationProfiles no Firestore

Data: 2026-08-26.

Resultado: `PHASE_4_COMPLETE`.

## Projeto e estado anterior

- projeto Firestore: `ajfit-2f321`;
- collection: `exercises`;
- documentos existentes: 116;
- documentos com `limitationProfile`: 0;
- documentos-alvo encontrados: 76/76;
- dataset: `15_LIMITATION_PROFILES_TECHNICAL_v2.json`;
- fechamento executável externo restante: 0.

O preflight local revalidou o JSON contra os 116 IDs canônicos antes de
inicializar o cliente Firestore. Foram confirmados 76 IDs únicos existentes,
sete regiões por profile, 532 pares, zero `unknown`, zero autorreferência,
enums válidos, variantes/substitutos existentes, todo `adapt` executável e
governança `approved + product_policy` com schema 1/protocolo
`musculoskeletal-v1`.

## Firestore Rules

`firestore.rules` passou a validar o schema fechado de `limitationProfile` em
escritas admin, preservando leitura autenticada, delete proibido e as demais
proteções de `exercises`. O contrato:

- aceita somente as sete regiões e os quatro statuses persistíveis;
- rejeita `unknown` e campos inesperados;
- exige variante concreta e não autorreferente em `adapt`;
- valida IDs, unicidade e autorreferência dos substitutes;
- aceita `avoid` vazio somente com `missing_exercise_candidate`;
- distingue `product_policy` sem identidade profissional de
  `professional_review` com reviewer/timestamp reais;
- impede remover um profile já persistido por update de cliente admin.

Testes positivos e negativos foram adicionados a
`firestore-tests/exercises.rules.test.ts`. O ruleset não foi publicado: o
arquivo compartilhado contém mudanças preexistentes de outros fluxos e não há
neste repositório um deploy isolado que publique apenas este fragmento com
segurança. A escrita desta fase usou Admin SDK, como previsto pela arquitetura.

## Dry-run anterior à escrita

| Ação | Quantidade |
|---|---:|
| `CREATE_PROFILE` | 76 |
| `UPDATE_PROFILE` | 0 |
| `UNCHANGED` | 0 |
| `BLOCKED` | 0 |
| `ERROR` | 0 |

O modo default, sem `--confirm`, não realizou writes. Os 11 ciclos conhecidos
foram reportados e tratados como não bloqueantes sob substituição V1 não
recursiva. Os 114 `avoid` sem substitute permaneceram válidos e representam o
futuro resultado `NO_SAFE_SUBSTITUTION` quando nenhum candidato for válido.

## Write e read-back

Às `2026-08-26T11:13:25.623Z`, o comando com `--confirm` gravou somente
`limitationProfile` nos 76 documentos existentes, em um único batch atômico.
Não houve criação de exercício, replacement de documento ou delete.

| Verificação de read-back | Resultado |
|---|---:|
| exercises totais | 116 |
| com profile | 76 |
| sem profile | 40 |
| `approved` | 76 |
| `product_policy` | 76 |
| schemaVersion 1 | 76 |
| protocolVersion `musculoskeletal-v1` | 76 |
| com sete regiões | 76 |
| pares | 532 |
| `unknown` | 0 |
| equivalentes semanticamente ao JSON | 76 |
| documentos com campos não relacionados intactos | 116 |
| erros | 0 |

Distribuição persistida:

| Status | Quantidade |
|---|---:|
| `not_applicable` | 214 |
| `compatible` | 66 |
| `adapt` | 138 |
| `avoid` | 114 |
| **Total** | **532** |

Os outros 40 exercícios continuam sem `limitationProfile`; a ausência segue
significando `UNREVIEWED`/fail-closed para o futuro resolver. Nenhum default
artificial foi criado.

## Idempotência

O segundo dry-run, executado às `2026-08-26T11:13:34.686Z`, retornou:

| Ação | Quantidade |
|---|---:|
| `CREATE_PROFILE` | 0 |
| `UPDATE_PROFILE` | 0 |
| `UNCHANGED` | 76 |
| `BLOCKED` | 0 |
| `ERROR` | 0 |

Evidências estruturadas: `17_PHASE3_V2_FIRESTORE_DRY_RUN_REPORT.json` (estado
idempotente final) e `19_PHASE4_FIRESTORE_WRITE_RESULT.json` (plano de escrita
e read-back integral).

## Testes e erros

- dataset direcionado: 1 arquivo, 8 testes aprovados;
- Firestore Rules: 13 arquivos, 316 testes aprovados;
- typecheck do app: aprovado;
- typecheck de Functions: não necessário, pois `functions/` não foi alterado
  por esta fase;
- `git diff --check` global: aprovado.

O primeiro acionamento do emulador foi interrompido antes dos testes porque o
Firebase CLI atual exige Java 21 e o shell apontava para Java 17. A suíte foi
reexecutada com o JDK 21 já instalado e passou integralmente. Não houve erro de
preflight, write ou read-back.

## Arquivos da fase

- `firestore.rules`;
- `firestore-tests/exercises.rules.test.ts`;
- `scripts/limitationProfilesPhase3.ts`;
- `scripts/seedExerciseLimitationProfiles.ts`;
- `00_README.md`;
- `16_PHASE3_V2_FINAL_READINESS.md`;
- `17_PHASE3_V2_FIRESTORE_DRY_RUN_REPORT.json`;
- `18_PHASE4_FIRESTORE_WRITE_REPORT.md`;
- `19_PHASE4_FIRESTORE_WRITE_RESULT.json`.

O emulador também regenerou o arquivo de log rastreado
`firestore-debug.log`; somente whitespace final desse log foi normalizado para
o check global. As demais alterações preexistentes do worktree foram
preservadas.

T001–T090, Limitation Resolver, questionário e UI não foram alterados. Nenhum
commit ou push foi realizado.

## Gate final

`PHASE_4_COMPLETE`: 116 exercises preservados, 76 profiles íntegros, 40 sem
profile, 532 pares, distribuição conferente, zero `unknown`, JSON/Firestore
equivalentes, testes aprovados, idempotência comprovada e nenhum campo não
relacionado alterado.
