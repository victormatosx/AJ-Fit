# Validação local executada

Diretório de execução padrão: raiz do AJ Fit. Logs completos transitórios em `/tmp/ajfit-dual-ai`; resultados compactos preservados em `validation.json`. Nenhuma chamada paga foi executada.

```sh
# Aplicativo
npm run typecheck
./node_modules/.bin/vitest run --reporter=json --outputFile=/tmp/ajfit-dual-ai/app-tests-final.json
./node_modules/.bin/vitest run src/lib/__tests__/recentAuth.test.ts src/nutrition/ui/__tests__/generationStage.test.ts --reporter=json --outputFile=/tmp/ajfit-dual-ai/client-final-focused.json

# Functions, no diretório functions/
npm run typecheck
./node_modules/.bin/tsc -p tsconfig.build.json
NUTRITION_REAL_AI_SMOKE=0 ./node_modules/.bin/vitest run --reporter=json --outputFile=/tmp/ajfit-dual-ai/functions-tests-final.json
```

O pretypecheck existente sincroniza cópias compartilhadas locais. O `tsc` compila artefatos locais, sem executar `deploy`, EAS ou empacotamento iOS.

Emulador: comando executado a partir de `/tmp/ajfit-dual-ai`, com JDK21 apenas no ambiente do processo, porta 8188 e projeto demo. A configuração temporária aponta para as Rules locais sem editá-las. Suítes rodaram sequencialmente no mesmo ciclo do emulador; testes não compartilham concorrência acidental entre processos:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" \
  /Users/victor/CropSight-Solutions/AJ-Fit/node_modules/.bin/firebase emulators:exec \
  --config /tmp/ajfit-dual-ai/firebase.json --only firestore --project demo-ajfit-dual-ai \
  'cd /Users/victor/CropSight-Solutions/AJ-Fit/functions && NUTRITION_REAL_AI_SMOKE=0 ./node_modules/.bin/vitest run src/nutrition --testTimeout=30000 --reporter=json --outputFile=/tmp/ajfit-dual-ai/emulator-final.json && cd /Users/victor/CropSight-Solutions/AJ-Fit && ./node_modules/.bin/vitest run --config vitest.firestore.config.mts firestore-tests/nutrition.rules.test.ts --reporter=json --outputFile=/tmp/ajfit-dual-ai/rules-nutrition.json && ./node_modules/.bin/vitest run src/services/__tests__/nutritionRecovery.emulator.integration.test.ts --reporter=json --outputFile=/tmp/ajfit-dual-ai/client-recovery.json'
```

Para investigar a falha intermitente de `recentAuth`, fonte e teste foram lidos via `git show HEAD:<path>` e escritos numa pasta temporária isolada, com dependências locais por symlink. Hashes fonte/HEAD são iguais. A execução de oito casos passou, assim como o rerun focado na árvore atual. Não foi feita alteração para estabilizar o teste fora do escopo.

O schema anexado foi serializado de `functions/lib/nutrition/ai/review.js`; o impacto por export foi obtido percorrendo `require` relativos do código compilado. Isso não importa nem invoca os handlers remotos. Os hashes e diffs de preservação foram comparados com o snapshot capturado antes das edições desta tarefa.

As integrações de treino, Rules publicadas e reprodução isolada das 22 falhas anteriores têm evidência no relatório anterior. Não foram repetidas como consultas/alterações remotas nesta tarefa. Nenhum resultado ignorado foi convertido em aprovado.
