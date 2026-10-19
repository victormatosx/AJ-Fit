# Publicação controlada do piloto plan_snapshot

Este documento registra a publicação anterior. A evolução local atual está em
[plan-snapshot-main-workspace.md](plan-snapshot-main-workspace.md); sua liberação
global ainda não foi publicada em produção.

Execução autorizada pelo usuário em 18/10/2026, horário de São Paulo
(evidências de gerenciamento em 19/10/2026 UTC).

## Resultado

Backend publicado e ativado somente para `OkGay33revNItgUuEVHbK2pB32A2`, projeto
`ajfit-2f321`. **A homologação com sessão real Auth/App Check e a interface do
iPhone permanecem pendentes.** Não houve registro automático de refeições,
migração, chamada de IA, commit ou push.

Pacote utilizado:
`/Users/victor/.local/share/ajfit-plan-snapshot-pilot/pilot-ready`.
Seu manifesto revisado tem SHA-256
`a362f0d57b0d875d72599fce242942d043025b9c296f6ef3cb255d0e6d82ab27`.

## Publicação e verificação

1. Guard de integridade aprovado; flags inicialmente `false`, listas vazias.
2. Novo download somente de leitura confirmou as fontes das duas Functions de
   exclusão e o ruleset exatamente iguais às bases revisadas. Nenhuma divergência.
3. Publicadas exclusivamente:
   - `mutateNutritionDiaryV1`: nova Function Node 22, Gen 2, `us-central1`.
   - `onAccountDeletionRequested`: inventário de limpeza atualizado.
   - `cleanupPendingAccountDeletions`: mesmo inventário atualizado.
   - Firestore Rules delimitadas do protocolo.
4. As três Functions ficaram `ACTIVE`, com flags `false` e listas vazias antes da
   ativação. Rules publicadas comparadas integralmente com o pacote.
5. Configurada a allowlist exclusiva e republicada somente `mutateNutritionDiaryV1`.
6. Gerenciamento remoto confirmou a Function `ACTIVE` e os valores efetivos abaixo.
   O código-fonte e compilado baixados da revisão ativa foram comparados com o
   pacote: nove arquivos de contrato, política, handler, entrypoint e inventário
   coincidem exatamente.
7. As demais Functions preservaram seus `updateTime`; não foram publicadas geração,
   catálogo ou treino. Nenhum índice, Storage Rules ou outro recurso foi alvo.

Rules publicadas: SHA-256
`8e39e577775ff786fa7039871a0db167548356e3a9045252cb9bc26433b4dfcd`.
A proteção `lastPerformedLocalDate` permanece na íntegra. O gate legado continua
condicionado à ausência de `nutritionDiaryProtocol/current`, sem depender da flag.

## Configuração efetiva

Na Function `mutateNutritionDiaryV1`:

```dotenv
NUTRITION_PLAN_SNAPSHOT_ENABLED=true
NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS=OkGay33revNItgUuEVHbK2pB32A2
```

Nas duas Functions de exclusão, os valores permanecem `false` e lista vazia.
Elas não utilizam essa política para executar a limpeza existente.

No `.env.local` **do pacote isolado**:

```dotenv
EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED=true
EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS=OkGay33revNItgUuEVHbK2pB32A2
```

Foram adicionadas somente as sete configurações públicas Firebase já existentes,
com projeto conferido como `ajfit-2f321`. Nenhum segredo foi copiado para o cliente.
O `.env` do workspace principal não foi alterado. Essas variáveis locais não
atualizam automaticamente o bundle instalado no iPhone.

## Verificações executadas e limites

- Firebase Authentication consultado em leitura: UID existe e não está desabilitado.
- A chamada HTTP real sem Auth/App Check foi rejeitada com `401 UNAUTHENTICATED`.
  Isso comprova rejeição anônima; **não equivale** a chamada assinada do piloto ou
  de outro UID com App Check válido.
- A política pura idêntica à publicada, avaliada localmente com a configuração
  remota confirmada, autoriza o piloto, nega outro UID e nega novas adesões quando
  a flag é desligada. Não foi criada uma conta adicional.
- As leituras da conta não encontraram adesão nem recibos de operações snapshot.
- Uma transação exclusivamente de leitura conferiu os seis itens já existentes
  no diário de 18/10/2026: estrutura, totais de refeições, totais do dia e contagem
  consistentes. Nenhum item ou agregado foi regravado.
- As garantias de legado, concorrência, idempotência e CRUD após desativação têm
  os testes locais/emulador registrados no relatório de preparação: 661 testes de
  cliente aprovados, 574 de Rules e 490 de backend. Não foram recriados registros
  em produção para repetir essas provas.
- Não houve desligamento real do piloto para testar CRUD de uma conta aderida:
  a conta ainda não aderiu. Essa homologação continua pendente da ação no aparelho.

## iPhone: bloqueio identificado

O dispositivo está acessível e contém AJ Fit 1.0.6, build 1. O caminho do bundle
instalado é **idêntico** ao `installationURL` registrado na instalação Release do
rollback. Portanto, essa instalação não carrega o bundle novo por Metro.

É necessário preparar e instalar um Development Build compatível (com Firebase
e App Check configurados) ou outro binário atualizado. Não foi feito build nem
instalação nesta execução; a instrução recebida solicitava informar essa necessidade.
Após um Development Build compatível, o Metro deve ser iniciado **no pacote isolado**:

```sh
cd /Users/victor/.local/share/ajfit-plan-snapshot-pilot/pilot-ready
./node_modules/.bin/expo start --dev-client --clear
```

Não iniciar a homologação a partir do workspace principal, que preserva outros
trabalhos locais não publicados. A política nativa de App Check deve permanecer
ativa. A sessão assinada do piloto e a rejeição de outro UID autenticado ainda
precisam ser verificadas; não foram obtidas credenciais de outra conta nem
criadas identidades para simular sucesso.

## Rollback operacional

Desligar as duas flags e esvaziar as duas listas no pacote. Executar o guard e
publicar somente `functions:mutateNutritionDiaryV1`, conforme o relatório de
preparação. Atualizar o bundle do cliente compatível.

Manter endpoint, Rules, marcadores e recibos: contas já aderidas continuam usando
CRUD backend; desligar o piloto não reabre escritores antigos. Não apagar dados
para repetir testes ou tentar voltar ao contrato anterior. A primeira mutação
backend válida, inclusive manual, pode aderir a conta.

## Evidências

Diretório privado:
`/Users/victor/.local/share/ajfit-plan-snapshot-pilot/predeploy-evidence`.

- `remote-manifest.json`: nova comparação com a base publicada.
- `functions-disabled-deploy.log`, `rules-deploy.log`: publicação inicial.
- `stage1-verification.json`: Functions OFF/ACTIVE, Rules e demais Functions.
- `pilot-activation-deploy.log`: ativação do único endpoint.
- `final-deployment-verification.json`: flags remotas, Rules e probe anônimo.
- `published-source-check.json`: comparação da fonte efetivamente publicada.
- `deployed-policy-local-check.json`: avaliação local da política publicada.
- `auth-account-readonly.json`, `existing-diary-readonly-check.json`: leituras da conta.
- `iphone-readiness.json`: confirmação da instalação Release.
- `final-no-enrollment.json`: releitura final do protocolo e recibos.

**Veredito:** publicação e configuração do piloto concluídas. O teste da nova
funcionalidade no iPhone permanece bloqueado pelo binário instalado. Não declarar
homologação Auth/App Check ou registro ponta a ponta concluídos antes do cliente
compatível e das verificações reais pendentes.
