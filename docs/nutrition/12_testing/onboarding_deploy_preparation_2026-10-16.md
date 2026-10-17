# Preparação da publicação controlada — 2026-10-16

## Escopo e autorização

Preparação local somente. Nenhum deploy, alteração remota, commit, push, chamada real de IA ou envio real de push nesta etapa. O projeto existente é `ajfit-2f321` (número `753375043967`), região das Functions `us-central1`, Node.js 22; Firestore `(default)` em `nam5`. Não criar staging ou allowlist. Não alterar o projeto padrão do gcloud.

Correção desta etapa: restringir novamente a leitura de `workoutLifecycleRolloutConfig` e `workoutExecutionProtocolConfig` a `active`. Manter as permissões nutricionais. Testes adicionados verificam documentos existentes, acesso anônimo e escrita indevida.

## Evidências e recuperação preservadas

Consulta remota em 2026-10-17 02:01 UTC (16/10, 23:01 em São Paulo): oito Functions ACTIVE; secrets OpenAI v2 e RevenueCat v1 ENABLED; catálogo local com 173 IDs aprovados compatíveis com o remoto. `nutritionRolloutConfig/active` permanece com os dois flags gerais habilitados em 100%.

**O documento `nutritionRolloutConfig/onboardingAutomatic` está ausente (404), e não foi criado nesta preparação.** O novo código interpreta ausência como OFF. Após autorização, criar explicitamente OFF antes das demais operações. Não habilitar automaticamente depois do deploy.

Evidências locais fora do repositório: `/tmp/ajfit-nutrition-release-preparation/` contém metadados sanitizados, regras publicadas, oito arquivos ZIP das fontes efetivamente publicadas e manifesto de hashes. Arquivos temporários não são backup durável: preservá-los em armazenamento operacional seguro antes da publicação. Não contêm valores dos secrets. As revisões das oito Functions permaneceram iguais às do levantamento pré-deploy anterior.

Regras ativas: `projects/ajfit-2f321/rulesets/7d90bbdd-9e61-4a6b-b728-85a9a0ea2ef5`. Após a correção, as diferenças locais em relação às regras ativas são somente a inscrição inicial `onboardingNutritionState/current` e a leitura autenticada do interruptor nutricional. O manifesto registra o pacote local; recalcular se houver alterações antes do deploy.

## Pacote exato

| Function | Dependência/efeito |
| --- | --- |
| `retryNotificationDispatches` | Recuperação de leases abandonados e suporte aos dispatches nutricionais; infraestrutura compartilhada, manter compatibilidade histórica. |
| `onNutritionGenerationJobCreated` | Worker, OpenAI v2; pacote nutricional atualizado. |
| `retryNutritionGenerationJobs` | Scheduler de 5 minutos; mesmo motor/schema/prompts do worker, OpenAI v2. |
| `requestNutritionMealAlternative` | Compatibilidade com novos planos/schema; OpenAI v2. |
| `requestNutritionPlanGeneration` | Contrato `initial_onboarding`, RevenueCat v1 e App Check obrigatório. |
| `onNutritionGenerationCompleted` | Evento Firestore de conclusão, retry habilitado, dispatch deduplicado após plano persistido. |
| `onAccountDeletionRequested` | Limpeza do novo estado nutricional; manter quatro secrets Apple v1. |
| `cleanupPendingAccountDeletions` | Scheduler de limpeza; mesmas dependências Apple e recursos nutricionais. |

Dependências transitivas entram no pacote compilado; não exigem publicação de outras Functions. O prebuild sincroniza domínio nutricional e motores compartilhados antes do TypeScript. Prompts v3.2.0 e schema 3.1.0 locais, inclusive as mudanças nutricionais aprovadas pelo usuário, compõem este pacote de testes.

Não publicar `evaluateDailyWorkoutNotifications`, outros emissores, campanhas, webhook RevenueCat, `restoreNutritionPlan`, regras Storage ou todos os índices. Não mudar flags gerais, TTLs, contas, perfis, planos ou jobs.

Índice novo único: grupo `notificationDispatches`, escopo COLLECTION, `status ASC`, `updatedAt ASC`. Há 28 índices remotos READY; preservar inclusive o índice remoto de `foodLogCatalog(status, searchPrefixes)` ausente no arquivo local. TTLs necessários já estão ativos. Não executar `firebase deploy --only firestore:indexes`.

## Credenciais e infraestrutura

- Preservar `OPENAI_API_KEY` v2 (worker, retry e alternativas); `REVENUECAT_API_SECRET_KEY` v1 deverá ser vinculada à nova revisão de `requestNutritionPlanGeneration` pelo `defineSecret` existente. Não recriar nem rotacionar secrets.
- Preservar `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_NATIVE_CLIENT_ID`, `APPLE_PRIVATE_KEY` v1 nos dois serviços de exclusão. Webhook e seus secrets permanecem intactos.
- App Check: configurações App Attest/DeviceCheck do app iOS atual e Play Integrity do Android existem. O app atualizado deve obter atestação válida no dispositivo, ou token debug registrado no desenvolvimento. Existência da configuração não comprova atestação real.
- Expo: reutilizar tokens, preferências, permissões, dispatcher e reconciliador existentes. O projeto EAS do aplicativo é `ac6b8f54-5fef-4e2d-9904-0a2a863b805a`. As Functions atuais de envio não possuem `EXPO_ACCESS_TOKEN`; antes de push real, confirmar se Enhanced Push Security está habilitado no Expo. Se estiver, preparar o token no runtime por uma alteração específica aprovada; não publicar às cegas nem expor seu valor. APNs/FCM e entrega real ainda exigem validação autorizada em dispositivo.
- Conta de publicação precisa das permissões existentes para Functions/Run/Eventarc/Scheduler, regras, criação do índice, secrets e service accounts. Não ampliar IAM preventivamente; interromper diante de erro de autorização.

## Sequência de publicação — executar somente após autorização explícita

Na raiz do repositório, manter cada comando separado e interromper ao primeiro erro. Confirmar novamente projeto, manifesto, ausência de jobs em processamento e estado do flag. Como o pacote altera o worker manual, evitar deploy durante jobs de teste ativos.

### 1. Garantir interruptor explícito OFF

O comando abaixo é uma **escrita remota futura**, não executada. Não modifica os flags gerais e recusa sobrescrever configuração inesperada.

```sh
node <<'JS'
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'ajfit-2f321', credential: applicationDefault() });
const db = getFirestore();
(async () => {
  const ref = db.doc('nutritionRolloutConfig/onboardingAutomatic');
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const d = snap.data();
      if (d.schemaVersion !== 1 || d.enabled !== false || d.percentage !== 0)
        throw new Error('STOP: configuração remota inesperada');
      return;
    }
    tx.create(ref, { schemaVersion: 1, enabled: false, percentage: 0 });
  });
  console.log('onboardingAutomatic confirmado OFF');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
JS
```

### 2. Criar somente o índice ausente e esperar READY

Consultar antes; se o índice já existir, não duplicar.

```sh
gcloud firestore indexes composite list --project=ajfit-2f321 --database='(default)' --format=json

gcloud firestore indexes composite create --project=ajfit-2f321 --database='(default)' --collection-group=notificationDispatches --query-scope=collection --field-config=field-path=status,order=ascending --field-config=field-path=updatedAt,order=ascending
```

Repetir a consulta de índices e aguardar `READY` do índice criado, preservando todos os demais. Não avançar em erro de construção.

### 3. Publicar as regras corrigidas

```sh
npx firebase deploy --project ajfit-2f321 --only firestore:rules
```

Ler o ruleset publicado e compará-lo ao arquivo local corrigido; confirmar que os dois documentos de treino voltaram a ser restritos a `active`, sem alterações fora do diff aprovado.

### 4. Publicar consumidor de notificações

```sh
npx firebase deploy --project ajfit-2f321 --only functions:retryNotificationDispatches
```

Confirmar ACTIVE, scheduler ENABLED, índice READY e ausência de erros de inicialização antes de publicar o emissor.

### 5. Publicar motor e operações nutricionais compatíveis

```sh
npx firebase deploy --project ajfit-2f321 --only functions:onNutritionGenerationJobCreated,functions:retryNutritionGenerationJobs,functions:requestNutritionMealAlternative
```

Confirmar as três revisões ACTIVE e OpenAI v2 vinculado; scheduler de retry ENABLED. A publicação de múltiplas Functions não é atômica: manter flag OFF, não iniciar testes manuais durante a atualização e completar o grupo antes de liberar testes.

### 6. Publicar entrada autoritativa

```sh
npx firebase deploy --project ajfit-2f321 --only functions:requestNutritionPlanGeneration
```

Confirmar RevenueCat v1 vinculado, App Check exigido na configuração/código da revisão, ACTIVE e sem erros de inicialização. Não executar geração real como smoke test.

### 7. Publicar evento de conclusão

```sh
npx firebase deploy --project ajfit-2f321 --only functions:onNutritionGenerationCompleted
```

Confirmar trigger Eventarc de update no caminho de jobs, retry habilitado e ACTIVE. Não disparar eventos artificiais que enviem push.

### 8. Publicar limpeza compatível

```sh
npx firebase deploy --project ajfit-2f321 --only functions:onAccountDeletionRequested,functions:cleanupPendingAccountDeletions
```

Confirmar ACTIVE, trigger/scheduler e quatro secrets Apple preservados. Não solicitar exclusão de conta para testar esta publicação.

### 9. Conferência final e dispositivos

Usar `gcloud functions describe NOME --gen2 --region=us-central1 --project=ajfit-2f321 --format=json` para cada uma das oito Functions; conferir revisões, secrets e triggers sem imprimir valores de ambiente. Consultar Scheduler, Eventarc e Cloud Logging no projeto explícito; comparar estados com o backup. Confirmar novamente índice READY, regras e flags gerais inalterados, além de `onboardingAutomatic` OFF.

Só então instalar o aplicativo atualizado nos dispositivos de teste, sem distribuir ao público. Ativação do interruptor, chamadas reais de IA e push de teste dependem de autorização específica posterior. Como decidido, não há allowlist: ao habilitar o interruptor com percentual 100, qualquer conta de teste nova e elegível que conclua o novo onboarding poderá participar. Não habilitar antes de os dispositivos e o backend estarem verificados.

## Interrupção e recuperação

Interromper diante de erro de build, IAM/secret, Function fora de ACTIVE, trigger/scheduler desabilitado, índice não READY, diff inesperado de regras, erro de inicialização ou flag diferente de OFF. Não prosseguir com publicação parcial sem identificar o estado efetivamente aplicado.

Recuperação principal: manter/desligar somente o interruptor automático; geração manual e jobs existentes continuam com os flags gerais preservados. O interruptor impede novas solicitações automáticas, **não cancela jobs já enfileirados**. Não apagar jobs ou dados, nem pausar o retry compartilhado indiscriminadamente.

Falha transitória de deploy: republicar o mesmo pacote validado apenas nas Functions afetadas e completar o conjunto compatível. Falha funcional: correção aditiva compatível com `initial_onboarding`, mantendo consumidores dos novos jobs/dispatches; usar fontes e configurações preservadas para diagnóstico. Não restaurar cegamente callable, workers, retries ou regras antigos: isso quebraria o novo contrato e aplicativos já instalados. Preservar índice e inscrição nutricional, secrets e tokens. Qualquer correção adicional ou suspensão seletiva de serviço compartilhado exige avaliação e autorização própria.

Entrega exatamente uma vez no provedor externo de push não é garantida; leases, tickets persistidos e chaves de idempotência minimizam duplicação sem prometer garantia absoluta.

## Validação local desta preparação

- Regras de treino: 35 testes aprovados nas suítes `workoutLifecycle.rules` e `workoutExecutionMutexHardening.rules`, incluindo as duas regressões novas.
- Interruptor nutricional: 1 teste aprovado, outros 12 testes desse arquivo não executados pelo filtro. O teste conhecido do catálogo do diário não foi alterado nem usado para declarar a suíte inteira aprovada.
- Backend nutricional e notificações: 45 arquivos aprovados, 2 ignorados; 528 testes aprovados, 14 ignorados, em Firestore Emulator. Comando: `PUSH_FOUNDATION_INTEGRATION=1 npm --prefix functions test -- src/notifications/__tests__ src/nutrition/__tests__ --testTimeout=30000`, dentro de `firebase emulators:exec --only firestore --project ajfit-rules-test`.
- Transparência da repetição: a primeira execução, com limite padrão de 5 s, teve timeout em `allows one concurrent worker and fences a stale claimant` e falha subsequente em `deduplicates successful concurrent dispatch workers` (ambos resultados DUPLICATE). A repetição completa em emulador limpo, com timeout de 30 s, passou sem modificar código de produção ou testes para contornar o resultado. O timeout pode deixar uma transação ainda em execução interferindo nos próximos testes; isso é uma explicação plausível, não uma prova definitiva da causa. Manter timeout apropriado ao emulador nas próximas validações.
- `npm --prefix functions run build`, `npm --prefix functions run typecheck`, `npx tsc --noEmit` e `node scripts/syncNutritionToFunctions.cjs --check`: aprovados.
- Catálogo remoto: `npx tsx scripts/nutrition/checkOnboardingCatalogRemote.ts --project ajfit-2f321`: 173 verificados, zero IDs incompatíveis; operação somente leitura.
- Logs completos de execução em `/tmp/ajfit-preparation-*.log`. Não executada suíte geral sem relação com a correção. Sem chamadas reais de IA ou envio real de push.
- Persistência/autenticação em Firestore Emulator com as regras corrigidas: 3 arquivos, 16 testes aprovados (`onboardingNutritionHandoff`, `onboardingSignupLifecycle`, `socialRegistrationRecovery`). Flags locais de integração ativadas somente no subprocesso de teste. Log versionado do emulador restaurado ao conteúdo anterior.
- `git diff --check`: aprovado após restaurar o log do emulador.

Veredito: preparação local aprovada para solicitar autorização de publicação controlada, com as verificações operacionais acima como gates. Não equivale a validação de produção ou entrega real de push, nem autoriza ativação automática da funcionalidade.
