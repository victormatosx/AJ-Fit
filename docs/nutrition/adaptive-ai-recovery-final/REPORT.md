# AJ Fit — recuperação adaptativa de IA

## Inventário inicial — Codex, 22/10/2026

Branch `treinos`, HEAD `3d731c9200d3d1ba454c76a0ce0bc2bcbdc7169b`, sem alterações staged. Working tree anterior preservado; patch inicial em `/tmp/ajfit-adaptive-initial-tracked.patch`.

| Etapa encontrada | Classificação | Evidência |
| --- | --- | --- |
| Constantes 5 chamadas / US$ 0,04 | IMPLEMENTADA, MAS NÃO VALIDADA | `ai/config.ts`, alteração Claude |
| Caminho D | CONCLUÍDA E VALIDADA no desenho anterior | teste unitário/integrado Claude + 2 jobs reais aprovados com 5 chamadas |
| Elegibilidade estrita/persistida | NÃO INICIADA | Apenas argumento de paridade; retries de revisão também atingem 5 |
| Reserva de capacidade de revisão | PARCIALMENTE IMPLEMENTADA | Guard de chamadas existe, falta admissão financeira do par |
| Reservas transacionais/idempotência | IMPLEMENTADA, MAS NÃO VALIDADA nesta continuação | `callBudget.ts`, preexistente |
| Testes determinísticos Claude | CONCLUÍDA E VALIDADA historicamente | transcript: 2105 unitários, 340 nutrição/emulador, TypeScript Functions |
| Homologação Claude | PARCIALMENTE IMPLEMENTADA | 17 jobs sintéticos, 2 interrupções/timeouts, cenário glúten não iniciado nesta tarefa |
| Deploy adaptativo | ESTADO DESCONHECIDO inicialmente | nenhum deploy no transcript; consulta remota capturada |
| Relatório final | NÃO INICIADA | arquivo ausente na retomada |

O arquivo do agente `a0d2cf9adc9ca6d7c` existe como symlink para JSONL do Claude. A execução parou após leitura dos últimos jobs de alergia ao leite; não concluiu relatório nem demonstrou publicação. Não existe homologador ativo na inspeção de processos. Emulador antigo `demo-ajfit-dual-ai` continua aberto; um job sintético ficou `running` sem processo consumidor.

Resultados e custos finais estão nas seções de validação e homologação abaixo. Os artefatos recuperados são históricos: não validam automaticamente a implementação corrigida pelo Codex.

## Evidências recuperadas e autoria

Claude alterou somente as constantes e os testes de revisão unitários/integrados nesta tarefa adaptativa (confirmado pelo status inicial do transcript e pelas operações `Edit`). O otimizador de porções, os ajustes de segurança em `restrictions.ts`, a correção/diagnóstico/domínio e seus testes já existiam antes do início do agente adaptativo. Foram preservados.

O agente concluiu os testes históricos, executou uma primeira rodada vegetariana interrompida pelo timeout do comando, repetiu 8 vegetarianos, depois iniciou 8 casos de alergia legada ao leite. Os últimos dois casos de leite tiveram timeouts; o último job ficou `running` sem consumidor. Não houve execução de glúten nessa tarefa adaptativa. O JSON de resultados em `/tmp` foi sobrescrito entre rodadas; as operações e os jobs do emulador permitiram reconstruir os casos anteriores. Cópias dos logs, JSON de leite e ledger foram preservadas neste diretório. Não foram recuperados resultados brutos de API das chamadas sem usage.

O argumento de paridade escrito pelo Claude estava incorreto: uma criadora seguida de quatro falhas de transporte/schema da revisora também alcançava cinco chamadas. Os próprios testes alterados pelo Claude exigiam esse comportamento. Portanto, constantes + contador persistido não atendiam à elegibilidade autorizada.

## Implementação concluída pelo Codex

- `generation/adaptiveRecovery.ts`: predicado fechado sobre eventos estruturados, com sequência e números de tentativa/chamada exatos.
- `generation/attempts.ts`: orçamento normal de quatro chamadas; par excepcional condicionado; admissão financeira do par; checkpoint e restauração de feedback.
- `generation/callBudget.ts`: revalidação transacional, crédito único reservado na chamada 4, reserva da chamada 5 apenas após sucesso da criadora final, checkpoints idempotentes e observabilidade por operação.
- `generation/worker.ts` e `mealAlternativeRequest.ts`: integração com o ledger persistido, sem zerar contadores em retomadas.
- `ai/config.ts`: mantém os aumentos autorizados do Claude e corrige a documentação da política.
- Testes `adaptiveRecovery.test.ts`, `independentReview.test.ts`, `independentReview.integration.test.ts`: elegibilidade, custo do par, retomada, concorrência, replay, falhas e limite absoluto.
- `adaptiveRecoveryHomologation.manual.test.ts`: um perfil por execução, sem retry HTTP paralelo/oculto, checkpoint financeiro antes da chamada e teto agregado incluindo Claude.

Nenhuma alteração do Codex em UI, endpoints de treino, Rules, assinatura ou limites/modelos de tokens.

## Arquitetura final e política adaptativa

Criadora → validação determinística de schema/restrições/nutrientes → otimizador por alimento (fallback uniforme) → revisão independente do candidato final/digest → transação de persistência. O desenho de segurança e o otimizador anterior não foram alterados.

O orçamento padrão é quatro chamadas. O crédito só é concedido quando os três eventos anteriores são exatamente:

1. Chamada 1, criadora/tentativa 1: falha determinística recuperável (`AI_SCHEMA_INVALID`, `AI_CONTENT_SAFETY_MISMATCH`, `AI_MACRO_VALIDATION_FAILED`, `AI_EVIDENCE_INSUFFICIENT` ou `AI_CATALOG_RESOLUTION_FAILED`).
2. Chamada 2, criadora/tentativa 2: candidato validado.
3. Chamada 3, revisora/tentativa 2: `rejected` ou `insufficient_information`, com código de falha correspondente.

`insufficient_information` é uma decisão negativa que exige regeneração, não uma falha de transporte nem aprovação. É explicitamente elegível; os dois casos reais recuperados usaram esse status.

Na transação que reserva a chamada 4, o backend verifica o histórico persistido, `aiRecoveryCreditUsed !== true`, lease/status, contagem sequencial e dólares para criação **e** revisão. Marca `aiRecoveryCreditUsed=true`, `aiRecoveryGrantedAtCall=4`, versão 1. A chamada 5 exige esse crédito e a validação bem-sucedida da criadora na chamada 4. Crédito consumido não é devolvido, mesmo em crash. Retentativas de rede/schema da revisora não recebem crédito.

Campos persistidos: `aiRecoveryHistory` (máximo cinco fatos, sem texto livre), `aiRecoveryCreditUsed`, `aiRecoveryGrantedAtCall`, `aiRecoveryPolicyVersion`, além dos contadores/custo preexistentes. `aiRetryFeedback` conserva o contexto de correção no documento privado do job para a retomada; não é emitido em logs. Os fatos de elegibilidade nunca dependem desse texto. Operações registram `recoveryCreditUsed`/`recoveryPolicyVersion`.

## Verificação formal dos caminhos

C = criadora; R = revisora; F = falha determinística; N = revisão negativa; A = aprovação.

| Caminho | Sequência de chamadas | Guards de entrada das criadoras | Total reservado máximo |
| --- | --- | --- | --- |
| A | C1 → R2(A) | 0 + 2 ≤ 4 | US$ 0,01435 |
| B | C1 → R2(N) → C3 → R4(A) | 0 + 2 ≤ 4; 2 + 2 ≤ 4 | US$ 0,02870 |
| C | C1(F) → C2 → R3(A) | 0 + 2 ≤ 4; 1 + 2 ≤ 4 | US$ 0,02155 |
| D | C1(F) → C2 → R3(N) → C4 → R5(A) | 0 + 2 ≤ 4; 1 + 2 ≤ 4; 3 + 2 ≤ 5 **somente com crédito** | US$ 0,03590 |
| E | C1(F) → C2(F) → C3 → R4 | 0/1/2 + 2 ≤ 4; três tentativas no máximo | US$ 0,02875 |
| F | C1 → R2(N) → C3 → R4(N) | nova criadora exigiria 4 + 2, proibido | US$ 0,02870 |
| Infra | C1 → R2(erro) → R3(erro) → R4(erro) | nenhum crédito; termina com quatro | US$ 0,02865 |

Cada criadora exige também `reservado + US$ 0,0072 + US$ 0,00715 ≤ US$ 0,04`. A revisão consome sua própria reserva posteriormente. `MAX_AI_ATTEMPTS=3` permite as três criadoras de D; máximo absoluto `MAX_AI_CALLS=5`. Nunca existe aprovação por esgotamento.

## Persistência, concorrência e recuperação

A reserva pessimista e a operação `pending` são gravadas atomicamente antes do HTTP. Lease owner + contador sequencial + criação exclusiva do ID da operação impedem dois consumidores de reservar a mesma chamada. Um checkpoint elegível após a chamada 3 pode ser retomado por outro worker usando tentativa 3, feedback e custo já persistidos. Histórico ausente/descontínuo não confere crédito a jobs legados.

Se o processo morrer **depois** da reserva de uma chamada mas antes do checkpoint de seu resultado, a chamada pode ficar pendente e sua reserva permanece consumida. Sem candidato validado recuperável, o worker não repete essa chamada potencialmente paga e pode encerrar o job com falha segura. A recuperação garante limites e segurança; não promete concluir todo job interrompido. O plano anterior só é arquivado dentro da transação que ativa o novo plano aprovado. Falhas preservam o plano anterior.

O digest continua sendo calculado sobre o envelope revisado (incluindo ingredientes/evidências disponíveis ao backend), e as porções/nutrientes persistidos vêm do mesmo candidato validado. Nenhuma mutação pós-revisão foi introduzida. Isso não equivale a recalcular o digest diretamente do documento de plano, cujo schema não retém todos os ingredientes do envelope de revisão.

## Homologação histórica recuperada — Claude

| Cenário | Execuções | Aprovações | Falhas/pendências | Uso da quinta chamada |
| --- | --- | --- | --- | --- |
| Vegetariano, batch concluído | 8 | 3 (37,5%) | 5 | 2 jobs: 1 aprovado, 1 rejeitado |
| Vegetariano, comando anterior interrompido | 1 | 0 | 1 falha posterior no ledger | 0 |
| Alergia legada ao leite | 8 | 4 (50% de todos os iniciados) | 2 falhas de geração + 2 timeouts/infra (um `running` órfão) | 1 aprovado |
| Glúten / vegano / múltiplas / sem restrição | 0 nesta tarefa | — | não executados pelo Claude | — |

O JSON de leite contém apenas seis casos concluídos pelo harness: 4/6; não usar esse subconjunto para ocultar os dois timeouts. O total reconstruído é 17 jobs, 7 aprovações. As latências/custos conhecidos de cada chamada estão em `recovered-ledger.json`; para os timeouts não há custo real exato verificável.

Recuperações reais por cinco chamadas: vegetariano `11469d26-8054-4325-8c3f-a27b548519b8` e leite `7faae5a4-944a-47bd-958f-d95cee97844b`. Ambos possuem o prefixo exato aceito pela política final: falha determinística → criadora válida → revisão `insufficient_information` → criadora corrigida → revisão aprovada. Sob quatro chamadas, o guard impediria a criação final após a terceira chamada. O vegetariano `0552c0dc-2132-468f-a66a-6bb4215aa85f` usou cinco e terminou rejeitado: o crédito não força aprovação.

Esses resultados provam recuperações individuais úteis. Não provam melhora estatística de taxa: o batch vegetariano permaneceu 3/8; as amostras são pequenas e independentes.

## Reconstrução financeira

`budget-reconstruction.json` separa estimativa conhecida de teto conservador. Há 57 reservas sintéticas reais da tarefa interrompida, somando US$ 0,40955. O harness antigo podia invocar o provedor até duas vezes por reserva (`withBackoff`), sem contabilizar a primeira falha na soma de tokens. Assim, há até 114 tentativas HTTP e um teto conservador de **US$ 0,81910** para todo o Claude desta tarefa. Isso inclui a execução interrompida inicial e os dois timeouts de leite; não soma o histórico vitalício do emulador.

Usage recuperado estima US$ 0,07107356; **esse valor não é faturamento total exato**. O orçamento da continuação considera US$ 0,81910 já consumidos, sem reembolso, e deixa pelo menos US$ 1,18090 dos US$ 2,00 originais. Esse limite superior é usado pelo novo harness antes de cada chamada. Não houve nova autorização de US$ 2,00. Custos de tarefas anteriores independentes dos relatórios históricos não são confundidos com esta tarefa adaptativa.

## Testes determinísticos e integração — Codex

| Verificação | Resultado observado |
| --- | --- |
| Functions completas, execução final após instrumentação | 2.123 passaram; 456 skipped; zero falhas |
| Nutrição + Firestore Emulator, código final em `demo-ajfit-adaptive-final-tests` | 364 passaram; 38 skipped; zero falhas |
| App `src/nutrition` + teste isolado de relógio `recentAuth` | 498 passaram (490 nutrição + 8 autenticação) |
| App completo | 7.609 passaram; 23 falharam; 221 skipped |
| TypeScript Functions (compilador local 5.6.3) | passou |
| TypeScript aplicativo (script `npm run typecheck`) | passou |
| Compilação Functions (`tsc -p tsconfig.build.json`) | passou |

Os testes novos cobrem o Caminho D tanto em memória quanto na transação real do emulador; crédito ausente em falhas permanentes/infra; revisão negativa na quinta chamada; falha da criadora final; custo sem margem para revisão; histórico faltante/desordenado; crédito já consumido; concorrência e replay; lease antigo; checkpoint de feedback; retomada de job elegível; job legado sem provas; crash após reserva; falha gRPC de checkpoint sem chamada adicional. Os testes anteriores de segurança alimentar, porções, digest e persistência continuam passando.

As 23 falhas do aplicativo são em 14 arquivos fora de nutrição (telas de treino/saúde/perfil/paywall, assinatura, Live Activity, load progress, tema, schedule e relógio de autenticação). `git diff HEAD -- src modules ios android` está vazio; nenhum desses códigos foi alterado nesta tarefa ou pelo agente adaptativo. O caso `recentAuth` passou isoladamente, apontando sensibilidade temporal; as outras 22 correspondem à dívida documentada em relatórios anteriores. Não foram corrigidas fora de escopo e **não** são apresentadas como suíte completa aprovada. Logs completos preservados como artefatos de validação.

Foi feita uma tentativa de checagem Functions usando por engano o compilador raiz TypeScript 6, que reportou a depreciação `moduleResolution=node10`. A checagem correta com o compilador próprio de Functions passou; nenhuma configuração foi alterada para silenciar o erro. O build de Functions foi apenas TypeScript local, sem EAS/TestFlight.

`historical-policy-verification.json` foi gerado executando o predicado **final** sobre os prefixos recuperados do Claude: os dois jobs reais aprovados com cinco chamadas são elegíveis, assim como o terceiro que terminou rejeitado. Não se inferiu elegibilidade somente do número de chamadas.

## Revisões remotas e publicação anterior

Inventário remoto completo em `remote-before.json`: projeto `ajfit-2f321`, região `us-central1`, runtime Node.js 22. As quatro revisões relacionadas estavam publicadas desde 21/10/2026, aproximadamente 23:45 UTC, antes de o agente adaptativo iniciar às 01:55 UTC de 22/10:

| Function | Revisão encontrada |
| --- | --- |
| `requestNutritionPlanGeneration` | `requestnutritionplangeneration-00011-zij` |
| `onNutritionGenerationJobCreated` | `onnutritiongenerationjobcreated-00029-saw` |
| `retryNutritionGenerationJobs` | `retrynutritiongenerationjobs-00025-juq` |
| `requestNutritionMealAlternative` | `requestnutritionmealalternative-00025-yep` |

Esses números seguem as revisões do otimizador (`...00010`, `...00028`, `...00024`, `...00024`) e são compatíveis com o deploy do fix de alergênico da homologação de estabilidade. Não há revisão posterior ao início adaptativo nem chamada de deploy no transcript recuperado. Isso distingue a publicação anterior de segurança da mudança adaptativa não publicada pelo Claude. Inventário também registra as demais Functions, incluindo treino, para comparação posterior.

O código efetivamente publicado foi baixado da versão imutável `gs://gcf-v2-sources-753375043967-us-central1/onNutritionGenerationJobCreated/function-source.zip#1792626313981990`. Inspeção de `lib/nutrition/ai/config.js` confirmou **4 chamadas / US$ 0,03**, eliminando a hipótese de a política adaptativa já estar publicada. Arquivo local `/tmp/ajfit-adaptive-rollback-source.zip`, hash e metadados em `rollback-source.json`.

Rollback preparado: preservar essa fonte/revisões antes de qualquer atualização; em caso de regressão após publicação, restaurar o tráfego de cada um dos quatro serviços para a revisão anterior da tabela e redeployar as mesmas quatro Functions a partir da fonte arquivada para reconciliar o estado do Firebase. Não executar rollback sem necessidade; não restaurar o working tree. Nenhum rollback foi executado nesta continuação.

O crédito aumenta o **teto** em uma chamada, mas permite executar um par que antes era recusado após três chamadas: C4 + R5. Assim, no Caminho D o acréscimo reservado em relação ao job antigo que parava na chamada 3 é US$ 0,01435; em relação ao teto nominal antigo de quatro chamadas, o máximo sobe de US$ 0,02870 para US$ 0,03590. Não confundir essas duas comparações.

O ledger bruto recuperado contém 82 operações desde o início da tarefa, incluindo fixtures determinísticos. A reconstrução financeira faz o join com os 17 jobs `synthetic-stability-*`, resultando nas 57 reservas de homologação; não contabiliza fixtures como gasto real nem usa a soma vitalícia do emulador.


## Homologação real da versão corrigida — Codex

Nove jobs sintéticos observados diretamente, API real `gpt-6-luna`, Firestore Emulator `demo-ajfit-dual-ai`. Foram seis perfis prioritários e, por não ter ocorrido um Caminho D, três execuções adicionais limitadas (leite, vegetariano, leite). Não houve retry HTTP no harness novo nem manipulação de resposta para forçar rejeição/aprovação. Todas as 29 invocações retornaram com usage; nenhum processo ou chamada paga desta continuação ficou pendente.

| Cenário | Execuções | Aprovadas / falhas | Chamadas por execução | Créditos usados | Custo estimado conhecido (US$) | Latência média do job | Causa final de falha |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vegetariano | 2 | 1 / 1 | 3, 4 | 0 | 0.00975464 | 86.1s | AI_SCHEMA_INVALID |
| Alergia legada ao leite | 3 | 1 / 2 | 2, 3, 4 | 0 | 0.01129206 | 74.1s | AI_MACRO_VALIDATION_FAILED, AI_REVIEW_REJECTED |
| Exclusão de glúten | 1 | 0 / 1 | 3 | 0 | 0.00477156 | 75.4s | AI_EVIDENCE_INSUFFICIENT |
| Veganismo | 1 | 1 / 0 | 3 | 0 | 0.00380084 | 61.1s | — |
| Múltiplas restrições | 1 | 1 / 0 | 3 | 0 | 0.00399524 | 69.8s | — |
| Sem restrições | 1 | 0 / 1 | 4 | 0 | 0.00513376 | 93.3s | AI_REVIEW_REJECTED |

**4/9 aprovados (44,4%), cinco falhas seguras, 29 chamadas, zero créditos utilizados.** Na primeira falha vegetariana ocorreram, em sequência, `AI_CONTENT_SAFETY_MISMATCH`, `AI_MACRO_VALIDATION_FAILED` e `AI_SCHEMA_INVALID`; a coluna acima mostra a causa final, não apaga as anteriores. As falhas de glúten foram três `AI_EVIDENCE_INSUFFICIENT`; o caso sem restrições teve duas falhas de macro, candidato validado na terceira criação e revisão negativa na quarta chamada. No último leite houve duas rodadas completas de criação/revisão rejeitadas: corretamente não admite quinta chamada.

Todos os casos aprovados possuem revisão independente e digest; todos os casos fracassados não criaram plano. Os casos vegano/múltiplas restrições mostraram recuperação após falha inicial, mas terminaram com três chamadas, sem crédito. A revisão negativa real também foi exercitada; **não** ocorreu o prefixo completo elegível do Caminho D nesta rodada final. A versão final demonstrou D em testes determinísticos e no emulador, e aceita os históricos dos dois D reais anteriores, mas não houve um D novo com API real após a correção da persistência/política.

Os resultados não demonstram superioridade estatística, nem regressão causal: as amostras são pequenas, os outputs estocásticos, e o novo orçamento não ajuda falhas repetidas que jamais produzem o prefixo elegível. Não se atribui 44,4% a uma piora causada pela política nem se usam as duas recuperações históricas para declarar a homologação da versão final automaticamente aprovada.

Dados por job, chamadas, créditos, usage, custo, latência, status, digest e operações: `codex-real-ledger.json`. Agregação: `real-summary.json`. Logs do harness estão em `validation/`; “teste passou” significa que as invariantes do job foram verificadas, **não** que a dieta foi aprovada. O status de cada geração está na tabela e no ledger.

## Custo total da tarefa — Claude + Codex

| Medida | US$ |
| --- | --- |
| Claude: estimativa conhecida com usage | 0.07107356 |
| Codex: 29 invocações com usage | 0.03874810 |
| Soma das estimativas conhecidas | 0.10982166 |
| Claude: teto conservador incluindo possíveis retries/timeouts | 0.81910 |
| Codex: reserva integral pessimista | 0.20845 |
| Teto conservador combinado usado no controle financeiro | **1.02755** |
| Saldo mínimo remanescente dos US$ 2,00 originais | **0.97245** |

O faturamento exato total anterior continua não verificável; não se apresenta US$ 0,10982166 como total faturado. O limite superior conservador demonstra margem dentro dos US$ 2,00, incluindo a parcela desconhecida do Claude. Nenhuma autorização foi renovada por troca de agente. Não é necessário gastar o saldo para concluir que a evidência atual é insuficiente para publicação; não foi iniciada uma sequência ilimitada de tentativas buscando um resultado favorável.

## Segurança e riscos residuais

1. As restrições/tolerâncias/otimizador e o revisor independente foram preservados; nenhum bypass ou aprovação por orçamento foi observado. Segurança de persistência, digest e plano anterior foi verificada com cenários adversariais no emulador.
2. A implementação final do crédito ainda precisa de evidência real de um job elegível concluindo a quinta chamada com os novos checkpoints. Os dois casos históricos mostram utilidade potencial e são aceitos pelo predicado final, mas são anteriores à correção do estado persistido.
3. Disponibilidade segue variável: falhas de macro, evidência e revisão fora do Caminho D não são recuperadas pelo crédito e não devem ser mascaradas ampliando limites ou enfraquecendo validação. Nenhuma nova investigação de prompt/modelo foi iniciada fora do escopo autorizado.
4. Crashes após reserva podem consumir capacidade sem conclusão do job; reservas nunca são reembolsadas nem chamadas potencialmente pagas repetidas. Esse comportamento seguro está documentado e testado.
5. A suíte geral do aplicativo tem 23 falhas fora de nutrição (uma sensível ao relógio, passada isoladamente), que precisam de tratamento em suas respectivas frentes. Não foram revertidas alterações para obter uma suíte artificialmente verde.
6. Estimativa de custo usa a tabela versionada do projeto; não é extrato de faturamento. A parcela desconhecida do Claude está protegida pelo teto conservador, sem duplicar orçamento.

## Decisão de publicação e veredito

**NÃO APROVADA para liberação. Nenhum deploy realizado pelo Codex.** Implementação concluída e testes determinísticos/de integração aprovados; homologação de liberação ainda insuficiente. A rodada final não exercitou o crédito com API real e mostrou falhas de disponibilidade relevantes. Publicar agora confundiria a prova histórica de utilidade com uma validação completa da nova política persistida.

Produção permanece com quatro chamadas e US$ 0,03. O código local tem cinco chamadas, US$ 0,04 e elegibilidade transacional. As Functions cuja execução efetivamente muda são `onNutritionGenerationJobCreated`, `retryNutritionGenerationJobs` e `requestNutritionMealAlternative`; a callable de solicitação foi inventariada, mas seu código de criação de jobs não foi alterado nesta continuação. Não houve publicação redundante.

**Pronto para testes finais da recuperação adaptativa dentro do aplicativo: ainda não.** Falta validar a quinta chamada real na versão final e obter evidência suficiente para a decisão de liberação; só então publicar as Functions afetadas e homologar geração, correção, aprovação e preservação do plano no cliente. Testes locais/de desenvolvimento podem usar a implementação já pronta, sem afirmar que produção a executa. As falhas gerais do app não foram ocultadas.

O resultado desta continuação é uma recuperação verificável do trabalho, a correção da implementação parcial, testes concluídos, homologação limitada/documentada e a decisão segura de não publicar. A pendência de liberação está explícita; não se declara o objetivo de produção alcançado.

## Estado final do repositório e dos ambientes

- Branch `treinos`; HEAD permanece `3d731c9200d3d1ba454c76a0ce0bc2bcbdc7169b`; staging vazio. Nenhum commit ou push.
- `repository-final.json` registra o status completo. Diffs pré-existentes de `correction.ts`, `diagnostics.ts`, `domain.ts`, `restrictions.ts` e `generation.test.ts` comparados ao patch inicial: **idênticos**. Otimizador e relatórios antigos preservados. `firestore-debug.log` manteve o conteúdo anterior e cresceu durante os testes; não foi limpo/resetado.
- Mudanças de produção do Codex: `attempts.ts`, `callBudget.ts`, `worker.ts`, `mealAlternativeRequest.ts`, ajuste dos comentários/constante base em `ai/config.ts` e novo `adaptiveRecovery.ts`. Testes de revisão existentes ampliados; novos `adaptiveRecovery.test.ts` e harness manual `adaptiveRecoveryHomologation.manual.test.ts`. Relatório e evidências neste diretório.
- `git diff HEAD -- src modules ios android` vazio. Rules, assinatura, endpoints de treino e UI não foram modificados. Nenhum EAS/TestFlight.
- `remote-final.json` comparado por nome, `updateTime` e revisão com `remote-before.json`: **todas as Functions inalteradas**, incluindo treino e nutrição. Não houve deploy nem rollback.
- `legacy-jobs-final-state.json`: os 17 jobs antigos mantêm os mesmos status e contadores da captura inicial. O job órfão antigo foi preservado para investigação; não foi reexecutado nem apagado.
- Os nove jobs novos são terminais, sem chamadas pendentes. Nenhum Vitest/homologador continua consumindo API. O emulador e a sessão Claude preexistentes não foram encerrados nem usados para execução autônoma.
- Logs de validação em `validation/`; saída completa do app em `validation/app-full.log.gz` e lista de falhas em `validation/app-failures.json`. `git diff --check -- functions/src/nutrition` passou. A documentação Expo v56 exigida pelo AGENTS foi consultada antes de escrever código; nenhuma dependência/versão Expo foi alterada.

Inventário final: implementação, política, limites, concorrência, idempotência, recuperação segura, revisão/digest e testes locais **concluídos e validados**; nove homologações finais **executadas e registradas**, mas evidência de liberação **insuficiente**; publicação **não realizada por decisão de segurança operacional**, não por suposição sobre o trabalho anterior.


## Homologação final de liberação — Codex

### Plano fechado antes de chamadas pagas

Estado inicial: mesma branch `treinos` e HEAD `3d731c9200d3d1ba454c76a0ce0bc2bcbdc7169b`; alterações anteriores preservadas, staging vazio. Código produtivo inventariado por SHA-256 em `release-homologation/production-source-before.json`. Nenhuma nova implementação adaptativa será feita.

Reconciliação em `release-homologation/reconciliation-before.json`: 57 operações Claude com teto US$ 0,81910 + 29 chamadas Codex com reservas US$ 0,20845 = **US$ 1,02755**; saldo mínimo **US$ 0,97245**. Ledger temporário e arquivo anterior idênticos; nove jobs Codex anteriores e suas 86 operações combinadas com Claude sem mudanças; nenhum job sintético posterior não reconhecido e nenhum homologador ativo. Emulador antigo está acessível. Custos exatos anteriores continuam desconhecidos; o teto conservador é integralmente carregado.

**Limite previamente fixado: nove jobs**, na ordem leite → vegetariano → glúten, repetida três vezes. Perfis idênticos aos anteriores. Reserva adicional máxima US$ 0,36 (9 × US$ 0,04); máximo combinado planejado US$ 1,38755, sem renovar orçamento. Parar antes no primeiro Caminho D aprovado com todas as invariantes verificadas, falha crítica ou indisponibilidade financeira. Não ampliar a amostra após observar resultados. Plano imutável registrado em `release-homologation/PLAN.json`.

A instrumentação será ampliada somente no harness manual: snapshots do estado antes de cada HTTP, respostas reais, digest, correspondência entre candidato revisado e plano persistido, e preservação de um plano anterior sintético. Esse plano anterior é apenas fixture de persistência; não introduz histórico de elegibilidade nem manipula chamadas/resultados de IA.


### Resultados individuais e sequências reais

Rodada encerrada em 2026-10-22T11:18:41.281Z pelo limite previamente fixado de nove jobs. Nenhuma ampliação da amostra. O ledger foi fechado com `stopped=predefined_job_limit_reached`; nenhum processo de homologação foi deixado ativo.

Legenda: C = criadora, R = revisora, F = falha determinística, V = candidato válido, A = aprovação, N = rejeição, I = informação insuficiente.

| Job / perfil | Sequência real | Resultado | Elegível / crédito | Reserva (US$) | Custo estimado conhecido (US$) | Latência do job |
| --- | --- | --- | --- | --- | --- | --- |
| 1 / Leite | C1 F → C2 F → C3 V → R4 I | falha segura | não / não | 0.02875 | 0.00600584 | 114.53s |
| 2 / Vegetariano | C1 V → R2 I → C3 F | falha segura | não / não | 0.02155 | 0.00308994 | 68.91s |
| 3 / Glúten | C1 F → C2 V → R3 A | aprovado | não / não | 0.02155 | 0.00384404 | 80.05s |
| 4 / Leite | C1 F → C2 V → R3 I → C4 F | falha segura | sim / sim | 0.02875 | 0.00588238 | 123.94s |
| 5 / Vegetariano | C1 F → C2 V → R3 A | aprovado | não / não | 0.02155 | 0.00367078 | 87.02s |
| 6 / Glúten | C1 V → R2 A | aprovado | não / não | 0.01435 | 0.00204804 | 50.19s |
| 7 / Leite | C1 F → C2 F → C3 F | falha segura | não / não | 0.02160 | 0.00430618 | 104.66s |
| 8 / Vegetariano | C1 F → C2 V → R3 N → C4 V → R5 N | falha segura | sim / sim | 0.03590 | 0.00613800 | 137.00s |
| 9 / Glúten | C1 F → C2 F → C3 F | falha segura | não / não | 0.02160 | 0.00489588 | 132.50s |

Total: **9 jobs, 3 aprovados, 6 falhas seguras, 30 chamadas HTTP reais**. Dois jobs elegíveis, dois créditos concedidos/persistidos, uma quinta chamada executada, **zero aprovações após crédito**. Não houve mocks, injeção de histórico, alteração de prompts, tolerâncias, porções, modelo ou respostas.

Dados individuais completos em `release-homologation/ledger.json`; agregação em `SUMMARY.json`; um log por execução em `job-1.log` a `job-9.log`. Os nove testes do harness passaram porque verificam invariantes, inclusive falhas seguras — isso não significa nove dietas aprovadas.

### Créditos, quinta chamada, segurança, digest e persistência

**Job 4 — leite**, `1acc03e5-ce9f-4be2-bda6-e541187a3485`: primeira criadora falhou em macros; a segunda validou; a primeira revisão retornou informação insuficiente. A chamada 4 foi reservada com `aiRecoveryCreditUsed=true`, `aiRecoveryGrantedAtCall=4`, histórico estruturado de três eventos e versão de política 1 persistida. A quarta criação falhou em macros. O backend não chamou a revisora sobre esse candidato inválido; encerrou com quatro chamadas e preservou exatamente o plano anterior.

**Job 8 — vegetariano**, `b77ec563-b632-44a3-8c19-62406b908d05`: C1 falhou em macros → C2 validou → R3 rejeitou → C4 validou → R5 rejeitou. Esse é o trajeto real elegível até a quinta chamada, **sem a aprovação final que define o Caminho D bem-sucedido**.

- Antes do HTTP 4, o checkpoint persistido já tinha contador 4, tentativa 3, crédito consumido e o prefixo elegível. Reserva US$ 0,02875; somada à revisão obrigatória de US$ 0,00715, a capacidade exigida era US$ 0,03590 ≤ US$ 0,04.
- Antes do HTTP 5, havia quatro eventos auditados (incluindo C4 válida), contador 5 e reserva US$ 0,03590. A chamada 5 foi realmente enviada ao modelo configurado, em HTTP separado, sem `previous_response_id` e sem retry oculto.
- A revisão 5 tinha contrato válido, digest correto e status `rejected`. A rejeição apontou incoerência entre calorias e macros da preparação de aveia/leite. O candidato tinha sido modificado após a revisão 3: os digests eram diferentes, e a revisão final avaliou a versão corrigida, não reaproveitou um parecer antigo.
- O digest da revisão 3 foi `6330cbf23f26e83370e1ff168034ddc7391fe44c91e027438cb78f8edf710cec`; o da revisão 5 foi `9408152959c229304bc3b471c553636b4983f7c85c2aeb3621c7727224fba2f3`. Ambos foram recalculados sobre os candidatos efetivamente enviados e conferidos contra as respostas reais.
- O resultado permaneceu `failed`, sem novo plano, sem sexta chamada e com o plano anterior intacto. A segurança prevaleceu sobre o esgotamento do orçamento.

As **oito revisões reais** desta rodada tiveram contratos e digests válidos, inclusive as negativas (`review-digest-verification.json`). Nas três aprovações, o harness revalidou o candidato com correção desabilitada e conferiu igualdade exata de refeições e totais com o plano persistido; os planos anteriores foram arquivados somente após a aprovação. Nas seis falhas, o plano anterior e seu apontador ativo ficaram intactos e não houve novo plano.

A checagem das restrições nos candidatos aprovados (um vegetariano e dois sem glúten), a validação determinística e a revisão independente não identificaram alimento incompatível. Não houve aprovação automática nem bypass. Os planos anteriores são fixtures sintéticos de preservação, sem qualquer histórico artificial de elegibilidade.

Snapshots finais lidos diretamente do emulador: `firestore-final-evidence.json`. O digest é do candidato de revisão, que inclui os ingredientes; o documento do plano não retém todos os ingredientes, portanto sua correspondência é verificada pelos campos persistidos, sem fingir que o hash do documento inteiro é o mesmo.

### Custos, latência adicional e utilidade observada

| Medida | US$ |
| --- | --- |
| Teto conservador anterior reconciliado | 1.02755000 |
| Reserva integral desta rodada | 0.21560000 |
| Custo estimado conhecido desta rodada | 0.03988108 |
| Teto conservador combinado da tarefa original | 1.24315000 |
| Soma de custos estimados conhecidos Claude + Codex, todas as rodadas | 0.14970274 |
| Saldo mínimo conservador remanescente dos US$ 2,00 originais | 0.75685000 |

O teto original foi respeitado; não houve nova autorização financeira. O custo exato antigo segue não verificável, protegido pelo teto conservador. Entre o fechamento do relatório anterior e a reconciliação desta execução, a consulta retornou **zero operações posteriores** (`post-report-pre-start-operations.json`). Todas as 30 chamadas novas foram reservadas antes do HTTP, sem respostas de usage ausentes nem chamadas pendentes.

Em relação ao encerramento que ocorreria após a terceira chamada sob o limite antigo, os dois créditos permitiram três HTTP adicionais (C4 do job 4; C4 + R5 do job 8): **US$ 0.02155 de reserva incremental e US$ 0.00420224 de custo estimado incremental conhecido**. Nenhum desses dois jobs foi aprovado.

| Job com crédito | Tempo adicional nas etapas do provedor | Reserva incremental (US$) | Custo incremental estimado (US$) |
| --- | --- | --- | --- |
| 4 | 39.81s | 0.00720 | 0.00178642 |
| 8 | 47.15s | 0.01435 | 0.00241582 |

Esses tempos somam somente as etapas adicionais do provedor; não são um benchmark controlado da latência total contrafactual.

As três conclusões são distintas:

1. **Correção arquitetural: SIM.** Crédito estruturado/persistido observado em dois jobs reais; quinta chamada real observada com reserva correta, revisão válida e falha segura; 78 testes específicos novamente aprovados.
2. **Utilidade prática exigida para liberar: NÃO COMPROVADA.** Nenhum candidato foi aprovado após o crédito nesta versão final. Uma oportunidade terminou na validação da criadora; outra chegou à revisão 5 e foi rejeitada. Os dois sucessos históricos do Claude permanecem históricos, não são reclassificados como resultados desta rodada.
3. **Confiabilidade geral para uso amplo: NÃO ESTABELECIDA por esta amostra.** Observados 3/9 aprovados (33,3%), em amostra pequena e direcionada. Isso não prova superioridade, regressão causal ou uma taxa populacional; tampouco comprova que o crédito jamais teria utilidade. Apenas o critério concreto de pelo menos uma recuperação aprovada não foi satisfeito.

### Testes, código, revisões e rollback

- Código produtivo: os **304 hashes SHA-256 permanecem idênticos** ao início desta rodada; nenhuma correção/refatoração de produção necessária ou executada. Mudança de código desta etapa limitada ao novo harness `adaptiveRecoveryRelease.manual.test.ts`.
- Reexecutados **78 testes específicos** de política, revisão e integração transacional com emulador: todos passaram. TypeScript de Functions validou também o harness novo. As validações anteriores de 2.123 Functions, 364 nutrição/emulador, 490 nutrição/app e build foram reaproveitadas, pois o código produtivo não mudou. Não são apresentadas como novas execuções completas.
- As 23 falhas gerais do aplicativo permanecem documentadas. `git diff HEAD -- src modules ios android` vazio e nenhuma alteração em seus arquivos confirma que não foram introduzidas nesta rodada. Não foram corrigidas nem transformadas em requisito artificial para o mecanismo.
- Comparação com o código publicado/rollback: diferenças de runtime somente em `ai/config.js`, `generation/attempts.js`, `callBudget.js`, `mealAlternativeRequest.js`, `worker.js`, mais `adaptiveRecovery.js`. Nenhuma mudança não relacionada foi preparada para publicação (`compiled-vs-remote.json`).
- Fonte de rollback existente preservada, tamanho e SHA-256 conferidos contra `rollback-source.json`. Não houve necessidade de executá-lo.
- Projeto remoto `ajfit-2f321`, região `us-central1`. `release-homologation/remote-before.json` e `remote-final.json`: **todas as revisões e updateTimes permaneceram iguais**, inclusive treino e Functions fora do escopo.

| Function nutricional | Revisão ao término, inalterada |
| --- | --- |
| `onNutritionGenerationJobCreated` | `onnutritiongenerationjobcreated-00029-saw` |
| `retryNutritionGenerationJobs` | `retrynutritiongenerationjobs-00025-juq` |
| `requestNutritionMealAlternative` | `requestnutritionmealalternative-00025-yep` |
| `requestNutritionPlanGeneration` (não alterada nesta etapa) | `requestnutritionplangeneration-00011-zij` |

### Veredito definitivo e encerramento

**NÃO APROVADA PARA PUBLICAÇÃO. Nenhum deploy.** O critério necessário de uma recuperação real aprovada após o crédito não foi cumprido no limite de amostra previamente definido. Esta é a decisão final desta execução, sem nova rodada, sem aumento de orçamento, sem alteração de prompts/segurança e sem nova auditoria exploratória. Produção permanece em quatro chamadas e US$ 0,03.

Respostas obrigatórias:

1. **A recuperação adaptativa de cinco chamadas funciona corretamente? SIM, nas invariantes e na execução real do mecanismo.** A quinta chamada foi alcançada, com estado e orçamento corretos, e sua rejeição válida impediu persistência. Isso não equivale a uma recuperação aprovada.
2. **A quinta chamada recuperou uma dieta real que falharia com quatro? NÃO COMPROVADO na versão final.** A única revisão 5 desta rodada rejeitou o candidato; zero aprovações após crédito.
3. **Foi publicada? NÃO.** Revisões anteriores mantidas.
4. **Geração nutricional pronta para os testes finais no app que incluam a recuperação adaptativa? NÃO.** A política de cinco chamadas não foi liberada; testar o app contra produção continua exercitando o orçamento antigo. Não se atribui esse bloqueio às 23 falhas gerais fora do escopo.
5. **O que falta para encerrar?** Bloqueio real desta liberação: ausência da recuperação aprovada exigida, impedindo publicar o backend de cinco chamadas. Melhorias opcionais: reduzir falhas de macro/evidência e observar disponibilidade com amostra maior; não são novas etapas obrigatórias desta execução. Fora do escopo: as 23 falhas gerais do app, que seguem em suas respectivas frentes. Não foi encontrado defeito adaptativo que justifique reimplementação.

Riscos residuais: disponibilidade variável do modelo; custo/latência extra podem não gerar uma aprovação (observado duas vezes); crashes continuam conservando reservas e podendo encerrar um job sem plano; estimativa de faturamento antigo não é um extrato exato. Nenhum desses riscos foi ocultado por aprovação automática ou flexibilização da segurança.

Estado final: branch `treinos`, mesmo HEAD `3d731c9200d3d1ba454c76a0ce0bc2bcbdc7169b`, staging vazio, sem commit/push, sem EAS/TestFlight, sem alteração de Rules, UI ou endpoints de treino. Working tree pré-existente preservado. Artefatos novos neste subdiretório e novo harness manual; `repository-final.json` registra os hashes/status. Os nove jobs novos são terminais, a trava do ledger foi removida e nenhuma chamada paga ficou ativa. Emulador e sessão Claude anteriores foram preservados.

Conferência final: job 1: `AI_REVIEW_INSUFFICIENT_INFORMATION`; job 2: `AI_MACRO_VALIDATION_FAILED`; job 4: `AI_MACRO_VALIDATION_FAILED`; job 7: `AI_EVIDENCE_INSUFFICIENT`; job 8: `AI_REVIEW_REJECTED`; job 9: `AI_EVIDENCE_INSUFFICIENT`. No ledger, `digestVerified`/`candidatePersistedExactly` referem-se ao plano aprovado e persistido; ficam falsos quando não há plano aprovado. A validade do hash das revisões negativas está registrada separadamente em `review-digest-verification.json`.

`closing-verification.json` confirma os nove jobs terminais, 30 HTTP contabilizados, sequência/custo das operações, todos os hashes produtivos e revisões remotas inalterados, trava removida e ausência de homologador ativo. Não há nova execução paga pendente nem prevista nesta tarefa.
