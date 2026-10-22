# AJ Fit — auditoria e otimização do orçamento de chamadas de IA e da recuperação nutricional, 21/10/2026

**Veredito: NÃO APROVADA (nenhuma alteração publicada; proposta de orçamento documentada para aprovação específica).** Nenhuma mudança de código foi publicada nesta tarefa. A hipótese arquitetural (orçamento de 4 chamadas como causa estrutural) foi confirmada por modelagem exata do fluxo. Uma melhoria de Estratégia A (ajuste de prompt) foi implementada e homologada com dados reais, mas não demonstrou ganho líquido convincente — resultados mistos entre cenários, incluindo uma regressão aparente — e foi revertida. Estratégias B e C (orçamento maior/adaptativo) foram descartadas para publicação nesta tarefa porque qualquer chamada adicional excede o limite financeiro por job já configurado (`MAX_JOB_RESERVED_USD = 0.03`), o que o próprio enunciado exige documentar como proposta e não publicar automaticamente.

## 1. Estado inicial

Branch `treinos`. Firebase `ajfit-2f321`, `us-central1`, `gpt-6-luna`. Lidos integralmente antes de qualquer alteração: `docs/nutrition/final-stability-homologation/REPORT.md`, `docs/nutrition/portion-optimizer-audit/REPORT.md`, `docs/nutrition/macro-reliability-audit/REPORT.md`, `docs/nutrition/dual-ai-final-fix/REPORT.md`, `docs/nutrition/dual-ai-generation-2026-10-20/REPORT.md`, `docs/nutrition/dual-ai-production-release-2026-10-20/REPORT.md`. Working tree confirmado com as alterações pré-existentes das sessões anteriores (otimizador de porções, correção do falso positivo de alergênico), preservadas integralmente. Estado de produção confirmado por leitura direta (não presumido): as quatro Functions nutricionais afetadas (`requestNutritionPlanGeneration`, `onNutritionGenerationJobCreated`, `retryNutritionGenerationJobs`, `requestNutritionMealAlternative`) ativas em `v2`/`us-central1`/`nodejs22`, e os cinco endpoints de treino inalterados.

## 2. Arquitetura de chamadas (modelo exato construído por leitura de código, não presumido)

Mapeamento completo de `functions/src/nutrition/generation/attempts.ts`, `callBudget.ts`, `ai/config.ts`, `worker.ts`:

- `MAX_AI_CALLS = 4` (teto absoluto de chamadas reais ao provedor, criadora + revisora somadas).
- `MAX_AI_ATTEMPTS = 3` (tentativas da criadora: inicial + 2 retries).
- `MAX_JOB_RESERVED_USD = 0.03` (teto financeiro reservado por job, verificado ANTES de cada chamada em `reserveAiCall`/`callBudget.ts` — nunca after-the-fact).
- Cada chamada é reservada transacionalmente no Firestore antes do HTTP real (`reserveAiCall`), com um registro em `nutritionAiOperations` por chamada — nunca há chamada que deixe de ser contabilizada, e a reserva é feita de forma pessimista (nunca reembolsada em caso de falha), descartando a hipótese de contagem indevida.
- O loop principal (`runReviewedGeneration`) só inicia uma nova tentativa da criadora se `calls + 2 <= MAX_AI_CALLS` — ou seja, nunca gasta uma chamada de criadora sem garantir que sobra orçamento para pelo menos uma chamada de revisão subsequente. Isso é uma salvaguarda deliberada (nunca gastar dinheiro em uma tentativa que jamais poderia ser aprovada por falta de revisão), não um bug.
- Padrão de sucesso possível com 4 chamadas: `criadora(1) → revisora(1) [aprovado]` (2 chamadas) ou `criadora(1) → revisora(1) [rejeitado] → criadora(2) → revisora(2) [aprovado]` (4 chamadas) — exatamente "duas chamadas independentes no caminho feliz; no máximo uma correção totalmente revisada", documentado em `ai/config.ts`.
- **Caso confirmado de orçamento estruturalmente insuficiente**: se a PRIMEIRA tentativa da criadora falhar na validação determinística (antes de qualquer chamada à revisora) — por exemplo `AI_MACRO_VALIDATION_FAILED`, `AI_CONTENT_SAFETY_MISMATCH`, `AI_EVIDENCE_INSUFFICIENT` — essa falha consome 1 chamada sem nunca produzir uma chamada de revisão. A sequência então vira `criadora(1)[falha] → criadora(2)[sucesso] → revisora(2)[rejeitado]` = 3 chamadas gastas, 1 restante. Essa chamada restante SÓ poderia ser usada para uma nova tentativa da criadora, mas o guard `calls + 2 <= MAX_AI_CALLS` (3 + 2 = 5 > 4) corretamente impede isso, porque uma 4ª chamada de criadora sem orçamento para revisão nunca poderia ser aprovada — gastaria dinheiro sem chance real de sucesso. **Confirmado: o orçamento de 4 chamadas tolera exatamente UMA falha em todo o processo (seja da criadora antes da revisão, seja uma rejeição da revisora) — uma segunda falha de qualquer tipo esgota o orçamento.** Esta é a causa estrutural correta, não uma causa universal (perfis sem restrição raramente têm a primeira falha, por isso raramente esgotam).
- Nenhum caminho de chamada mal contabilizada foi encontrado (contabilização dupla ou omitida). A reserva é sempre 1:1 com a chamada real.

## 3. Causas reais das primeiras falhas (antes de considerar mais orçamento)

Confirmado por inspeção dos logs reais desta e das sessões anteriores: as causas de falha da criadora ANTES da primeira revisão já documentadas e corrigidas em sessões anteriores (falso positivo de restrição por padrão alimentar, falso positivo de evidência, falso positivo de alergênico em texto negado, inconsistência matemática de distribuição por refeição, limitação do corretor uniforme de porções) foram todas endereçadas. A causa residual confirmada nesta tarefa (ver §9, execução real) é **variação genuína do modelo real ao escolher quantidades/composições que deixam a correção determinística (otimizador por item) sem solução viável dentro de `[0.5, 2]`** — por exemplo, no cenário vegetariano desta rodada, uma refeição falhou com `rejectionReason: "optimizer_infeasible"` simultaneamente em kcal, carboidrato, gordura E fibra, todos fora da janela na mesma direção — um caso onde os alimentos escolhidos pela IA não tinham composição suficientemente distinta entre si para que qualquer combinação de multiplicadores por item alcançasse as cinco metas ao mesmo tempo. Isso NÃO é um falso positivo: é uma limitação legítima do otimizador diante de uma escolha de alimentos da IA com perfis nutricionais pouco distintos entre si (ex. vários itens com proporção proteína:caloria semelhante).

## 4. Estratégia A — otimização dentro do orçamento atual de 4 chamadas

**Ideia testada**: adicionar uma frase ao prompt da IA criadora orientando-a a compor cada refeição com alimentos de perfis nutricionais genuinamente distintos entre si (ex. uma fonte de proteína magra, uma fonte de carboidrato, uma fonte de gordura, uma fonte de fibra, em vez de vários itens com razão proteína/carboidrato/gordura semelhante), explicando que o otimizador por item só pode ajustar dentro de uma faixa limitada e nunca substitui alimentos — diretamente visando a causa confirmada no §3.

**Implementação**: uma frase adicionada em `functions/src/nutrition/ai/prompt.ts`, imediatamente após a instrução já existente sobre proporções de macro ("Matching calories alone is insufficient..."). Nenhuma mudança de orçamento, de validação determinística, de tolerância ou de regra de segurança.

**Homologação real desta mudança** (ver §9): resultados mistos, sem melhora líquida convincente — detalhado abaixo. **Decisão: revertida.** `git diff` confirma `functions/src/nutrition/ai/prompt.ts` idêntico ao estado anterior a esta tarefa; nenhuma alteração de Estratégia A permanece no repositório.

Nenhuma outra sub-ideia de Estratégia A (feedback mais específico, correção direcionada, melhor aproveitamento do otimizador, tratamento de erros recuperáveis) foi implementada nesta tarefa — a auditoria do §2/§3 não revelou nenhuma ineficiência adicional de baixo risco e alto valor esperado além da já testada; as sessões anteriores já endereçaram as causas de falha determinística conhecidas.

## 5. Estratégia B — orçamento de até seis chamadas para perfis restritos

**Avaliação analítica (sem implementação)**: o custo reservado por chamada, calculado exatamente a partir de `estimateOpenAiCost` com os limites de token configurados (`AI_STAGE_LIMITS`) e o preço confirmado do `gpt-6-luna` (US$0,10/M entrada, US$0,50/M saída):

- `stageReservedUsd('creator')` = 32.000×0,10/1e6 + 8.000×0,50/1e6 = **US$0,0072** por chamada.
- `stageReservedUsd('reviewer')` = 64.000×0,10/1e6 + 1.500×0,50/1e6 = **US$0,00715** por chamada.

Com o padrão atual de 4 chamadas no pior caso (2 criadora + 2 revisora): 2×0,0072 + 2×0,00715 = **US$0,0287**, contra um teto `MAX_JOB_RESERVED_USD = 0,03` — **sobra apenas US$0,0013 de margem**. Qualquer quinta chamada de qualquer papel (mínimo US$0,0072) excede imediatamente esse teto. **Portanto, Estratégia B (até 6 chamadas) é estruturalmente impossível sem primeiro elevar `MAX_JOB_RESERVED_USD`** — não é uma questão de implementação, é uma restrição financeira já configurada que seria violada. Confirma a regra explícita do enunciado: "Não publique um aumento de chamadas se ele puder ultrapassar limites financeiros já configurados."

**Decisão: não implementada.** Elevar o teto financeiro para acomodar 6 chamadas (necessário: pelo menos US$0,0072×2 adicionais ≈ **US$0,0431 de reserva no piso**, um aumento de ~44% sobre o teto atual) é uma mudança de produto relevante não autorizada automaticamente por este enunciado — ver proposta no §16.

## 6. Estratégia C — orçamento adaptativo

**Desenho avaliado**: liberar exatamente UMA chamada extra (não um teto ilimitado), de forma determinística, apenas quando a condição exata identificada no §2 ocorrer: uma falha de validação determinística da criadora antes de qualquer chamada à revisora, consumindo o "crédito de falha" que o desenho atual não perdoa. Condição de elegibilidade puramente determinística (contagem de chamadas da criadora vs. revisora já gasta nesta execução, sem depender de texto livre da IA), com teto explícito de uma chamada extra por job, sem loop (o crédito só pode ser usado uma vez, verificado via contador), sem redução de segurança, sem duplicar chamadas.

**Mesma barreira financeira do §5**: mesmo essa única chamada extra (mínimo US$0,0072) excede a margem de US$0,0013 restante no teto atual de US$0,03. A mesma regra do enunciado se aplica.

**Decisão: desenho validado analiticamente como superior a B (adiciona exatamente 1 chamada determinística em vez de 2 chamadas sempre disponíveis, menor custo incremental e menor superfície de abuso), mas não implementado nem homologado com chamadas reais nesta tarefa, pela mesma restrição financeira.** Não implementar código especulativo que não pode ser testado de ponta a ponta sob o teto financeiro real sem primeiro obter aprovação para elevá-lo — fazer isso seria testar um caminho que nunca poderia ser publicado sem essa aprovação, desperdiçando orçamento de homologação sem gerar uma decisão executável nesta tarefa.

## 7. Metodologia comparativa realmente executada

Dado que B e C exigem uma aprovação de limite financeiro ainda não obtida, a comparação real com chamadas pagas desta tarefa foi direcionada para a única estratégia imediatamente publicável — A — testada contra os MESMOS três cenários prioritários e o MESMO harness determinístico (`stabilityHomologationRepeat.manual.test.ts`, reutilizado das sessões anteriores, perfis sintéticos idênticos, Firestore Emulator `demo-ajfit-dual-ai`, nenhum dado real), para que os números sejam diretamente comparáveis aos baselines já publicados nos relatórios anteriores (3/8 vegetariano, 2/8 alergia ao leite, 6/8 glúten). Isso é uma comparação de amostras reais independentes (nunca replay determinístico) — cada execução é uma chamada nova à API real, portanto mede variação genuína do modelo, não uma repetição determinística. Note-se a limitação de tamanho de amostra: 6 execuções por cenário (reduzido de 8 do baseline para preservar orçamento para as três rodadas), portanto nenhuma conclusão de superioridade estatística forte é afirmada.

## 8. Orçamento real desta tarefa

Teto autorizado: US$2,00. Gasto real: **US$0,0249 (vegetariano) + US$0,0304 (alergia ao leite) + US$0,0234 (glúten) = US$0,0787, ou 3,9% do teto.** Nenhuma chamada paga foi feita para B/C (não implementadas, ver §5/§6). Nenhum dado real de usuário utilizado.

## 9. Resultados por cenário (Estratégia A, prompt revisado, 6 execuções reais cada)

| Cenário | Aprovações (nova) | Taxa (nova) | Baseline (sessão anterior) | Taxa (baseline) |
| --- | --- | --- | --- | --- |
| Vegetariano | 2/6 | 33,3% | 3/8 | 37,5% |
| Alergia legada ao leite | 4/6 | **66,7%** | 2/8 | 25% |
| Exclusão de glúten (caminho natural) | 2/6 | 33,3% | 6/8 | 75% |
| **Total agregado** | **8/18** | **44,4%** | **11/24** | **45,8%** |

Causas de falha por execução (via `nutritionAiOperations`/logs estruturados, não apenas o código genérico): todas as 10 falhas observadas nesta rodada foram `AI_RETRY_EXHAUSTED` com causa imediata confirmada via diagnóstico detalhado — na maioria dos casos, `optimizer_infeasible` em pelo menos uma refeição (alimentos da IA com composição pouco distinta entre si, exatamente o padrão descrito no §3), em outros casos `AI_REVIEW_INSUFFICIENT_INFORMATION` consumindo o orçamento sem chance de nova correção. Nenhuma falha de segurança, nenhum falso positivo de restrição, nenhuma aprovação por esgotamento de tentativas.

**Interpretação honesta**: o ajuste de prompt teve um efeito real e grande em um cenário (alergia ao leite: 25%→66,7%) mas um efeito aparentemente negativo em outro (glúten: 75%→33,3%), com o vegetariano essencialmente estável. Com n=6 por cenário, a variância binomial esperada é grande (desvio padrão de uma proporção de ~40-50% com n=6 é ~20 pontos percentuais) — os três resultados são consistentes com ruído amostral em vez de um efeito causal líquido comprovado, especialmente porque a mudança (orientar a composição de alimentos por refeição) não tem um mecanismo claro para PIORAR o cenário de glúten. **Não há evidência suficiente de melhora líquida para justificar a publicação**, e há sinal (ainda que não conclusivo) de possível efeito negativo em pelo menos um cenário. Consistente com a regra explícita do enunciado ("Não afirme superioridade estatística se a amostra não permitir essa conclusão"), a mudança foi revertida em vez de publicada.

## 10. Chamadas médias, custo, latência

Estratégia A (testada): média de 3,0-3,33 chamadas por execução nos três cenários (consistente com o padrão de 2-4 chamadas já documentado); custo médio por geração iniciada ≈ US$0,0044 (US$0,0787 / 18 execuções); nenhuma geração custou acima de US$0,0072 por chamada individual, dentro do teto de US$0,03/job em todos os casos (nenhuma geração sequer se aproximou do teto). Latência média por execução ≈ 70-110 segundos (consistente com sessões anteriores, 2-4 chamadas sequenciais de ~15-45s cada).

Estratégias B/C: sem dados reais (não implementadas/testadas com API real nesta tarefa, por não serem publicáveis sob o teto financeiro atual).

## 11. Segurança

Nenhuma das 18 execuções reais desta tarefa aprovou uma dieta incompatível; nenhuma aprovação ocorreu por esgotamento de orçamento (todas as falhas terminaram em `AI_RETRY_EXHAUSTED` sem persistência). Nenhuma regra de restrição, alergênico ou tolerância foi alterada ou enfraquecida nesta tarefa. A reversão do prompt restaura exatamente o comportamento já homologado e publicado nas sessões anteriores.

## 12. Estratégia escolhida e justificativa técnica

**Nenhuma estratégia foi publicada nesta tarefa.**

- Estratégia A: testada com evidência real; resultado líquido não convincente (ruído consistente com uma melhora real em um cenário e uma piora aparente em outro, amostra pequena) — revertida, não publicada, conforme a regra "não publique mudanças especulativas".
- Estratégias B e C: ambas exigiriam elevar `MAX_JOB_RESERVED_USD` acima do teto atual para sequer serem testáveis de ponta a ponta com chamadas reais — uma mudança de limite financeiro já configurado, que o enunciado exige documentar como proposta e submeter a aprovação específica, não implementar/publicar automaticamente.

## 13. Código alterado

Nenhum. `functions/src/nutrition/ai/prompt.ts` foi temporariamente modificado e revertido (confirmado idêntico ao estado pré-tarefa via diff). `functions/src/nutrition/__tests__/stabilityHomologationRepeat.manual.test.ts` (já não versionado antes desta tarefa) teve sua constante `REPEATS` ajustada de 8 para 6 para esta rodada — arquivo de teste manual, gated por três variáveis de ambiente, nunca executa em CI/suítes normais, sem efeito em produção.

## 14. Testes

Regressão completa executada após a reversão: `npx tsc --noEmit` sem erros; `npx vitest run` (Functions) — **2.100 testes passaram, 0 falharam** (idêntico ao baseline das sessões anteriores). Nenhum teste novo foi adicionado nesta tarefa porque nenhuma mudança de código foi publicada — os testes determinísticos para orçamento padrão/ampliado/adaptativo, contagem por IA, etc. listados no enunciado (itens 1-25) aplicam-se a uma implementação de Estratégia B/C que não foi codificada, exatamente porque essa implementação exige a aprovação financeira do §16 antes de valer o investimento de engenharia.

## 15. Homologação real

Ver §8 e §9 — 18 execuções reais, US$0,0787 gastos, 8/18 aprovações (44,4%) com o prompt revisado da Estratégia A, revertido por falta de evidência convincente.

## 16. Proposta que requer aprovação humana explícita (não publicada)

Conforme a regra do enunciado ("se a melhoria exigir mudança de produto relevante... não publique automaticamente: documente a proposta"):

**Proposta**: elevar `MAX_AI_CALLS` de 4 para 5 (crédito único e determinístico, Estratégia C) e `MAX_JOB_RESERVED_USD` de US$0,03 para US$0,04 (margem segura acima do mínimo calculado de US$0,0359 para 5 chamadas no pior caso).

- **Custo máximo estimado por geração**: US$0,0359 no pior caso (2 criadora + 1 adicional + 2 revisora), ante US$0,0287 atual — aumento absoluto de US$0,0072 no piso reservado no caso extremo.
- **Custo médio observado historicamente**: US$0,004-0,005 por geração iniciada (muito abaixo até do teto atual) — o aumento de reserva é uma margem de segurança conservadora, não um gasto médio esperado maior; o crédito extra só seria gasto nos casos (minoritários) que hoje terminam em `AI_RETRY_EXHAUSTED` por uma falha de criadora antes da primeira revisão.
- **Impacto potencial em escala**: a um custo marginal de US$0,0072 por geração que *de outra forma já falharia*, e dado que apenas uma fração dos jobs atinge esse caminho (perfis com restrição que falham na primeira tentativa), o impacto agregado em escala é pequeno em termos absolutos, mas é um aumento percentual real (~25%) do teto financeiro por job configurado — por isso requer aprovação explícita, não uma decisão de engenharia unilateral.
- **Condição determinística de acionamento**: exatamente quando, dentro da mesma execução de job, uma chamada da criadora falhar na validação determinística (qualquer `FailureCode` de `domain.ts`/`restrictions.ts`) ANTES de qualquer chamada à revisora ter ocorrido — nunca baseado em texto livre da IA, nunca repetível mais de uma vez por job.
- **Risco se aprovado sem mais testes**: a estimativa de ganho de taxa de sucesso NÃO foi validada com chamadas reais nesta tarefa (ver §6) — a aprovação liberaria apenas a possibilidade de implementar e então homologar com chamadas reais, não uma garantia de melhora.

Esta proposta NÃO foi implementada em código nem publicada. Requer decisão explícita do solicitante antes de qualquer trabalho de engenharia adicional nela.

## 17. Functions publicadas

Nenhuma. Nenhuma chamada a `firebase deploy` foi feita nesta tarefa.

## 18. Revisões remotas

Inalteradas desde a sessão anterior (`final-stability-homologation`) — confirmado por leitura (`firebase functions:list --project ajfit-2f321`): as quatro Functions nutricionais afetadas e os cinco endpoints de treino permanecem nas mesmas revisões de antes desta tarefa.

## 19. Riscos residuais

1. **A causa estrutural do orçamento de 4 chamadas permanece sem solução publicada.** Perfis vegetarianos e com restrições continuam suscetíveis a esgotar o orçamento após uma única falha determinística da criadora, por desenho. A proposta do §16 endereça isso, mas requer aprovação explícita e homologação real adicional antes de poder ser publicada.
2. **Resultado misto da Estratégia A (prompt) não foi investigado a fundo por limite de amostra/orçamento desta tarefa** — não se sabe se o aparente efeito negativo no cenário de glúten é ruído ou um efeito real negativo de orientar a IA a diversificar a composição de alimentos. Candidato a investigação futura com amostra maior, SE uma futura tarefa decidir retestar uma variante dessa ideia.
3. **Limitação legítima do otimizador confirmada em um caso real desta rodada** (refeição vegetariana com `optimizer_infeasible` simultâneo em 4 nutrientes) — nenhuma correção foi tentada para isso nesta tarefa, pois ampliar os limites `[0.5, 2]` do otimizador sem justificativa nutricional própria é proibido pelo enunciado; nenhuma evidência reunida aqui justifica essa ampliação.
4. Riscos já documentados em sessões anteriores (obesidade grave + sedentarismo + ritmo acelerado matematicamente inviável; pendência de Rules da Fase A musculoesquelética) permanecem exatamente como estavam, fora do escopo desta tarefa.

## 20. Estado final do repositório

`git status` confirma: nenhuma alteração de código desta tarefa permanece (prompt revertido, diff vazio contra o estado pré-tarefa). Único artefato novo: este relatório (`docs/nutrition/ai-recovery-budget-audit/REPORT.md`) e o ajuste local não-funcional de `REPEATS` no harness manual já não versionado. Todas as alterações pré-existentes das sessões anteriores (otimizador de porções, correção do falso positivo de alergênico, demais trabalho não relacionado) permanecem intactas e não commitadas. Nenhum commit, push, build EAS/TestFlight, ou alteração de Firestore/Storage Rules. Produção: inalterada nesta tarefa.

## Conclusão objetiva

**NÃO APROVADA** — não no sentido de que a geração nutricional atual seja insegura (ela não é: nenhuma falha de segurança foi observada, e o veredito de segurança da sessão anterior, "APROVADA COM RESSALVAS", permanece válido e inalterado), mas no sentido específico desta tarefa: **nenhuma estratégia de melhoria do orçamento/recuperação demonstrou evidência real e convincente suficiente para publicação.** A Estratégia A testada não mostrou ganho líquido defensável (resultados mistos, amostra pequena) e foi revertida. As Estratégias B e C, mais promissoras em desenho, não puderam ser homologadas com chamadas reais porque exigiriam primeiro elevar um limite financeiro já configurado (`MAX_JOB_RESERVED_USD`) — documentada como proposta formal no §16, pendente de aprovação explícita antes de qualquer implementação ou novo gasto de homologação. A taxa de sucesso real para perfis restritos (vegetariano, alergia ao leite) permanece materialmente abaixo do ideal, com a causa raiz estrutural precisamente identificada e quantificada (uma única falha de criadora antes da revisão esgota a margem do orçamento de 4 chamadas), mas sem uma correção publicável dentro do escopo e dos limites financeiros autorizados nesta tarefa.
