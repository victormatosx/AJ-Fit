# Limitation Data Readiness — Gate A

> **Gate histórico superado para a política de produto em 2026-08-26.** A
> governança atual distingue `approved + product_policy` de
> `approved + professional_review`; ver `01_LIMITATION_SCHEMA.md` e
> `16_PHASE3_V2_FINAL_READINESS.md`. Continua verdadeiro que não há aprovação
> clínica profissional nem profile persistido.

Data da revalidação: 2026-08-25.

Resultado: `BLOCKED_PENDING_PROFESSIONAL_REVIEW`.

Este relatório é o gate anterior a qualquer persistência de
`limitationProfile`. Nenhum profile foi escrito e nenhuma classificação de
triagem foi promovida a decisão clínica.

Atualização documental: `08_PHASE1_PROPOSED_DATASET.json` agora oferece as 497
decisões heurísticas solicitadas para revisão. O arquivo permanece integralmente
`PROPOSED_PENDING_HUMAN_REVIEW`, não altera este gate e não é payload aprovado.

## Inventário revalidado

Auditoria local e read-only do Firestore `ajfit-2f321`:

| Item | Resultado |
|---|---:|
| documentos em `exercises` | 116 |
| exercícios usados nos T001–T090 | 71 |
| fora dos templates atuais | 45 |
| templates | 90 |
| sessões | 378 |
| referências | 2.108 |
| IDs ausentes/duplicados/inválidos | 0 |
| erros de schema do catálogo live | 0 |

O seed em modo dry-run encontrou 116 documentos existentes, 0 criações, 0
updates e 0 remoções planejadas.

## Readiness dos dados live

| Métrica | Quantidade |
|---|---:|
| documentos com `limitationProfile` | 0 |
| profiles completos | 0 |
| profiles `approved` | 0 |
| profiles `draft` | 0 |
| profiles que podem ser aprovados com evidência atual | 0 |
| `compatible` persistidos | 0 |
| `adapt` persistidos | 0 |
| `avoid` persistidos | 0 |
| `unknown` persistidos | 0 |
| `not_applicable` persistidos | 0 |
| substitutes específicos de limitation | 0 |
| IDs inválidos em profiles | 0 |

Como todos os profiles estão ausentes, a avaliação efetiva fail-safe é:

- 812 pares ausentes/`unknown` no catálogo inteiro (116 × 7);
- 497 pares ausentes/`unknown` no conjunto atualmente usado (71 × 7);
- 812 regiões ausentes no total para fins de aprovação integral.

`missing substitute candidates` não é numericamente avaliável antes de haver
decisões `avoid`: zero candidatos foram aprovados, mas também zero pares foram
formalmente classificados como `avoid`.

## Estado da matriz local

A matriz possui 497 triagens estruturais consistentes:

| Triagem | Quantidade | Pode virar status final automaticamente? |
|---|---:|---|
| `MATERIAL` | 176 | não |
| `NOT_MATERIAL` proposto | 197 | não; exige aprovação antes de `not_applicable` |
| `UNCERTAIN` | 124 | não |

Os 300 pares M+U estão organizados nos Batches 1–3. Os 45 exercícios fora dos
templates formam o Batch 4 porque nenhum deles pode ser tratado como substitute
seguro sem profile integral aprovado.

## Por que o Gate A falhou

Não existe no repositório, no Firestore ou no portal uma fonte profissional
aprovada que converta as triagens em `compatible`, `adapt`, `avoid`, `unknown`
ou `not_applicable`. Também não existe governança definida para `reviewedBy`.

Marcar qualquer profile como `approved` agora exigiria inventar julgamento
clínico e identidade de reviewer. Persistir apenas drafts não desbloquearia o
resolver e adicionaria dados incompletos à produção, contrariando a preferência
documentada.

## Entrada profissional necessária

Para cada um dos 71 exercícios usados:

1. confirmar/rejeitar as sete triagens de relevância, inclusive os 197 N;
2. classificar cada região como `compatible`, `adapt`, `avoid`, `unknown` ou
   `not_applicable`;
3. em `adapt`, indicar uma variante real do catálogo;
4. em `avoid`, fornecer lista ordenada de IDs reais ou registrar
   `missing_exercise_candidate`;
5. aprovar o profile integral sob `musculoskeletal-v1`;
6. fornecer identidade/governança real para `reviewedBy`.

Para qualquer um dos 45 exercícios usado como candidate, repetir a revisão
integral antes de aprová-lo para substituição.

Formato de entrega esperado por par:

```text
exerciseId
exerciseName
region
status
adaptation.kind
adaptation.exerciseId
substituteExerciseIds (ordenados)
candidateStatus
reviewer decision/evidence reference
```

## Partes deliberadamente não executadas

- snapshot/export de pré-write: não necessário porque nenhuma escrita foi
  autorizada;
- dry-run de profiles: existe dataset proposto, mas nenhum dataset aprovado para
  comparar ou persistir;
- write real e read-back: não executados;
- Firestore Rules: não alteradas antes de existir payload final validável;
- `Exercise` types/admin portal: não alterados;
- Limitation Resolver, trace e version bump: não implementados sem dados
  consumíveis;
- T001–T090, questionário, safety, equipment e personalização: inalterados.

## Próximo gate

O próximo marco é receber os profiles profissionalmente revisados dos Batches
1–3 e dos candidatos selecionados do Batch 4. Só então preparar snapshot local,
script idempotente, dry-run de `CREATE_PROFILE/UPDATE_PROFILE/UNCHANGED`, Rules
e testes antes de qualquer write.
