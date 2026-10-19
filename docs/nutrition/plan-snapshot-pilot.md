# Piloto controlado de registro por plan_snapshot

**Histórico.** O fluxo isolado foi aposentado. Consulte a
[integração atual no workspace principal](plan-snapshot-main-workspace.md).
Não executar os comandos históricos abaixo para a nova liberação.

Atualização: a publicação e ativação posteriores foram autorizadas e executadas.
Consulte o [registro de publicação e pendências reais](plan-snapshot-pilot-publication.md).
O restante deste documento descreve o pacote e o estado de preparação anterior.

Estado: preparado localmente, **sem deploy, ativação, migração, commit ou push**.
Projeto alvo de uma futura publicação autorizada: `ajfit-2f321`.
Único UID autorizado para configurar o piloto: `OkGay33revNItgUuEVHbK2pB32A2`.

## Autorização e compatibilidade

O servidor exige simultaneamente:

```dotenv
NUTRITION_PLAN_SNAPSHOT_ENABLED=true
NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS=OkGay33revNItgUuEVHbK2pB32A2
```

O padrão preparado é `false` com lista vazia. Não há flag que autorize todas as
contas: mesmo `true` exige pertencimento exato à lista. A configuração é do
ambiente da Function, nunca do payload ou de um documento editável pelo cliente.
Não criar documentos de adesão manualmente.

O cliente exige as correspondentes variáveis `EXPO_PUBLIC_` e o UID da sessão.
Usuários não autorizados mantêm o botão e o comportamento manual legados. O
registro automático aparece somente na sessão habilitada. Alterar as variáveis
públicas não contorna a autorização backend.

A primeira mutação backend válida cria o protocolo na mesma transação. Isso
inclui uma inclusão manual feita pelo piloto com o roteamento novo habilitado.
Contas não aderidas não são migradas. Para contas aderidas, todas as operações
manuais continuam no backend mesmo após remoção da allowlist/desligamento da
flag. As Rules continuam bloqueando escritores antigos, independentemente das
flags. Não apagar protocolo ou recibos para fazer rollback.

Replays de requests já concluídos podem devolver o resultado antigo após a
desativação; não regravam nem recriam itens. Novos registros são recusados.

## Isolamento e evidência remota

Pacote revisado nesta execução:

`/Users/victor/.local/share/ajfit-plan-snapshot-pilot/pilot-ready`

Não publicar os diretórios preliminares `package`, `release` e `controlled-release` existentes ao lado.
Não publicar diretamente o workspace principal: ele conserva trabalhos anteriores
de geração por catálogo, prompts, providers e callables que não integram o piloto.

O preparador cria uma árvore separada sem alterar ou reverter o workspace:

- Backend baseado no download **atual** das duas Functions de exclusão publicadas.
- Rules baseadas no ruleset publicado, com patch específico do protocolo.
- Cliente baseado em HEAD, preservando as três correções independentes de rollback
  (ranking/teste e MealDetailsScreen) e aplicando somente contratos/fluxos snapshot.
- Entrypoint do backend com exatamente três exports: `mutateNutritionDiaryV1`,
  `onAccountDeletionRequested`, `cleanupPendingAccountDeletions`.
- Os arquivos existentes de geração, prompts, providers e treino do backend são
  mantidos byte a byte como publicados. Não são alvos de publicação.
- Nenhum `catalogBinding`, `safetyEvidence`, `excludedSubstances`, callable de
  catálogo ou código da geração vinculada entra nas mudanças do pacote.
- Sem `.env` do workspace, credenciais, dados de usuários ou dependências copiadas.
  Links locais de node_modules foram adicionados somente para executar validações.

Evidência: `../evidence/remote-manifest.json`, `pilot-evidence/manifest.json` e
`pilot-evidence/published-rules.patch` dentro/ao lado do pacote. A verificação
remota em 2026-10-19 UTC confirmou:

| Base | SHA-256 |
| --- | --- |
| Rules publicadas | `7a707fbadbdbf55c8d5fe8c281fbb4c4da06525d39e3cc8b4b587bcf372a63ed` |
| Fonte publicada das duas Functions de exclusão | `3f147d5753f2f808d66a56edaebaf61078693c8eda106daf843f8c6e10a8e10f` |

As únicas fontes **existentes** do backend modificadas são `src/index.ts`,
`src/accountDeletion/firestoreCleanup/resources.ts` e o contrato compartilhado
`src/nutrition/shared/types/nutrition.ts`. Acrescentam-se o handler, a política
de piloto, a matemática snapshot compartilhada e testes. O inventário de exclusão
adiciona somente `nutritionDiaryProtocol` e `nutritionDiaryOperationReceipts`.

O package.json isolado altera apenas hooks de preparação: sincroniza nutrição,
preservando os fontes gerados de treino publicados. O prebuild comum do workspace
também sincronizava os tipos nutricionais para o Prescription Engine; o verificador
detectou esse efeito e o pacote final o exclui. Nenhum script de treino do
workspace foi alterado.

O guard local valida hashes antes/depois do build, recusa novas fontes não
revisadas e aceita na configuração apenas lista vazia ou o único UID piloto.
Mudanças de fontes requerem novo pacote/revisão. Não mudar o manifesto para
silenciar divergências. Atualização remota das bases também bloqueia o preparador.

## Reprodução local (não publica)

No workspace original, com acesso de leitura já autorizado, Node 22 e Python 3.12+:

```sh
node scripts/nutrition/verifyPlanSnapshotPilotRemote.cjs /caminho/absoluto/evidencia-nova
python3 scripts/nutrition/preparePlanSnapshotPilot.py \
  --evidence /caminho/absoluto/evidencia-nova \
  --output /caminho/absoluto/pacote-novo
```

O destino deve ser novo e fora do workspace. O verificador faz somente GETs e a
operação de gerenciamento `generateDownloadUrl`, que gera uma URL temporária de
leitura da fonte; não publica Functions nem guarda URL/token no manifesto.
Se as bases publicadas mudarem, parar e revisar a diferença; não atualizar hashes
esperados automaticamente. Não foram lidos documentos de usuários nesta preparação.

O pacote novo precisa das dependências exatas dos lockfiles. Nesta máquina os
links de node_modules apontam para as instalações existentes do projeto. Não
incluir esses links em um arquivo de entrega. O Firebase CLI ignora node_modules.

## Comandos de publicação futura — NÃO executados

Somente após autorização explícita, revisão das evidências e confirmação das bases
remotas ainda iguais. Usar exatamente o diretório isolado abaixo. Não executar
`firebase deploy`, `--only functions` ou scripts genéricos de deploy do package.json:
o entrypoint reduzido não representa a lista completa de Functions de produção.

```sh
cd /Users/victor/.local/share/ajfit-plan-snapshot-pilot/pilot-ready
export PATH="/Users/victor/.nvm/versions/node/v22.23.2/bin:$PATH"
node scripts/nutrition/assertPlanSnapshotPilotPackage.cjs
./node_modules/.bin/firebase deploy --project ajfit-2f321 --only functions:mutateNutritionDiaryV1,functions:onAccountDeletionRequested,functions:cleanupPendingAccountDeletions
./node_modules/.bin/firebase deploy --project ajfit-2f321 --only firestore:rules
```

Essa primeira publicação usa flag `false` e lista vazia. Conferir os alvos no
resumo do CLI antes de aceitar qualquer operação inesperada; interromper se ele
propuser outras Functions, exclusões ou índices. Não ativar cliente antes das
Rules e endpoint compatíveis. Revalidar a publicação remota somente em leitura.

As Functions de exclusão mantêm os mecanismos globais já existentes; sua mudança
é somente conhecer as duas coleções novas. Não executar exclusões reais como
parte da homologação.

### Habilitar somente o piloto, após autorização

No **pacote isolado**, ajustar os dois pares de configuração, mantendo os demais
valores locais do cliente quando existirem:

```sh
python3 - <<'PY'
from pathlib import Path
uid = 'OkGay33revNItgUuEVHbK2pB32A2'
for name, prefix in [('functions/.env.ajfit-2f321', ''), ('.env.local', 'EXPO_PUBLIC_')]:
    p = Path(name)
    lines = p.read_text().splitlines()
    keys = {prefix + 'NUTRITION_PLAN_SNAPSHOT_ENABLED': 'true', prefix + 'NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS': uid}
    lines = [line for line in lines if line.split('=', 1)[0] not in keys]
    p.write_text('\n'.join(lines + [k + '=' + v for k, v in keys.items()]) + '\n')
PY
node scripts/nutrition/assertPlanSnapshotPilotPackage.cjs
./node_modules/.bin/firebase deploy --project ajfit-2f321 --only functions:mutateNutritionDiaryV1
```

O arquivo cliente preparado contém só as flags, sem configuração Firebase. Antes
de iniciar Metro, disponibilizar **somente as variáveis públicas Firebase** já
usadas pelo aplicativo e conferir projeto `ajfit-2f321`. Não copiar segredos de
backend para `EXPO_PUBLIC_`. A configuração das flags não cria adesão: ela acontece
somente com uma mutação válida do piloto no aparelho.

Se existir Development Build compatível e App Check operacional, usar
`./node_modules/.bin/expo start --dev-client --clear` a partir do pacote isolado.
O último Release documentado não carrega atualizações do Metro; nesse caso será
necessário um Development Build compatível, a preparar/instalar somente com a
autorização correspondente. Não desabilitar App Check para contornar falhas.

### Desabilitar o piloto

No bloco Python acima, substituir o valor `true` por `false` e o valor da lista
por string vazia, nos dois arquivos. Depois executar o guard e publicar **somente**
`functions:mutateNutritionDiaryV1` com o comando acima; recarregar o bundle cliente.
Não reverter Rules, apagar endpoint, marcador, recibos ou itens snapshot.
As contas aderidas conservam CRUD via backend, inclusive de itens manuais.

## Homologação e riscos

Usar exclusivamente a conta piloto e seu plano existente. Não gerar nova dieta
nem chamar IA. Conferir registro integral (inclusive sete/oito itens), unidades,
preparo, indicação de estimativa, totais, repetição após timeout/reinício, edição,
exclusão e movimentação. Repetir após excluir um item e confirmar que ele não
reaparece. Desligar piloto e conferir CRUD e negação de novos registros.

No emulador, testar outro UID diretamente e um escritor legado antes/depois da
adesão. Não criar outras contas ou modificar usuários de produção para testar
negações. Aprovação exige ausência de duplicação, totais consistentes e nenhuma
adesão indevida. Nunca limpar recibos para repetir um caso em produção.

Após adesão, builds antigos da conta são bloqueados para escrita e podem não
renderizar corretamente unidades/snapshots. Todos os dispositivos que editam o
diário piloto precisam de cliente compatível. A adesão não é reversível por uma
simples flag. Dias históricos inconsistentes falham sem reparo automático.
Retenção de recibos é necessária para idempotência. Latência, Auth/App Check real
e apresentação no iPhone permanecem pendentes; os testes locais não comprovam
essas etapas.

## Resultados finais desta preparação

Executados no pacote final `pilot-ready`, projeto local
`demo-ajfit-snapshot-pilot`, Firestore Emulator em `127.0.0.1:8185`:

| Verificação | Resultado |
| --- | --- |
| Cliente/nutrição, transporte e guard de publicação | 661 passaram; 3 ignorados |
| Rules completas, incluindo `lastPerformedLocalDate` e escritores antigos | 574 passaram |
| Backend snapshot/piloto e exclusão de conta | 490 passaram; 27 ignorados |
| Build Functions e TypeScript cliente | Sem erros |
| Guard após o build | Aprovado; fontes e configurações conferidas |
| ESLint dos arquivos desta correção | Zero erros; dois avisos anteriores de NutritionShell |

As Rules do pacote têm 574 testes, em vez dos 576 do workspace anterior, porque
os dois testes específicos da geração vinculada ao catálogo não integram o piloto.

Os 27 ignorados no backend compreendem 26 casos opt-in existentes não habilitados
neste ambiente e **uma** verificação estática de index.ts do backend completo.
Ela exige também o export `requestAccountDeletion`, que deliberadamente não é um
dos três alvos do pacote mínimo. Essa verificação falhou na primeira execução
ampla e foi excluída nominalmente na execução final; os outros testes do mesmo
arquivo continuaram executados. Nenhum teste de autorização, CRUD, idempotência,
concorrência, agregados ou Rules foi excluído. O entrypoint reduzido é conferido
separadamente no manifesto e no guard. O endpoint `requestAccountDeletion`
existente deve permanecer publicado e não é alvo de alteração/exclusão.

A suíte snapshot cobre também a exclusão real, no emulador, do protocolo e dos
recibos da conta sintética, preservando os de outro UID e o catálogo global.
O guard foi testado contra alteração de fonte, inclusão de fonte não revisada,
outro UID e configuração com múltiplos UIDs.

Logs: `evidence/final-emulator.log`, `final-client-tests.log`, `final-build.log`,
`final-client-types.log` e `lint-final.log`. Os testes não chamam provider de IA.
Não houve leitura de dados nutricionais de usuários nesta etapa nem escrita em
produção. Auth/App Check real e homologação física não foram executados.

## Arquivos desta correção no workspace

Modificados:

- `functions/src/nutrition/diary/mutate.ts`
- `functions/src/nutrition/__tests__/planSnapshotDiary.integration.test.ts`
- `src/services/nutritionDiaryProtocol.ts`
- `src/services/__tests__/nutritionDiaryProtocol.test.ts`
- `src/screens/nutrition/NutritionShell.tsx`
- `docs/nutrition/plan-snapshot-diary.md`

Criados:

- `functions/src/nutrition/diary/pilot.ts`
- `functions/src/nutrition/__tests__/planSnapshotPilot.test.ts`
- `src/services/__tests__/nutritionPlanSnapshotPilotPackage.test.ts`
- `scripts/nutrition/verifyPlanSnapshotPilotRemote.cjs`
- `scripts/nutrition/preparePlanSnapshotPilot.py`
- `scripts/nutrition/assertPlanSnapshotPilotPackage.cjs`
- `scripts/nutrition/fixtures/planSnapshotProtocol.rules.patch`
- `docs/nutrition/plan-snapshot-pilot.md`

Rules e arquivos de exclusão do workspace não foram alterados novamente nesta
correção. Suas versões específicas do piloto foram construídas somente na cópia
isolada, sobre as bases publicadas. Os demais trabalhos locais foram preservados.
