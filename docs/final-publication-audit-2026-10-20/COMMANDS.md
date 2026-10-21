# Validação local — comandos e reprodução

Nenhum comando de publicação foi executado. Logs e JSONs completos desta sessão estão em `/tmp/ajfit-final-audit/`; o resumo persistente está em `validation.json`.

```sh
npm run typecheck
npm --prefix functions run typecheck
npm --prefix functions run build
npm test -- --reporter=json --outputFile=/tmp/ajfit-final-audit/app-tests-final.json
npm --prefix functions test -- --reporter=json --outputFile=/tmp/ajfit-final-audit/functions-tests-final.json
```

O build acima é apenas a compilação TypeScript local das Functions. Os scripts existentes sincronizam os módulos compartilhados e limpam/recriam `functions/lib`. Nada é enviado ao Firebase.

Para Firestore, foi usada uma configuração temporária com host `127.0.0.1`, porta `8188`, UI desligada, projeto `demo-ajfit-final-audit` e caminho absoluto das Rules locais. JDK21 ficou restrito aos comandos de emulador; não houve alteração global do Java:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" \
./node_modules/.bin/firebase emulators:exec \
  --config /tmp/ajfit-final-audit/firebase.json --only firestore \
  --project demo-ajfit-final-audit 'zsh /tmp/ajfit-final-audit/emulator-tests.sh'
```

Dentro do emulador, os comandos efetivamente utilizados incluíram:

```sh
# A partir de functions/, com FIRESTORE_EMULATOR_HOST fornecido pelo CLI:
NUTRITION_REAL_AI_SMOKE=0 ./node_modules/.bin/vitest run src/nutrition --testTimeout=30000

WORKOUT_LIFECYCLE_AUTHORITY_INTEGRATION=1 \
INSTALL_ACTIVE_WORKOUT_PROGRAM_INTEGRATION=1 \
FINALIZE_WORKOUT_SESSION_INTEGRATION=1 \
EXERCISE_SUBSTITUTION_INTEGRATION=1 \
./node_modules/.bin/vitest run \
  src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts \
  src/workoutLifecycle/__tests__/installActiveWorkoutProgram.integration.test.ts \
  src/workoutLifecycle/__tests__/finalizeWorkoutSession.integration.test.ts \
  src/workoutLifecycle/__tests__/exerciseSubstitution.integration.test.ts

# A partir da raiz do repositório, dentro do mesmo emulador:
./node_modules/.bin/vitest run --config vitest.firestore.config.mts
./node_modules/.bin/vitest run \
  src/services/__tests__/nutritionClientJourney.emulator.integration.test.ts \
  src/services/__tests__/nutritionRecovery.emulator.integration.test.ts

FIRST_PROGRAM_GENERATION_INTEGRATION=1 ONBOARDING_SIGNUP_LIFECYCLE_INTEGRATION=1 \
./node_modules/.bin/vitest run --no-file-parallelism \
  src/services/__tests__/firstProgramGeneration.integration.test.ts \
  src/services/__tests__/onboardingSignupLifecycle.integration.test.ts
```

Os comandos usaram reporters JSON e arquivos separados em `/tmp`, omitidos nos exemplos internos por legibilidade. O novo teste de recuperação passou no emulador com o restante de nutrição.

## Baseline e Rules publicadas

- Criada cópia isolada dos arquivos rastreados de HEAD por `git archive`, com dependências locais por symlink, sem checkout/reset/stash na árvore principal. Os 13 arquivos com as 22 falhas do app reproduziram exatamente os mesmos nomes de falha. A falha do diário nutricional também foi reproduzida nessa cópia com as Rules de HEAD.
- Rules efetivamente publicadas foram obtidas por GET da release `cloud.firestore` e GET de seu ruleset; snapshot em `production-firestore.rules.snapshot`. As APIs de Functions foram apenas listadas. As duas contagens do catálogo usaram `runAggregationQuery`, operação de leitura, sem consultar dados de usuários.
- Para reproduzir a incompatibilidade, copiar `firestore-tests/workoutLifecycle.rules.test.ts` para uma árvore temporária com suas dependências, aplicar **somente nessa cópia** `compatibility-fixture.patch`, e executar os dois testes selecionados abaixo contra o snapshot publicado e depois contra as Rules locais. O patch retira `primaryPlace` da fixture e usa ativação `INITIAL_PROGRAM` para que a exceção de migração não pule o validador. O formato fica equivalente aos campos novos emitidos pelo aplicativo, sem `limits`.

```sh
./node_modules/.bin/vitest run --config vitest.firestore.config.mts \
  firestore-tests/workoutLifecycle.rules.test.ts \
  -t 'allows an owner to create the structurally linked baseline atomically and read it|accepts the exact flexible ProgramInstance snapshot shape from production'
```

As duas variantes falham nas Rules publicadas e passam nas locais. Os testes originais de migração passaram também nas Rules publicadas, mostrando por que não bastava executar apenas esse caminho.

`BUILD-FILES.json` enumera os deltas de runtime do cliente. `preservation.json` confirma HEAD, Rules locais, log preexistente e diffs das Functions de treino inalterados.
