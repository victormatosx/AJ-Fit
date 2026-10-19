# plan_snapshot no workspace principal

Integração local concluída em 18/10/2026. **Nenhum deploy de produção foi
executado nesta etapa.** A liberação global está implementada e configurada
localmente; produção continua na revisão anterior do piloto até nova autorização.

## Integração e autorização

O núcleo do pacote validado já existia no workspace principal: contratos,
matemática, transação, recibos, telas e diário coincidiam byte a byte nos arquivos
comparados. Não foi copiada a árvore isolada sobre o projeto. As alterações de
geração vinculada ao catálogo, treino, Rules e demais trabalhos foram preservadas.

- `functions/src/nutrition/diary/config.ts` substitui a política por UID por um
  kill switch global: `NUTRITION_PLAN_SNAPSHOT_ENABLED=true`.
- Auth, App Check, UID da sessão, conta ativa, lock de exclusão, propriedade do
  plano, snapshots e transação permanecem obrigatórios. Nenhum ID ou nutriente
  arbitrário do cliente se torna autoridade.
- O cliente habilita a opção para qualquer UID autenticado quando
  `EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED=true`. Não há allowlist.
- O manual de uma conta **não aderida** continua legado, mesmo com a flag ligada.
  O cliente consulta o protocolo e só passa suas operações manuais ao backend
  depois da adesão. Uma corrida com um escritor legado é recusada pelas Rules;
  não há sobrescrita dos agregados pelo escritor obsoleto.
- As Rules continuam bloqueando escritores antigos para contas aderidas,
  independentemente da flag. CRUD backend de contas aderidas funciona após
  desativação. Recibos e marcadores não são apagados no rollback.
- O registro inicial por snapshot relê plano/alternativa/favorito e mantém
  quantidade, unidade, preparo e estimativas. Não utiliza Food Matcher, pesquisa,
  correspondência por nome ou IA. Favoritos precisam corresponder à opção original.
- Grava até oito alimentos integralmente, com documentos individuais, base
  imutável, revisão e edição proporcional. Limite total: oito itens por refeição
  e 48 por dia; falta de espaço causa falha integral, nunca truncamento.

## Ambiente e iPhone

O `.env` principal já continha Firebase, chaves públicas RevenueCat iOS/Android
e o token Debug local de App Check. O ambiente isolado não continha RevenueCat,
explicando `RevenueCat não configurado`. Não foram inventadas/substituídas chaves.
As configurações existentes foram preservadas; acrescentou-se somente a flag
snapshot local. O arquivo Functions local contém a flag global, sem allowlist.

`npm run check:native-env` usa o resolvedor de ambiente do próprio Expo, detecta
Firebase/RevenueCat ausentes e confere a correspondência do token Debug gerado
com o ambiente, sem imprimir credenciais. O exemplo `.env.example` mantém a flag
desligada como padrão seguro para novas instalações.

O build Debug do aplicativo principal compilou com zero erros. O instalador Expo
ficou parado na conexão Wi-Fi com o iPhone; o mesmo binário foi instalado com
`xcrun devicectl`, sem uninstall e sem alteração de código nativo. O app abriu
usando o Metro do workspace principal. USB é recomendado se o instalador do Expo
voltar a bloquear nessa conexão de rede.

Foi observada no aparelho a sessão existente restaurada, RevenueCat configurado
e assinatura resolvida, sem o erro de configuração. App Check foi verificado por
uma requisição de token do SDK usando o provider nativo real: sucesso registrado
no diagnóstico de desenvolvimento. O token não é impresso, retornado à UI ou
persistido por esse diagnóstico. A instrumentação só executa em `__DEV__` com
o módulo nativo presente, uma vez por inicialização da instância JS. Produção e
enforcement não mudam. Os avisos de Require cycle permaneceram sem alterações.

Não foi registrado alimento em produção. A validação transacional de refeições
reais e da liberação para outros UIDs em produção depende do deploy autorizado
e de uma homologação posterior; não se confunde com obter token no aparelho.

Comandos normais no projeto principal:

```sh
cd /Users/victor/CropSight-Solutions/AJ-Fit
npm run check:native-env
npx expo run:ios --device
```

O Metro de desenvolvimento está em execução na porta 8081 a partir desse
workspace. Não usar os diretórios de publicação isolados anteriores.

## Testes e evidências

Dados sintéticos, Firestore Emulator, projeto `demo-ajfit-main-snapshot`:

| Verificação | Resultado |
| --- | --- |
| Cliente/nutrição, RevenueCat e App Check | 726 aprovados; 3 ignorados |
| Rules completas, incluindo treino e escritores antigos | 576 aprovados |
| Functions de nutrição e limpeza nutricional | 281 aprovados; 3 ignorados |
| TypeScript cliente e Functions | Sem erros |
| Build Functions | Aprovado |
| Build iOS Debug | Aprovado, zero erros |
| Lint das alterações | Zero erros; dois avisos preexistentes em NutritionShell |

As suítes incluem sete/oito itens, g/ml/unidade, estimativas e base imutável,
arredondamento, UIDs distintos sem allowlist, isolamento entre usuários, request
adulterado, rollback por flag, idempotência após edição/exclusão, concorrência
com operações manuais e preservação de `lastPerformedLocalDate`. Os casos reais
de IA continuam ignorados; o opt-in de limpeza completa externa não foi habilitado.
As contagens de suítes e smokes se sobrepõem; não somar como testes distintos.

Evidências locais em `/tmp/ajfit-main-snapshot-integration/`:
`client-tests-final.log`, `emulator.log`, `functions-build.log`,
`client-types-final.log`, `backend-types-final.log`, `lint-final.log`,
`ios-build.log`, `device-install.json`, `device-confirmation.json`,
`remote-inventory.json` e `final-data-readonly.json`.
O diretório é privado; logs brutos não devem ser publicados.

## Produção e publicação futura

A consulta somente de leitura confirmou 75 Functions inventariadas. O endpoint
atual está ACTIVE com a política anterior de piloto. As Rules publicadas têm SHA
`8e39e577775ff786fa7039871a0db167548356e3a9045252cb9bc26433b4dfcd` e já contêm o
protocolo necessário para todos os UIDs, sem filtro de UID nas Rules. Não precisam
de nova publicação para a mudança de autorização do handler.

O arquivo local de Rules contém também mudanças independentes de outro trabalho;
**não publicar esse arquivo inteiro nesta liberação**. As duas Functions de
exclusão já conhecem protocolo/recibos e não necessitam de nova publicação.

O novo verificador somente de leitura interrompe se as Rules remotas mudarem e
salva as revisões das Functions para comparação posterior. Comandos abaixo
**não foram executados como deploy** e exigem nova autorização:

```sh
node scripts/nutrition/checkPlanSnapshotDeployment.cjs /tmp/ajfit-before-global.json
npm --prefix functions run build
./node_modules/.bin/firebase deploy --project ajfit-2f321 --only functions:mutateNutritionDiaryV1
```

Executar com Node 22, revalidar o diff e as bases remotas imediatamente antes da
publicação. A análise carrega os exports existentes do projeto principal; o alvo
seletivo deve continuar sendo somente essa Function. Não usar deploy genérico.
Depois conferir estado ACTIVE, configuração global sem allowlist efetiva, demais
revisões inalteradas e o mesmo ruleset. Nenhum worker de geração, catálogo, treino,
Rules ou índice deve ser publicado como efeito colateral.

## Arquivos desta integração

- Política backend: novo `diary/config.ts`, alteração de `diary/mutate.ts` e retirada
  de `diary/pilot.ts`.
- Cliente: `nutritionDiaryProtocol.ts`, `NutritionShell.tsx` e seus testes.
- App Check: diagnóstico nativo Debug em `firebaseAppCheck.ts` e testes.
- Ambiente: `scripts/checkNativeEnvironment.cjs`, teste de preflight, script npm,
  `.env.example` e flags locais; sem troca de credenciais.
- Testes backend: substituição do teste do piloto por `planSnapshotConfig.test.ts`
  e adaptação da integração para UIDs distintos.
- Publicação: `scripts/nutrition/checkPlanSnapshotDeployment.cjs` somente leitura.
- Retirados os preparadores/guard/patch/teste exclusivos do pacote isolado. Cópias
  locais anteriores foram preservadas no diretório privado de evidências; os
  relatórios do piloto continuam como histórico e não são instruções atuais.

Não foram alterados os arquivos de geração/IA, algoritmos de treino, Rules ou
históricos nutricionais. Não houve migração, commit, push ou chamada paga de IA.
