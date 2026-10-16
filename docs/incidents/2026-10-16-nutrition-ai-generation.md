# Incidente: geração de dieta com IA — 16/10/2026

## Status

**Atualização de implantação:** o deploy autorizado e o smoke autenticado posterior estão documentados em [relatório de implantação](2026-10-16-nutrition-ai-deployment.md). O restante deste arquivo registra a investigação anterior ao deploy.

**Correção implementada, aguardando validação.** IA real + validação + persistência foram testadas com dados fictícios e Firestore Emulator. Não houve deploy, alteração de secrets, gravação de dados em produção ou teste da interface em um dispositivo autenticado. Não é possível garantir a taxa de sucesso de uma integração probabilística com apenas um smoke test aprovado.

## Evidências e causa

Consultas somente de leitura ao projeto `ajfit-2f321`:

| Horário UTC | Evidência | Interpretação |
| --- | --- | --- |
| 16/10 15:05:07 e 15:10:12 | Cloud Logging: `ai_http_error`, HTTP 401, `openAiErrorCode=token_invalidated` | Houve rejeição efetiva da credencial nesses episódios. Não é uma hipótese baseada em warnings do aplicativo. |
| 16/10 15:50:14 | Secret Manager: versão 2 de `OPENAI_API_KEY` criada e habilitada | Existe uma nova versão; não foi criada nesta investigação. |
| 16/10 15:51–15:52 | Descrições das Functions: worker, scheduler e alternativa vinculados explicitamente à versão 2 | A versão vinculada ao runtime foi verificada, além da existência do secret. |
| 16/10 15:56:50, 15:57:10 e 15:58:21 | `nutritionAiOperations`: job `d71634dd-a88c-4676-838c-d247a5756939`, duas tentativas Luna e uma Sol, todas `AI_MACRO_VALIDATION_FAILED` | A falha mais recente ocorre depois da resposta da IA e antes da persistência. Trocar a chave não corrige esse segundo problema. |
| 16/10 15:58:21 | Cloud Logging: `job_failed` para o mesmo job | Confirmação do resultado terminal do worker. |

Também existem gerações anteriores validadas usando o fallback. Logo, não há evidência de indisponibilidade geral do endpoint/modelo. HTTP 429 da callable não deve ser confundido com HTTP 429 da OpenAI: o cooldown da callable também gera `resource-exhausted`.

O arquivo de origem do deploy do worker foi consultado no Cloud Storage. Antes das alterações, `config.ts`, `provider.ts`, `prompt.ts`, `domain.ts` e `worker.ts` eram idênticos aos arquivos locais. As funções estão `ACTIVE`, em `us-central1`, runtime Node 22. Worker e scheduler têm timeout de 540s, callable de solicitação 60s e alternativa 120s; memória observada 256Mi. A chamada ao provedor tem orçamento de 90s. O secret é carregado com `defineSecret('OPENAI_API_KEY')`, vinculado nas funções consumidoras e lido com `.value()`. Não há chave OpenAI no `.env` do cliente nem variável pública OpenAI.

**Causa imediata comprovada do episódio atual:** os nutrientes estimados pela IA não satisfazem as faixas aceitas pelo backend. O validador rejeita a saída; o plano não é salvo. As tentativas esgotam o orçamento de três chamadas.

**Problema no contrato/reparo:** o prompt anterior enviava as metas, mas não exigia explicitamente a soma simultânea dos cinco nutrientes por refeição; os retries reenviavam apenas `AI_MACRO_VALIDATION_FAILED`, sem o candidato rejeitado e sem indicar refeição/nutrientes. Isso impedia um reparo direcionado. É uma deficiência concreta da implementação; não há como provar, pelos registros antigos, qual nutriente falhou naquele job específico, nem que a redação do prompt seja a única causa da variabilidade do modelo.

Antes de corrigir, uma chamada real com perfil fictício de quatro refeições e secret versão 2 reproduziu `meal_target_deviation`: excesso de proteína, falta de gordura e fibra fora da faixa em diferentes refeições. Não foram usados questionários de clientes. Depois de explicitar o contrato, uma execução ainda precisou do fallback. A implementação final passou também o candidato anterior no feedback, em memória, para permitir reparo em vez de recomposição sem contexto.

O resumo de logs do aplicativo fornecido não contém timestamps nem identificadores suficientes para associar aquele dispositivo a um job específico. Os achados acima são de operações reais do backend, sem afirmar essa associação. Warnings do RevenueCat e require cycles não foram identificados como causa.

## Fluxo e contratos

1. `AppShell` monta `NutritionShell`; a disponibilidade da aba depende do rollout. A conclusão do treino não aciona essa callable.
2. `NutritionShell.handleSubmitProfile` grava `users/{uid}/nutritionProfile/current`. Na primeira criação elegível, solicita o plano; a home também oferece solicitação explícita.
3. `src/services/nutritionGeneration.ts` chama `requestNutritionPlanGeneration`, em `us-central1`. O payload contém apenas `{ requestId }`; questionário completo, credencial OpenAI e UID não são enviados nesse payload.
4. Firebase verifica Auth e App Check (`enforceAppCheck: true`). A callable exige autenticação, conta ativa, rollout habilitado e contexto elegível. A assinatura Premium reconhecida no app não comprova a execução dessas etapas.
5. `loadGenerationContext` lê perfil nutricional, perfil físico, último questionário, última avaliação e identidade do treino. Resolve peso/contexto e usa o engine existente para calcular metas. O peso do questionário já era fallback quando não existe avaliação válida.
6. A transação cria `users/{uid}/nutritionGenerationJobs/{generationId}` e atualiza `nutritionRateLimits/{uid}`. Preserva single-flight, idempotência por `requestId` e cooldown de 15 minutos.
7. `onNutritionGenerationJobCreated` obtém lease e executa o worker. `retryNutritionGenerationJobs`, a cada cinco minutos, recupera jobs pendentes/leases expirados.
8. `OpenAiNutritionProvider` usa `fetch` para `POST https://api.openai.com/v1/responses`, sem SDK OpenAI. Modelos preservados: `gpt-6-luna` para plano/alternativa e `gpt-6.1-sol` como fallback final condicionado a schema/macros. `store:false`, `max_output_tokens:8000`, reasoning `low`, structured output estrito.
9. `prompt.ts` envia metas por refeição, objetivo, padrão alimentar, preferências/exclusões por nome, alergênicos e suplementos relevantes. Não envia dados identificadores do cliente.
10. O provedor verifica conclusão/recusa, extrai `output_text` e faz JSON.parse. `domain.ts` verifica shape, slots, alergênicos, faixas por refeição, correção proporcional existente e totais diários. Structured Outputs garante forma; a validação nutricional continua sendo responsabilidade do aplicativo.
11. Somente após validação, uma transação cria `nutritionPlans/{generationId}`, arquiva o plano anterior e conclui o job. Os listeners de job/plano atualizam a interface. Erro não vira sucesso; plano inválido não é persistido.

## Correção implementada e arquivos

| Arquivo | Finalidade |
| --- | --- |
| `functions/src/nutrition/ai/config.ts` | Versiona o prompt como `nutrition-full-plan-v3.1.0`; preserva os modelos. |
| `functions/src/nutrition/ai/prompt.ts` | Exige somar e conferir kcal/proteína/carboidratos/gordura/fibra dentro das faixas; orienta reparo do candidato anterior com estimativas verdadeiras. |
| `functions/src/nutrition/generation/domain.ts` | Acrescenta metadados técnicos à rejeição: escopo, slot e nutrientes acima/abaixo da faixa. Não altera cálculos, tolerâncias ou aceitação. |
| `functions/src/nutrition/generation/attempts.ts` | Encaminha o candidato rejeitado e diagnóstico ao retry, somente em memória/na chamada ao provedor. Preserva o limite de três tentativas e fallback existente. |
| `functions/src/nutrition/ai/provider.ts` | Registra início/resultado HTTP, status e enums de erro; correlaciona tentativas; não repete `insufficient_quota`. Não registra chave, mensagem livre do erro, prompt ou dieta. |
| `functions/src/nutrition/generation/request.ts` | Instrumenta Auth, conta, rollout, contexto e fila; deixa de mascarar falha de infraestrutura como conta inativa/feature desligada. |
| `functions/src/nutrition/generation/worker.ts` | Instrumenta início, tentativas, validação, persistência e término com duração; remove logging de recusa livre do modelo, pois pode refletir dados do usuário. |
| `src/services/nutritionGeneration.ts` | Gera requestId, registra solicitação/resposta/erro e snapshots/falhas dos listeners, sem dados do questionário. |
| `src/lib/logger.ts` | Acrescenta logging operacional sanitizado disponível em release; mantém a política anterior de INFO das outras funcionalidades. |
| `src/screens/nutrition/NutritionShell.tsx` | Impede double tap com ref síncrona; torna erro de retry visível na home; trata listener ausente/falho e timeout de monitoramento. |
| `src/screens/nutrition/NutritionGeneratingScreen.tsx` | Exibe falha de monitoramento com retorno e nova observação, sem submeter outra geração. |
| `functions/src/nutrition/__tests__/generation.test.ts` | Regressões para diagnóstico/reparo e HTTP 400/401/403/404/429/500, incluindo quota permanente. |
| `functions/src/nutrition/__tests__/nutritionJourney.e2e.integration.test.ts` | Aguarda a primeira snapshot antes de iniciar o worker, eliminando uma corrida do teste. |
| `functions/src/nutrition/__tests__/realProvider.smoke.integration.test.ts` | Smoke opt-in de IA real com perfil fictício e persistência exclusivamente no emulador, incluindo bloqueio de reprocessamento. |
| `src/services/__tests__/nutritionGeneration.test.ts` | Verifica requestId, erros sem retry implícito e diagnóstico seguro dos listeners. |
| `src/lib/__tests__/logger.test.ts` | Verifica logging operacional em release com sanitização e preservação da política anterior. |
| Este relatório | Evidências, mapa, validação e limitações. |

O timeout de monitoramento é de 12 minutos. Ele **não** marca o job como falho, não cancela o worker e não chama a IA novamente. O botão de tentar novamente nessa situação reconecta o listener do mesmo job. Falhas de solicitação continuam liberando o estado de loading em `finally`.

## Rastreabilidade

- Cliente: `request_started` → `request_completed`/`request_failed` → `job_observed`/`job_observation_failed`.
- Callable: `request_started` → `request_authenticated` → `request_completed`/`request_failed`, com etapa e duração. O requestId UUID relaciona cliente/callable; o operationId cobre inclusive falhas anteriores ao job.
- Worker: `job_started` → `ai_request_started` → `ai_http_completed`/`ai_http_error` → `attempt_completed` → `persistence_started` → `job_completed`/`job_failed`.
- generationId e número da tentativa relacionam worker/provedor/validação. Diagnósticos de validação registram nomes e direção da violação, sem valores do perfil, conteúdo da dieta ou questionário.
- Os eventos de analytics anteriores não eram logs: `trackNutritionEvent` valida e retorna sem emitir se nenhum provider estiver configurado. O novo diagnóstico operacional não depende desse provider.
- Logs operacionais do cliente são emitidos também em release; isso não instala coleta remota de logs do dispositivo. Eventos do backend ficam no Cloud Logging.

## Validação executada

- Antes das alterações: 34 testes relevantes do backend aprovados; reprodução real sintética falhou na validação, apesar de autenticação válida no provedor.
- Frontend/domínio: **114 arquivos, 1.345 testes aprovados**, incluindo nutrição, interface de nutrição e suíte de prescrição de treino.
- Backend nutrição: **88 aprovados, 7 opt-in ignorados** sem emulador/credencial; testes de erro, parsing, schema, safety e limites de tentativas incluídos.
- Integração Firestore Emulator com provedor controlado: **6 testes aprovados**, cobrindo deduplicação, ativação, arquivamento, falhas sem plano inválido, alternativa, restauração e jornada. A primeira execução teve uma falha de sincronização do teste; após a correção do helper, os seis passaram.
- Integração opt-in IA **real**, código final: **1 teste aprovado** em aproximadamente 61s. Perfil fictício de quatro refeições → callable handler → worker → OpenAI → validação → plano ativo no emulador; reprocessar o job concluído não chama novamente o provedor. Não é um teste de UI móvel, App Check real ou trigger Eventarc implantado.
- Depois da adição do logging operacional em release: **20 testes aprovados** de logger, serviço e regressões da shell.
- TypeScript: aplicativo e Functions aprovados. Build das Functions aprovado.
- Lint dos arquivos alterados: **0 erros**; sete warnings de padrões já existentes: quatro em `NutritionShell` (estados não usados e dependências de effect) e três em `logger.ts` (expressões ternárias).
- Lint global: **reprovado, 48 erros e 470 warnings** em arquivos anteriores à alteração; entre eles Photo Vault, animações da home/splash, `Display.tsx`, `AssessmentScreen.tsx` e testes de i18n/theme. Não foram corrigidos neste incidente para evitar alterações sem relação.

O smoke real fica desabilitado por padrão. Para repeti-lo, use Java 21+, exporte a credencial apenas no ambiente do processo de teste e execute:

```sh
NUTRITION_REAL_AI_SMOKE=1 firebase emulators:exec --only firestore --project ajfit-rules-test 'cd functions && npm test -- src/nutrition/__tests__/realProvider.smoke.integration.test.ts'
```

O teste exige `OPENAI_API_KEY` no ambiente e `FIRESTORE_EMULATOR_HOST`, definido pelo comando. Pode consumir até três chamadas pagas. Não armazene a credencial em arquivos nem em variáveis públicas do aplicativo.

## Ações pendentes

1. Revisar e autorizar o deploy. Não foi executado. As funções afetadas são `requestNutritionPlanGeneration`, `onNutritionGenerationJobCreated`, `retryNutritionGenerationJobs` e `requestNutritionMealAlternative` (esta última compartilha provider/config).
2. Distribuir/executar o frontend atualizado para validar mensagens, falha de conexão, retorno da tela de erro e reconexão do mesmo job no dispositivo.
3. Executar uma geração autenticada no aplicativo e correlacionar requestId/generationId até plano exibido. Validar também navegação em background e retorno à aba.
4. Medir a taxa de sucesso real, frequência de fallback e falhas por nutriente após o deploy. Um smoke aprovado não demonstra confiabilidade para todos os perfis.
5. Não há evidência atual que exija nova rotação de chave: a versão 2 autenticou chamadas reais durante a investigação. Em futuras rotações, reimplantar as funções consumidoras é necessário para vincular a nova versão.

## Referências consultadas

- [Expo SDK 56, conforme AGENTS.md](https://docs.expo.dev/versions/v56.0.0/). O repositório já usa Expo 57; não houve migração de dependências.
- [OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- [OpenAI: códigos de erro](https://developers.openai.com/api/docs/guides/error-codes).
