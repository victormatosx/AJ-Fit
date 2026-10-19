# Registro de opções por snapshot do plano

Estado atual: [integração no workspace principal e modo global](plan-snapshot-main-workspace.md).
O relato abaixo descreve a implementação original; a allowlist do piloto foi retirada
do código local e o fluxo de publicação isolado foi aposentado.

Implementação local. Não houve deploy, commit, push, publicação de build, chamada de IA ou acesso a dados reais de usuários nesta implementação.

## Comportamento

Com `EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED=true`, “Registrar esta opção” envia apenas a referência à opção persistida. A callable `mutateNutritionDiaryV1` autentica o UID, exige App Check, relê a opção e registra todos os seus alimentos em uma transação. Não utiliza Food Matcher, busca, similaridade, importação de alimentos, provider de IA ou novos vínculos de catálogo.

As origens aceitas são plano, alternativa e favorito. Favoritos são conferidos por igualdade estrutural contra uma opção do plano/alternativa original, pertencente ao mesmo usuário. Um favorito editável pelo cliente não se torna autoridade nutricional independente.

Cada item é `plan_snapshot`, com quantidade, unidade, preparo, referência ao item original e nutrientes da opção. A interface identifica “Estimativa da dieta”. Não há `foodId` nem `grams` nesses itens. As origens manuais existentes continuam utilizando seus IDs e cálculos próprios; receitas são recalculadas com os ingredientes reais e o peso final existente.

Não foram alterados geração, prompts, Nutrition Engine, planos já persistidos, receitas, catálogo ou favoritos. Histórico incompleto, sem nutrientes individuais obrigatórios, é recusado pelo registro automático; permanece disponível o registro manual.

## Contrato implementado

Payload ilustrativo, sem dados de usuário:

```ts
{
  action: 'register_option',
  requestId: '<UUID persistido no cliente>',
  expectedUid: '<UID da sessão que iniciou a operação>',
  origin: 'plan',
  documentId: '<ID existente do plano>',
  optionId: 'lunch-1',
  slot: 'lunch',
  localDate: '2026-10-18',
  timezone: 'America/Sao_Paulo'
}
```

O backend deriva o caminho de `request.auth.uid`. `expectedUid` deve coincidir com esse UID e evita aplicar uma intenção da conta anterior se a sessão mudar enquanto o cliente aguarda armazenamento/rede. Não é uma autorização fornecida pelo cliente. Campos extras, nutrientes, base, unidade ou referências de catálogo enviados no request de registro são rejeitados.

Item ilustrativo de teste sintético:

```ts
{
  id: 'ps_<hash da operação canônica>_0',
  source: 'plan_snapshot',
  quantity: 40,
  unit: 'g',
  preparationNote: 'Synthetic preparation',
  base: {
    name: 'Synthetic food', quantity: 40, unit: 'g',
    preparationNote: 'Synthetic preparation',
    nutrition: { kcal: 156, proteinG: 6.8, carbsG: 26.5, fatG: 2.8, fiberG: 4.2 }
  },
  planReference: {
    collection: 'nutritionPlans', documentId: '<plano original>',
    optionId: 'lunch-1', slot: 'lunch', itemIndex: 0
  },
  snapshot: { name: 'Synthetic food', kcal: 156, proteinG: 6.8, carbsG: 26.5, fatG: 2.8, fiberG: 4.2 },
  revision: 0,
  loggedAt: '<Timestamp backend>'
}
```

Os IDs `ps_` identificam documentos do diário; não são IDs inventados de alimentos. A referência identifica a posição real no array imutável da opção. O snapshot-base continua suficiente para editar o registro mesmo se o plano for posteriormente removido. Restauração de plano não regrava essa base.

## Cálculo e operações individuais

- Registro inicial: copia exatamente os nutrientes persistidos para a quantidade original, inclusive sua precisão.
- Edição: `nutrienteBase × novaQuantidade / quantidadeBase`, arredondado com a matemática compartilhada; nunca escala o resultado arredondado de uma edição anterior.
- Unidade e preparo permanecem os originais. `ml` e `unidade` não são convertidos em gramas. A quantidade editável deve ser positiva e finita; snapshots admitem até 5.000 na unidade original, seguindo o limite do contrato do plano. Registro manual mantém o limite de 10.000g.
- Totais da refeição: soma dos snapshots, arredondada a duas casas. Totais do dia: soma dos totais arredondados das refeições. Isso mantém a mesma hierarquia do plano e evita divergências quando a estimativa original possui mais de duas casas.
- Fibra ausente em uma opção impede seu registro automático; não é inferida como zero. Os contratos manuais históricos de fibra opcional são preservados.
- Editar exige a revisão do item lida pela interface. Uma revisão obsoleta retorna `DIARY_ITEM_CHANGED`, sem sobrescrever a edição concorrente. Excluir e mover atuam no item atualmente persistido e nunca recriam um item ausente.
- Movimentar conserva quantidade, base e snapshot; altera apenas o local e a revisão.
- Alterações manuais limpam o sinal de opção seguida. O registro em refeição vazia preenche `followedRecommendedOptionId`.
- Limites do protocolo novo: oito alimentos por refeição, 48 por dia. Uma opção não é truncada. Se não houver espaço, toda a operação falha. Registros anteriores não são apagados para caber no limite.

As estimativas não passam a ser composição nutricional comprovada. O registro não realiza uma nova validação clínica de alergênicos ou adequação da dieta.

## Transação, concorrência e idempotência

`functions/src/nutrition/diary/mutate.ts` concentra registro, inclusão manual, edição, exclusão e movimentação. Todas as operações leem, dentro da mesma transação:

1. Conta, lock de exclusão e protocolo da conta.
2. Recibo da operação; no registro, opção real e índice canônico de registro.
3. Documento do dia, metadados dos seis slots e consultas transacionais de itens, inclusive slots sem documento pai para detectar órfãos.
4. Documentos nutricionais necessários para inclusões/edições manuais e receitas.

Antes das escritas, são conferidos IDs, snapshots e agregados existentes. Inconsistência histórica retorna `DIARY_INCONSISTENT`; não há reparo silencioso, importação ou migração. O limite de leitura de itens é explícito; um slot com 49 registros é recusado para não fingir uma leitura completa. A comparação dos agregados admite somente margem de `0.000001` para doubles.

As escritas atualizam os documentos alterados, totais de refeição/dia, contagem e recibos atomicamente. Itens preexistentes inalterados não são regravados. O lock de exclusão é lido na transação. Consultas e metadados compartilhados provocam retry transacional sob concorrência; não há lista de itens capturada fora da transação no protocolo novo.

Há dois níveis persistentes de deduplicação, em `users/{uid}/nutritionDiaryOperationReceipts`:

- Request: mesmo identificador e payload retorna resultado anterior; payload diferente é recusado.
- Opção: data + slot + coleção/documento/opção original identificam um registro único. Requests diferentes, outros dispositivos e acesso via favorito/alternativa à mesma opção não duplicam o registro.

Os recibos não são removidos ao editar/excluir os alimentos. Um retry não restaura itens excluídos nem desfaz edições. A UI distingue registro novo de replay, informando neste último que edições e exclusões foram preservadas.

O cliente mantém o request pendente em AsyncStorage, por UID e payload, antes de chamar o backend. Falha/timeout conserva o request; sucesso remove a pendência. Reentrada após reinício reutiliza o mesmo identificador ao repetir a ação. O servidor também protege o registro da opção independentemente desse armazenamento local. Não existe processamento automático de uma pendência sem ação do usuário, nem worker de IA.

Política desta versão: a mesma opção só é registrada uma vez por data/slot/origem canônica. Uma segunda ingestão deliberada da mesma opção no mesmo dia não tem CTA próprio; pode ser registrada manualmente. Não tratar retry como uma segunda ingestão.

## Compatibilidade e adesão de contas

Flags independentes, **OFF por padrão**:

- Cliente: `EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED=true`.
- Backend: `NUTRITION_PLAN_SNAPSHOT_ENABLED=true`.

Atualização para o piloto controlado: essas flags **não autorizam globalmente**.
O backend exige também o UID em `NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS`; o cliente
usa `EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS` para apresentar o registro
automático e rotear a adesão. Listas ausentes/vazias negam adesão e novos
registros, inclusive com flag `true`. A autorização do cliente não é prova de
autorização do servidor. CRUD de contas já aderidas continua disponível após
revogação. Consulte [o pacote controlado e os comandos](plan-snapshot-pilot.md).

Nenhuma flag remota ou documento real foi criado. A adesão acontece apenas na primeira mutação backend bem-sucedida por um cliente compatível, com o backend habilitado. O servidor cria `users/{uid}/nutritionDiaryProtocol/current`, `{version:1, enrolledAt}` na mesma transação da mutação. Uma operação inválida não adere a conta.

Antes da adesão, clientes legados continuam no protocolo antigo, com suas Rules e limite diário de 36. Após a adesão, as Rules negam **todas** as escritas diretas de cliente no diário dessa conta: dia, refeição e itens, incluindo deletes. O cliente não pode criar/apagar o protocolo ou manipular recibos. Leitura do histórico pelo proprietário continua permitida; as demais funcionalidades não são bloqueadas.

Isso impede uma escrita antiga preparada antes da adesão de sobrescrever os novos agregados. O cliente atual consulta o protocolo para operações manuais mesmo com sua flag OFF, roteando contas já aderidas para o backend. A callable local de catálogo foi protegida para recusar contas aderidas, evitando um escritor Admin paralelo fora do protocolo. Ela não participa do registro por snapshot.

**Limite de compatibilidade:** aplicativos antigos não sabem renderizar a nova origem/unidade e suas edições passam a falhar depois da adesão. Portanto, antes de habilitar para uma conta, todos os dispositivos usados para editar seu diário devem estar na versão compatível. Não há alegação de suporte transparente à edição por builds antigos. A estratégia implementada é bloqueio seletivo de escritores antigos por conta, sem migração em massa. Sem adesão, a concorrência preexistente entre escritores legados continua sendo uma limitação do fluxo legado; o novo protocolo corrige as contas aderidas.

Desligar a flag backend interrompe novos registros automáticos e novas adesões, mas **mantém CRUD backend para contas já aderidas**. Não apagar o protocolo para fazer rollback: isso reabriria escritores antigos sobre dados de contrato novo. Restaurar escrita legada exigiria uma decisão e migração explícitas, fora desta entrega.

## Testes e evidências

Dados exclusivamente sintéticos e emulador de projeto `demo-ajfit-plan-snapshot`; Rules também executadas em ambiente local isolado. Node 22/Java 21.

- Pureza: unidades originais, base imutável, edição fracionária, arredondamento e fibra ausente.
- Transporte: payload sem nutrientes, duplo toque, request persistente após timeout/reinício e proteção de troca de UID.
- Backend: sete/oito itens integrais, seis refeições/48 itens, hierarquia de arredondamento, idempotência entre requests/dispositivos, replay após edição/exclusão, alternativa/favorito confrontados com origem real, erro em item tardio, rollback de falha durante persistência e overflow sem truncamento.
- Concorrência: registro simultâneo com inclusão, edição, exclusão e movimento; revisão obsoleta; bloqueio de escritor legado que leu o conjunto antes da adesão.
- Compatibilidade: receitas recalculadas, IDs históricos sem namespace atual, leitura/CRUD existentes, rollback de flag, conta sob exclusão, isolamento por UID e rejeição de nutrientes arbitrários.
- Rules: clientes não forjam o protocolo/recibos/snapshots e não escrevem em contas aderidas; fluxo legado funciona antes da adesão; proteção de treino `lastPerformedLocalDate` permanece.

Resultados finais (suítes com sobreposição; não somar como casos distintos):

| Verificação | Resultado |
| --- | --- |
| App/nutrição/tipos/traduções | 1.418 passaram; 3 ignorados |
| Functions/nutrição + inventário de exclusão no emulador | 255 passaram; 1 smoke real de IA ignorado |
| Smoke final do novo protocolo no emulador | 27 passaram |
| Rules completas | 576 passaram |
| TypeScript app e Functions | Sem erros |
| Sync nutricional | Coerente; zero arquivos a sincronizar |
| ESLint dos arquivos afetados | Sem erros; dois avisos preexistentes em NutritionShell |

Logs locais em `/tmp/ajfit-plan-snapshot-baseline/`: `app-final.log`, `emulator-final.log`, `emulator-smoke-final.log`, `rules-final.log`, `app-types.log`, `backend-types.log`, `lint-final.log`.

Na primeira regressão backend, dois testes antigos de onboarding excederam o limite de cinco segundos do runner sob contenção. A repetição com `--testTimeout 30000` passou; nenhum timeout de produção foi ampliado. O smoke real de IA permanece ignorado. Os testes de UI são locais com componentes nativos simulados, não homologação física.

## Homologação antes de publicar

1. Revisar o diff contra as alterações locais preexistentes; esta entrega não autoriza publicar outros trabalhos pendentes no workspace.
2. Executar sync, TypeScript, testes e Rules no emulador. Usar `--project demo-ajfit-plan-snapshot` explicitamente; não reutilizar o projeto de produção como ambiente de teste.
3. Antes de iniciar o app, conferir a configuração Firebase do cliente: o `.env` existente não foi alterado e pode apontar para produção. Auth, Firestore e Functions precisam ser direcionados explicitamente ao ambiente isolado/emuladores; essa configuração visual de homologação ainda deve ser preparada e verificada. Não ativar as flags no cliente apontado para produção. Em ambiente isolado, carregar plano sintético com oito alimentos, incluindo `ml`/`unidade`, catálogo/receita sintéticos e histórico manual válido.
4. Configurar as duas flags apenas nesse ambiente. O sinal público é incorporado ao bundle: mudança exige recompilação/reload do bundle apropriado, não documento remoto.
5. Confirmar botão → registro integral → sucesso somente depois da resposta. Simular perda da resposta e reinício; repetir. Editar/excluir e repetir o registro: alterações devem permanecer.
6. Abrir dois clientes compatíveis e executar todas as combinações de registro/manual. Conferir documentos, contagens e totais. Testar também um escritor antigo antes/depois da adesão e confirmar a negação posterior.
7. Desligar as flags e confirmar que contas aderidas ainda editam/excluem/movem pelo backend, sem reabrir escrita direta.
8. Homologar visualmente em dispositivo/simulador isolado: quantidade fracionária, teclado, unidade, preparo, aviso de estimativa, mensagens de falha e replay, favoritos e alternativas.
9. Somente após autorização futura, publicar Rules com o bloqueio seletivo e Functions com flags inicialmente OFF; disponibilizar cliente compatível e definir política de atualização dos dispositivos **antes** da ativação. Não habilitar o backend antes das Rules compatíveis. Não ativar o novo cliente antes de seu endpoint estar disponível.
10. Nenhum histórico precisa ser migrado ou regravado. Dias inconsistentes precisam de diagnóstico próprio autorizado, não de correção automática nesta funcionalidade.

## Riscos e limites restantes

- UI/dispositivo e transporte real Auth/App Check não foram homologados. Enforcement está configurado na callable; testes chamam handlers e usam Rules Unit Testing.
- Não foram medidos latência, leituras cobradas ou custo reais. Cada operação lê o dia limitado a 48 itens, os seis slots, recibos e fontes necessárias; receitas consultam até seis ingredientes. Não consulta o catálogo inteiro nem chama IA.
- Recibos têm retenção sem TTL para manter idempotência após exclusões. Crescem com operações; são removidos pela exclusão de conta. Não limpar indiscriminadamente enquanto houver possibilidade de replay.
- Conexão é necessária para confirmar mutações. Pendências não são consideradas sucesso offline.
- O protocolo não transforma estimativas de IA em dados nutricionais de catálogo, nem verifica contaminação cruzada.
- A função de geração por catálogo de outro trabalho local não foi ativada nem corrigida nesta entrega. O registro por snapshot não depende dela.

## Inventário de exclusão de conta

`nutritionDiaryProtocol` e `nutritionDiaryOperationReceipts` foram acrescentados ao inventário nutricional existente. A exclusão utiliza os mecanismos de limpeza já existentes; nenhuma exclusão real foi executada.

## Arquivos desta implementação

Somente estes arquivos diferem do estado encontrado no início desta tarefa:

- `docs/nutrition/canonical/nutrition_constraints.json`
- `docs/nutrition/plan-snapshot-diary.md`
- `firestore-tests/nutrition.rules.test.ts`
- `firestore.rules`
- `functions/src/accountDeletion/firestoreCleanup/resources.ts`
- `functions/src/index.ts`
- `functions/src/nutrition/__tests__/planSnapshotDiary.integration.test.ts`
- `functions/src/nutrition/catalogLinking/logMeal.ts`
- `functions/src/nutrition/diary/mutate.ts`
- `scripts/syncNutritionToFunctions.cjs`
- `src/i18n/resources/en/nutrition.json`
- `src/i18n/resources/es/nutrition.json`
- `src/i18n/resources/pt-BR/nutrition.json`
- `src/nutrition/diary/__tests__/snapshot.test.ts`
- `src/nutrition/diary/snapshot.ts`
- `src/nutrition/foodLog/recent.ts`
- `src/screens/nutrition/NutritionDiaryScreen.tsx`
- `src/screens/nutrition/NutritionShell.tsx`
- `src/screens/nutrition/RegisterMealScreen.tsx`
- `src/screens/nutrition/__tests__/nutritionDiaryPresentation.test.ts`
- `src/screens/nutrition/__tests__/nutritionShellRegression.test.ts`
- `src/screens/nutrition/__tests__/registerMealScreen.test.ts`
- `src/services/__tests__/nutritionDiaryProtocol.test.ts`
- `src/services/nutritionDiary.ts`
- `src/services/nutritionDiaryProtocol.ts`
- `src/types/nutrition.ts`
