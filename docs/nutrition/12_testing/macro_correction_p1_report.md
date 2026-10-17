# Correção P1 de AI_MACRO_VALIDATION_FAILED — validação local

Data: 2026-10-17. Base inspecionada: `1a9a5f4`. Alterações apenas locais.

## Problemas corrigidos

- O corretor tentava somente `kcal.target / kcal.observadas`, ignorando outros fatores que poderiam satisfazer todas as faixas simultaneamente.
- Porções corrigidas podiam chegar a zero, ultrapassar 5.000 ou ficar inconsistentes com os nutrientes após arredondamento.
- O primeiro erro macro interrompia a análise antes de uma violação alimentar em outra refeição/opção.
- O feedback continha somente a primeira direção de desvio; o diagnóstico diário não identificava os nutrientes.

## Implementação

`correction.ts` intersecta os intervalos `(min - 0,01) / observado` até `(max + 0,01) / observado` dos cinco nutrientes com o orçamento preexistente de escala `[0,5; 2]`. Nutriente zerado só é compatível quando sua faixa admite zero. A seleção privilegia fatores próximos de 1, com pequeno recuo para dentro do intervalo para reduzir problemas de quantização. Há no máximo cinco candidatos por opção; não existe busca combinatória nem alteração de composição.

Quantidades contínuas reconhecidas mantêm precisão de duas casas. Unidades de contagem reconhecidas, incluindo unidade/fatia/ovo/cápsula/comprimido e aliases, exigem inteiros. Nomes e unidades são preservados. Unidades desconhecidas podem permanecer em um plano já válido; uma correção automática nelas é recusada. Não há conversão para gramas nem inferência de composição pelo nome. Quantidade inválida é recusada, nunca limitada artificialmente ao mínimo/máximo.

Cada estimativa nutricional corrigida deriva de `quantidadeFinal / quantidadeOriginal`. Todos os itens da proposta passam novamente pelo validador estrutural, limites numéricos e verificação de segurança; todos os nutrientes da refeição são revalidados. O plano completo continua sujeito à validação diária. Se fatores próximos de 1 produzirem um dia inválido, uma segunda avaliação local prioriza o fator calórico quando ele pertence à interseção de TODOS os nutrientes. Se o dia continuar inválido, ocorre rejeição/retry normal.

Antes de qualquer decisão de retry macro, todos os alimentos do candidato estruturalmente válido são examinados para alergias, exclusões e padrão alimentar. Uma violação mantém `AI_SAFETY_VALIDATION_FAILED` não retentável; nenhum plano é persistido. O parser estrutural continua precedendo essa passagem, pois não é seguro tratar formas inválidas como alimentos válidos.

`diagnostics.ts` reutiliza os diagnósticos para logs e feedback: slot/opção, nutriente, observado, min/max, desvio absoluto em relação ao limite violado, percentual quando definido, tentativa de correção, intervalo, fator, resultado/motivo e resultado diário. Logs usam apenas enums e números mais os identificadores operacionais existentes. Não contêm nomes de alimentos, ingredientes, respostas, questionário ou identificadores pessoais. Os diagnósticos não são gravados em jobs, planos ou analytics.

Nos retries, `previousPlan` contém as correções locais válidas já aplicadas, inclusive ingredientes originais, somente em memória e no envio ao provider. O feedback numérico inclui somente refeições ainda falhas e o resultado diário, sem duplicar refeições corrigidas como falhas. Apenas números dos diagnósticos são encurtados a seis casas para serialização; quantidades e composição do candidato não sofrem um segundo arredondamento. O objeto de erro com esse candidato não deve ser logado/persistido; os consumidores usam projeções explícitas de códigos e diagnósticos.

O prompt foi versionado como `nutrition-full-plan-v3.3.0` para rastrear o novo feedback. Modelos, fallback Luna/Luna/Sol, Responses API, schema estrito, máximo de três tentativas, timeouts, metas, tolerâncias, Premium, cooldown, idempotência, estados dos jobs, persistência, onboarding, frontend e notificações permanecem preservados.

## Arquivos

Produção:

- `functions/src/nutrition/generation/correction.ts` (novo)
- `functions/src/nutrition/generation/diagnostics.ts` (novo)
- `functions/src/nutrition/generation/domain.ts`
- `functions/src/nutrition/generation/attempts.ts`
- `functions/src/nutrition/generation/alternative.ts`
- `functions/src/nutrition/generation/worker.ts`
- `functions/src/nutrition/generation/mealAlternativeRequest.ts`
- `functions/src/nutrition/ai/prompt.ts`
- `functions/src/nutrition/ai/config.ts` (apenas versão do prompt)

Testes:

- `functions/src/nutrition/__tests__/fixtures/macroCorrection.ts` (novo)
- `functions/src/nutrition/__tests__/macroComparison.test.ts` (novo)
- `functions/src/nutrition/__tests__/macroCorrection.test.ts` (novo)
- `functions/src/nutrition/__tests__/macroCorrection.integration.test.ts` (novo)
- `functions/src/nutrition/__tests__/generation.test.ts` (asserção permite campos adicionais no feedback; mantém os campos anteriores)

Este relatório é o único arquivo adicional fora de Functions. `provider.ts`, `modelPricing.ts`, frontend e catálogo não foram alterados.

## Comparação registrada antes/depois

Fixtures criadas antes de alterar o gerador. Provider completamente simulado: primeira saída é a fixture; caso haja retry, a saída seguinte é um plano sintético válido. Valores abaixo são resultados locais, não estatísticas de produção.

| Fixture | Antes: resultado/chamadas | Depois: resultado/chamadas |
|---|---|---|
| `already_valid` | Inalterado / 1 | Inalterado / 1 |
| `uniform_half` | Corrigido / 1 | Corrigido / 1 |
| `non_calorie_factor` | Retry / 2 | Corrigido / 1 |
| `impossible_intersection` | Retry / 2 | Retry / 2 |
| `zero_protein` | Retry / 2 | Retry / 2 |
| `rounds_to_zero` | Corrigido indevidamente / 1 | Retry / 2 |
| `quantity_over_max` | Corrigido indevidamente / 1 | Retry / 2 |
| `discrete_unrepresentable` | Corrigido indevidamente / 1 | Retry / 2 |
| `ambiguous_unit` | Correção ambígua aceita / 1 | Retry / 2 |
| `later_allergy` | Retry macro antes de descobrir bloqueio / 2 | Bloqueio de segurança / 1 |
| `later_exclusion` | Retry macro antes de descobrir bloqueio / 2 | Bloqueio de segurança / 1 |
| `later_diet` | Retry macro antes de descobrir bloqueio / 2 | Bloqueio de segurança / 1 |

Totais: 18 chamadas simuladas antes e 18 depois. Uma correção nova evita uma chamada e a precedência de segurança evita três; as quatro correções antes indevidas/ambíguas passam a exigir retry, adicionando quatro. Isso não sustenta uma afirmação de redução agregada de custo real. Nos casos já aprovados sem correção, porções e nutrientes permanecem inalterados.

Benchmark informativo da fixture `non_calorie_factor`: 1.000 aquecimentos e 10.000 validações, Node 20.20.2, mesmo ambiente local. Antes: **79,550 ms**; depois: **87,716 ms** (aproximadamente 0,0080 e 0,0088 ms/validação). Antes mede rejeição, depois aprovação corrigida. Execuções isoladas, sujeitas a variação de JIT/GC; sem provider, Firestore ou logging no trecho medido. Não há limiar de performance no teste.

## Testes e reprodução

Estado inicial: TypeScript Functions limpo; 68 testes unitários existentes relevantes passaram antes das alterações.

Depois:

- TypeScript Functions: `cd functions && ./node_modules/.bin/tsc --noEmit`.
- ESLint: executar `./node_modules/.bin/eslint` na raiz sobre os 14 arquivos TypeScript novos/modificados listados acima, sem `--fix`.
- Comparação: `cd functions && ./node_modules/.bin/vitest run src/nutrition/__tests__/macroComparison.test.ts --disableConsoleIntercept --reporter=verbose`.
- Suíte nutricional completa, excluindo explicitamente o smoke pago: **12 arquivos / 117 testes aprovados**, incluindo integrações com Firestore Emulator, pelo comando abaixo.
- Regressões de motor/matemática/apresentação: `./node_modules/.bin/vitest run src/nutrition/engine/__tests__ src/nutrition/catalog/__tests__/math.test.ts src/nutrition/ui/__tests__/generationStage.test.ts src/screens/nutrition/__tests__/nutritionGenerationPresentation.test.ts` na raiz: **136 testes aprovados**.

```sh
env -u OPENAI_API_KEY \
  JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
  NUTRITION_REAL_AI_SMOKE=0 \
  firebase emulators:exec --only firestore --project demo-ajfit-macro-p1 \
  'cd functions && ./node_modules/.bin/vitest run src/nutrition/__tests__ --exclude "**/realProvider.smoke.integration.test.ts" --testTimeout=15000'
```

O projeto `demo-` isola as escritas no emulador e impede acesso a serviços não emulados. Não há execução de Functions conectadas a produção nem chamadas reais à IA.

A suíte inclui correção alternativa ao fator calórico, interseção impossível, zeros, limites/margens inclusivos, plano inalterado, bloqueio diário, quantização inválida, inteiro representável/não representável, consistência de nutrientes, limites estruturais pós-correção, precedência das três restrições, feedback numérico e privacidade, fallback, esgotamento e ausência de quarta chamada. A integração nova comprova persistência única de porções corrigidas e ausência de persistência de plano inseguro. As integrações existentes exercitam recuperação, concorrência, cooldown, alterações de perfil e idempotência.

Invariantes: **400 amostras determinísticas variadas; 252 aprovadas e 148 rejeitadas**. Toda aprovação foi checada por desigualdades independentes das funções de validação para faixas de refeição/dia, quantidade, inteiros, proporção real e preservação de alergias/exclusões/padrão alimentar. O plano aprovado foi reconstruído e revalidado com correção desligada. Asserções posteriores à aprovação ficam fora do catch de rejeição, para impedir falsos positivos.

Uma repetição da integração existente `never spends a fourth AI attempt after a crash...` excedeu seu timeout padrão de 5 segundos, após uma execução anterior bem-sucedida. O comando final usa 15 segundos por teste para acomodar o Firestore Emulator; isso não altera qualquer timeout da aplicação. Java 17 não foi aceito pelo Firebase CLI atual; foi usado Java 21 já instalado, sem instalar dependências.

## Limitações e riscos

- Estimativas nutricionais continuam pertencendo à IA; esta tarefa não comprova sua exatidão nem implementa conferência TACO/TBCA ou equação energética.
- Busca local limitada pode deixar passar uma combinação representável que exigiria outro ponto de quantização ou escalas diferentes por alimento; nesse caso há retry seguro.
- Não há otimização global combinatória das refeições. A segunda seleção local e a validação diária evitam aprovações inválidas, sem prometer recuperar todos os dias corrigíveis.
- A política conservadora de contagem inteira e de unidades desconhecidas pode aumentar retries para porções que antes eram aceitas. Unidades fracionáveis adicionais ou frações naturais de contagem exigem uma definição explícita de produto; não foram inferidas pelo nome do alimento.
- As faixas por refeição, incluindo fibra de lanches, não foram relaxadas. Qualquer revisão nutricional dessas regras fica para decisão do produto/responsável nutricional.
- Diagnósticos aumentam o número de eventos de log. São limitados pelos limites existentes de slots/opções/nutrientes; feedback omite refeições aprovadas e arredonda apenas os diagnósticos.
- Redução de custo/latência em produção precisa ser medida após autorização e eventual deploy, por versão do prompt, modelo, tentativa, resultado da correção e resultado final do job.

Não houve deploy, commit, push, leitura/escrita de produção nesta implementação, alteração de rollout, chamada paga, build EAS ou publicação.

Veredito: **APTO para posterior deploy autorizado**, com todas as validações locais concluídas. A eficácia econômica em produção permanece não medida.

## Auditoria final e deploy controlado — 2026-10-17

Esta seção registra a execução posterior, expressamente autorizada, do deploy. As declarações de ausência de deploy nas seções anteriores descrevem a etapa de implementação local.

O `git status`, diff completo e arquivos não rastreados correspondiam exatamente à lista P1 acima. Nenhuma alteração local separada do onboarding foi encontrada. Os três pacotes de código em produção foram baixados em modo somente leitura e comparados com o código local: todas as fontes existentes de produção, fora dos sete arquivos de produção P1 modificados, eram idênticas. As correções anteriores de recuperação já estavam presentes nos pacotes publicados. Dependências, manifests e regras não apresentavam alterações.

A árvore de imports do JavaScript compilado, cruzada com os exports reais de `functions/src/index.ts`, identificou exatamente três Functions afetadas:

| Function | Origem/dependência P1 | Região | Timeout preservado |
|---|---|---|---:|
| `onNutritionGenerationJobCreated` | worker → attempts → domain/correction/diagnostics/provider/prompt | `us-central1` | 540 s |
| `retryNutritionGenerationJobs` | mesmo worker de recuperação | `us-central1` | 540 s |
| `requestNutritionMealAlternative` | alternative → domain/correction/diagnostics/provider/prompt | `us-central1` | 120 s |

Não foi necessária nenhuma correção adicional de código durante a auditoria. Os limites da busca, estimativas da IA e política conservadora de unidades permanecem documentados acima. Metas/tolerâncias, alergias/exclusões, Premium, cooldown, idempotência, persistência, notificações, onboarding, paywall, estados dos jobs, modelos e ordem de fallback foram preservados. Documentos históricos não são migrados nem reinterpretados pelo parser de novas respostas.

Validação repetida antes do deploy: **117 testes em 12 arquivos nutricionais**, incluindo integrações no projeto isolado `demo-ajfit-macro-audit`, e **136 testes de motor/matemática/apresentação**, todos aprovados. Os 400 casos sintéticos fazem parte da suíte nutricional. TypeScript, ESLint dos arquivos envolvidos e `git diff --check` passaram. O smoke de provider real foi explicitamente excluído e `OPENAI_API_KEY` removida do ambiente de testes. Compatibilidade e recuperação de jobs existentes, ausência de quarta tentativa, bloqueio alimentar, não persistência de plano inseguro e privacidade dos novos logs foram exercitados.

Comandos de compilação e deploy:

```sh
npm --prefix functions run build
firebase deploy --project ajfit-2f321 --only functions:onNutritionGenerationJobCreated,functions:retryNutritionGenerationJobs,functions:requestNutritionMealAlternative --non-interactive
```

O predeploy oficial recompilou o projeto. Seus 595 arquivos compilados permaneceram idênticos, por SHA-256, ao artefato revisado. Comparação com o compilado publicado anteriormente: apenas os arquivos P1 e seus source maps diferiram; os dois módulos novos e seus mapas foram adicionados, sem arquivos compilados removidos. Os arquivos não rastreados `correction.ts` e `diagnostics.ts` participaram da compilação e do pacote.

O Firebase CLI terminou com exit code **0**, três mensagens `Successful update operation` e `Deploy complete!`. Não houve pedido de exclusão, renomeação ou operação destrutiva. O aviso de versão antiga do pacote `firebase-functions` é preexistente; nenhuma dependência foi atualizada nesta tarefa.

Snapshot administrativo antes/depois: **74 Functions em ambos**, nenhuma removida ou adicionada. Somente as três selecionadas tiveram metadados alterados; as outras **71 permaneceram idênticas** no snapshot de estado/updateTime/runtime/entryPoint/source/timeout/service/revision.

Revisões publicadas, todas com estado `ACTIVE`:

- `onNutritionGenerationJobCreated`: `onnutritiongenerationjobcreated-00025-wow`, atualização `2026-10-17T15:51:32.660320751Z`.
- `requestNutritionMealAlternative`: `requestnutritionmealalternative-00021-yot`, atualização `2026-10-17T15:51:38.101300751Z`.
- `retryNutritionGenerationJobs`: `retrynutritiongenerationjobs-00021-zam`, atualização `2026-10-17T15:51:39.056177643Z`.

Não houve commit, push, tag, release, EAS, build mobile, OTA, publicação em lojas, deploy de Hosting/Rules/Indexes/Remote Config ou alteração manual de dados de usuários.

Pós-deploy: os três serviços Cloud Run estão `Ready / CONDITION_SUCCEEDED`, com a revisão criada igual à revisão pronta e **100% do tráfego** na nova revisão. Os três pacotes publicados foram baixados novamente: todos os **595 arquivos compilados** corresponderam ao manifesto SHA-256 revisado, sem arquivos faltantes ou divergentes, incluindo os novos módulos. Essa comparação confirma o prompt `nutrition-full-plan-v3.3.0`, modelos Luna/Luna/Sol, limite de três tentativas e timeout de provider de 90 segundos no código efetivamente publicado, sem executar o provider.

A leitura completa dos logs disponíveis das três novas revisões retornou **12 eventos INFO**, incluindo inicialização e sucesso da sonda TCP de startup na primeira tentativa de cada serviço. Nenhum evento ERROR, falha de carregamento de módulo ou erro de configuração foi observado. Não havia execução de geração real nesses logs; nenhuma foi provocada para validação.

O documento `nutritionRolloutConfig/onboardingAutomatic` permaneceu `{schemaVersion:1, enabled:true, percentage:100}` e seu `updateTime` permaneceu idêntico entre as leituras anteriores/posteriores. Nenhum dado de usuário foi escrito pela validação.

Veredito final desta etapa: **DEPLOY CONCLUÍDO E VALIDADO**, quanto ao escopo publicado, integridade dos artefatos e saúde/inicialização observadas. Eficácia e custos reais devem ser medidos em execuções futuras autorizadas/naturais; não foram alegados ganhos de produção com base nos testes sintéticos.
