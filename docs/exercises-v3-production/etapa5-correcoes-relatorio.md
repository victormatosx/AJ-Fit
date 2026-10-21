> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapas 5A + 5B: relatório de correções V3

Referência: `docs/exercises-v3-production/etapa4-auditoria-final.md`. `ACTIVE_SUBSTITUTION_POLICY` permanece `'legacy'`. Nenhum dos 41 rascunhos foi ativado. Nenhuma das 80 relações da categoria C foi tocada. Nenhum commit/push/deploy/escrita real.

## 1. Arquivos modificados

**5A (P0 — política por sessão):**
- `src/workoutExecution/types.ts` — novo campo opcional `substitutionPolicySnapshot?: SubstitutionPolicyVersion` em `WorkoutExecution`.
- `src/services/workoutExecutions.ts` — snapshot da política no momento da criação, gravado no `base` (mesmo padrão de `mutexProtocolVersion`), leitura de volta em `fromDoc` sem default implícito.
- `functions/src/workoutLifecycle/exerciseSubstitution.ts` — nova função `substitutionPolicyFor(execution)` (fallback hardcoded `'legacy'`, nunca a constante global), usada nos dois pontos que decidem elegibilidade.
- Testes: `functions/src/workoutLifecycle/__tests__/exerciseSubstitution.test.ts`, `src/services/__tests__/workoutExecutions.integration.test.ts`.

**5B (categorias B e D):**
- `scripts/importSubstitutionsV3.py` — mescla um addendum editorial pós-planilha, validado e rastreável.
- `docs/substitutions-v3/editorial-exceptions-addendum.json` (novo) — as 9 exceções efetivamente concedidas, com motivo e proveniência.
- `docs/substitutions-v3/dataset.json`, `docs/substitutions-v3/integrity-report.json` — regenerados.
- `src/workoutPrescription/substitutionPolicyV3.ts` — campo `source?` em `EditorialExceptionV3` (distingue exceção da planilha de exceção do addendum).
- Teste: `src/workoutPrescription/__tests__/substitutionPolicyV3.test.ts` (números atualizados + novo bloco de 4 testes para as 9 relações recuperadas).

## 2. Como o P0 foi corrigido

A política de substituição é gravada em `substitutionPolicySnapshot` no momento exato da criação/reinício da execução (nunca em sessões apenas retomadas) e nunca mais recalculada da constante global. O backend lê esse campo com fallback **hardcoded** para `'legacy'` — nunca a constante global — então qualquer execução escrita antes desta mudança permanece em `legacy` para sempre, independente de uma futura virada de flag. O callable nunca escreve esse campo de volta (sua única escrita na execução é `{exercises, updatedAt}`), então a política fixada não pode ser alterada depois de criada. Cliente antigo e sincronização offline não são afetados — nenhum deles jamais manda política, e sem o campo o padrão é sempre `legacy`.

## 3. Relações B liberadas

**9 de 51.** Apenas os casos em que `movement.pattern` e `target.primaryMuscle` já eram idênticos entre âncora e candidato, divergindo só em `movement.mechanic` — o mesmo critério técnico (não clínico) que já valia para as 120 exceções da planilha. As outras **42** (que também divergem em padrão de movimento) permanecem bloqueadas, sem liberação automática, pendentes de revisão editorial.

## 4. Relações D resolvidas

**0 de 50.** As 50 ocorrências decorrem de **10 exercícios distintos** sem `limitationProfile` (`bulgarian-split-squat-machine`, `cable-lateral-raise`, `cable-skull-crusher`, `face-pull`, `incline-dumbbell-curl`, `lat-pulldown-supinated-grip`, `leg-press-45-unilateral`, `low-cable-row-close-supinated-grip`, `seated-calf-raise-machine`, `stiff-leg-deadlift-machine`). Nenhum perfil foi inventado. Todas as 50 permanecem bloqueadas, documentadas como dependentes de validação profissional.

## 5. Cobertura V3 — antes/depois

| Cenário | Antes (Etapa 4) | Depois (Etapa 5) |
|---|---:|---:|
| Sem limitações | 102/102 | 102/102 |
| Uma limitação | 117/714 | **117/714 (inalterado)** |
| Combinações não vazias | 321/12.954 | **321/12.954 (inalterado)** |
| Relações elegíveis (de 1.156) | 718 | **727 (+9)** |
| Das 221 rejeições originais, recuperadas | 18 | **27 (+9)** |

A tabela de templates/regiões não mudou porque as 9 relações liberadas são todas de contexto `common` (substituição geral), não `musculoskeletal` — o critério que o usuário pediu para não forçar ("não force aumento de cobertura relaxando regras") foi respeitado: nenhuma regra foi relaxada, e o número onde a correção realmente se aplica (relações elegíveis / 221 recuperadas) subiu exatamente pela quantidade justificada.

## 6. Resultado dos testes

- `npm run typecheck` (app e functions): limpo.
- `npx eslint` nos arquivos tocados: 0 erros.
- Suíte completa do app: **44 falhas — as mesmas 16 arquivos já documentados**, 7.904 passaram (+4), 232 ignorados (+4, os novos testes de emulador contados como skip numa run normal). Nenhuma falha nova.
- Suíte completa do backend: **0 falhas**, 2.026 passaram (+4), 391 ignorados.
- Suíte de integração com emulador Firestore real (`npm run test:integration:workoutExecution`, JAVA_HOME apontado para o JDK 21 já instalado): **69 de 87 testes falharam com `PERMISSION_DENIED: maximum of 1000 expressions to evaluate` — um limite do próprio motor de regras do emulador, não relacionado a esta mudança.** Confirmado pré-existente e ambiental: testes completamente não relacionados (cardio, mutex, agenda flexível) falham com o mesmo erro. O único dos meus 4 novos testes que não depende das Rules completas (`withSecurityRulesDisabled`, documento legado sem o campo) passou limpo. Não investigado a fundo por estar fora do escopo desta correção — registrado como pendência de ambiente, não do código.

## 7. Pendências restantes

- 42 relações B e 80 relações C seguem bloqueadas, pendentes de revisão editorial/clínica.
- 50 relações D (10 exercícios) seguem bloqueadas, pendentes de perfil musculoesquelético profissional.
- A suíte de integração com emulador Firestore não pôde ser validada nesta sessão (limite do motor de regras do emulador) — recomendo reexecutá-la num ambiente com firebase-tools/emulador atualizados antes da homologação em aparelho.
- Nenhum dos bloqueadores arquiteturais de ativação (`V3_ACTIVATION_BLOCKERS`) foi removido — isso não era objetivo desta etapa.

**V3 segue desativada. Aguardando autorização para a próxima etapa.**
