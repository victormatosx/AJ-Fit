# Implantação da correção de dieta com IA — 16/10/2026

## Resultado

Deploy seletivo concluído no projeto `ajfit-2f321`, região `us-central1`, entre **16:36:30 e 16:36:34 UTC**. Smoke autenticado executado entre **16:37:04 e 16:38:14 UTC**: geração, validação, persistência e leitura autenticada do plano ativo concluídas em produção, com dados inteiramente fictícios.

O teste precisou de **três tentativas**: duas rejeições nutricionais no Luna, recuperadas pelo fallback Sol. Portanto, há evidência de um fluxo completo bem-sucedido, mas não de ausência de rejeições intermediárias nem de uma taxa de sucesso garantida para todos os perfis. A validação da interface móvel continua pendente.

## Revisão anterior ao deploy

- Diff revisado: alterações de contrato/reparo, tratamento de erros, diagnóstico e testes relacionados à nutrição.
- Tolerâncias, fórmulas nutricionais, modelos, limite de tentativas e critérios de aceitação preservados.
- Nenhuma alteração em `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, dependências ou runtime.
- Nenhuma alteração de credencial; Secret Manager confirmou versão **2**, habilitada e já usada com sucesso na investigação.
- Uma melhoria adicional de diagnóstico registra somente os booleanos `retryFeedbackPresent` e `repairCandidatePresent` junto à tentativa enviada. Um teste verifica esses indicadores e o feedback no payload efetivo sem registrar conteúdo alimentar.

## Funções implantadas

| Function | Revisão ativa | Secret `OPENAI_API_KEY` |
| --- | --- | --- |
| `requestNutritionPlanGeneration` | `requestnutritionplangeneration-00005-soj` | Não consome o secret; apenas valida e enfileira |
| `onNutritionGenerationJobCreated` | `onnutritiongenerationjobcreated-00022-foy` | **2** |
| `retryNutritionGenerationJobs` | `retrynutritiongenerationjobs-00018-noc` | **2** |
| `requestNutritionMealAlternative` | `requestnutritionmealalternative-00018-vog` | **2** |

A alternativa foi incluída porque compartilha provider/config alterados. As quatro Functions estão `ACTIVE`; os quatro serviços Cloud Run estão `Ready=True`, com **100% do tráfego nas revisões novas**.

O inventário de Functions antes/depois confirmou exatamente essas quatro atualizações, **70 funções não relacionadas sem atualização**, e nenhuma função criada ou removida. Runtime, memória, timeout, service account, ingress, configuração de rede e event triggers foram comparados e permaneceram iguais. Não foram implantadas regras, índices, frontend ou alterações de rollout.

Comando executado:

```sh
firebase deploy --only functions:requestNutritionPlanGeneration,functions:onNutritionGenerationJobCreated,functions:retryNutritionGenerationJobs,functions:requestNutritionMealAlternative --project ajfit-2f321 --non-interactive
```

## Testes repetidos

- Aplicativo/domínio: **1.351 testes aprovados, 115 arquivos**, incluindo nutrição, logger, serviço de geração e prescrição de treinos.
- Backend nutrição, depois da melhoria de diagnóstico: **89 aprovados, 7 opt-in ignorados** no comando sem emulador/credenciais.
- Firestore Emulator: **6 testes aprovados**, cobrindo jobs, persistência, deduplicação, alternativa, restauração e jornada.
- Typecheck do aplicativo e das Functions: aprovados.
- Build das Functions: aprovado, incluindo o predeploy efetivo.
- ESLint do provider/teste ajustados nesta implantação: aprovado, sem erros ou warnings.
- `git diff --check`: aprovado.
- O lint global já tinha falhas não relacionadas, documentadas no relatório de investigação; não foi usado como evidência de aprovação global.

## Smoke autenticado em produção

Identificadores operacionais:

- requestId: `17ca0261-81b3-4941-848c-321c78541b1f`
- generationId: `6b9ba204-e0b5-4a3e-aa7f-e358e45f97c2`

Procedimento:

1. Utilizado o debug token de App Check já registrado, sem mudar a configuração de segurança.
2. Criada uma conta Firebase Auth temporária e exclusiva, com endereço fictício e senha aleatória mantida somente em memória.
3. Criado contexto fictício de quatro refeições usando precondições `exists=false`; nenhum documento existente foi sobrescrito. Notificações foram desabilitadas apenas para essa conta sintética.
4. Chamada HTTPS à Function implantada com **Firebase ID token real e App Check válido**. Cloud Logging registrou `app=VALID`, `auth=VALID`; HTTP **200**.
5. Repetida a solicitação com o mesmo requestId: retornou o mesmo generationId, verificando idempotência.
6. O trigger implantado recebeu o job e executou o worker da revisão nova, incluindo chamadas reais à OpenAI.
7. O job terminou `completed`, `errorCode=null`, `aiAttemptCount=3`, `retryCount=2`.
8. O plano foi persistido `active`, com prompt `nutrition-full-plan-v3.1.0`, modelo `gpt-6.1-sol`, `fallbackUsed=true` e `corrected=false`. A aprovação usou os critérios atuais, sem correção proporcional ou relaxamento de tolerâncias nesse resultado final.
9. O plano ativo foi lido via Firestore REST usando o ID token da própria conta, exercitando a autorização de leitura do cliente.
10. Após registrar o resultado terminal, removidos os **9 documentos sintéticos** criados pelo teste (contexto, job, plano, rate limit e três auditorias de tentativa) e excluída a conta Auth temporária. Os logs técnicos de execução permanecem no Cloud Logging. Nenhuma dieta de cliente foi usada, arquivada ou substituída.

Resultado das tentativas, lido das auditorias antes da limpeza:

| Tentativa | Modelo | Resultado | Duração |
| --- | --- | --- | --- |
| 1 | `gpt-6-luna` | `AI_MACRO_VALIDATION_FAILED` | 19.686 ms |
| 2 | `gpt-6-luna` | `AI_MACRO_VALIDATION_FAILED` | 15.013 ms |
| 3 | `gpt-6.1-sol` | `validated`, sem failureCode | 21.935 ms |

## Retry e logs

O teste de regressão confirma que o payload de uma nova tentativa inclui o diagnóstico nutricional e o candidato anterior. Na revisão implantada, os logs da segunda tentativa confirmaram `retryFeedbackPresent=true` e `repairCandidatePresent=true`, e a chamada recebeu HTTP 200. Esses logs não contêm a dieta, prompt, credencial nem dados do questionário.

A primeira rejeição registrou `kcal:below_min` e `fiberG:above_max` no almoço; a segunda, `proteinG:above_max` no mesmo slot. As tentativas 2 e 3 registraram os dois indicadores de reparo como `true`. Todas as três chamadas à OpenAI retornaram HTTP 200.

Cloud Logging confirmou `persistence_started` às **16:38:09.935 UTC** e `job_completed` às **16:38:10.292 UTC**, com duração de **58.624 ms**, três tentativas e fallback. Houve recuperação por fallback, não aceitação de um candidato inválido.

A consulta pós-deploy, a partir de **16:36:35 UTC**, não encontrou HTTP 401 nem eventos `job_failed`, `job_stage_failed` ou `job_transient_error` nas quatro funções selecionadas até a verificação. Essa é uma janela curta de observação: não permite afirmar que nunca haverá erros futuros. As duas rejeições intermediárias observadas impedem afirmar que deixaram de ocorrer falhas repetidas de validação no modelo primário.

## Validação pendente

- Executar o aplicativo atualizado em um dispositivo autenticado: questionário → geração → plano exibido, navegação/background, mensagens de erro e reconexão do listener.
- As mudanças do frontend permanecem no repositório e **não foram distribuídas por este deploy de Functions**.
- Observar mais gerações legítimas para medir taxa de sucesso, frequência de fallback, custo e rejeições por nutriente. Nenhum novo modelo ou tolerância foi alterado para fazer o smoke passar.
- O smoke não exercitou a alternativa de refeição na API real nem simulou perda de lease/scheduler em produção; esses caminhos tiveram testes automatizados e a implantação/configuração foi verificada.

**Status: backend implantado e validado por um smoke completo em produção; validação manual do aplicativo e acompanhamento da confiabilidade permanecem pendentes.**
