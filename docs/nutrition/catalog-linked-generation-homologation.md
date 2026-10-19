# Auditoria final e preparação da homologação — geração vinculada ao catálogo

Data: 18/10/2026. Branch `main`, HEAD `83566d76f20e8cc44b022489311cd2f358162e0b`.

## 1. Resumo executivo

**Veredito: não aprovar a ativação neste estado.** A arquitetura principal está integrada e os caminhos determinísticos passaram pelas verificações locais, mas duas reproduções adicionais revelaram problemas P1: equivalência que perde a distinção entre “com” e “sem” e divergência dos agregados do diário por concorrência com o escritor manual existente. Nenhuma correção foi aplicada.

Foram executados testes locais com provider simulado, Firestore Emulator e alimentos públicos. **Nenhuma chamada real de IA foi executada.** Não houve leitura/escrita de Firestore remoto, deploy, alteração de flag remota, migração, commit ou push. A homologação paga permanece bloqueada pelos P1, pela ausência de autorização financeira e pela indisponibilidade de uma chave OpenAI no processo.

A implementação consegue vincular e validar composições previamente fornecidas; ainda não há evidência de que o provider real consiga produzir dietas completas com boa taxa de sucesso, diversidade e praticidade dentro dos limites atuais.

## 2. Veredito da auditoria

| Dimensão | Veredito e limite da evidência |
| --- | --- |
| Fluxo backend e persistência | Verificado com provider simulado e emulador |
| Recálculo e tolerâncias | Verificados; nutrientes finais vêm do documento escolhido |
| Equivalência | Reprovada em um invariante relevante: com/sem |
| Segurança de alergias específicas | Falha fechada nos arquivos locais sem evidência; não comprova disponibilidade remota |
| Diário | Consumo serial/idempotente funciona; integração concorrente com edição manual reprovada |
| Alternativas/favoritos/restauração | Jornada simulada passou; UI e provider real pendentes |
| Isolamento de geração | Flag local ausente/OFF; jobs fixam o modo na criação |
| Pronto para produção | Não |
| Pronto para teste pago | Somente após correções P1 autorizadas, nova regressão, credencial autorizada e aprovação do orçamento |

Os números da entrega anterior foram tratados como histórico, não como comprovação. Os testes abaixo foram reexecutados nesta auditoria.

## 3. Ambiente utilizado

- macOS, Node `22.23.2`, Java 21, Firebase CLI e Firestore Emulator existentes.
- Inspeção inicial: `git branch --show-current`, `git rev-parse HEAD`, `git status --short`; leitura integral de `catalog-linked-generation.md` antes dos testes.
- Todas as alterações locais existentes no início foram preservadas, incluindo a implementação ainda não commitada, as mudanças preexistentes em Rules, ranking, MealDetailsScreen e os documentos/testes não rastreados.
- Snapshot de hashes e status inicial: `/tmp/ajfit-homologation-20261018/baseline.json` e `status-before.txt`.
- Único arquivo de projeto criado por esta auditoria: este relatório. Scripts, fixtures derivadas e logs adicionais estão fora do repositório.
- `.firebaserc` contém somente `production: ajfit-2f321`; o cliente `.env` também aponta para esse projeto. Nenhum desses destinos foi usado para operações de dados.
- Flag `NUTRITION_CATALOG_LINKING_ENABLED` ausente no processo inicial. Não foi consultada a configuração de processos remotos.
- `OPENAI_API_KEY` e `GOOGLE_APPLICATION_CREDENTIALS` ausentes no processo. Existem arquivos locais de ADC e sessão Firebase; seus conteúdos e tokens não foram lidos nem usados para acessar dados remotos. Sua validade/permissões não foram testadas.

## 4. Confirmação do isolamento

Executados exclusivamente:

| Uso | Projeto | Banco | Endereço |
| --- | --- | --- | --- |
| Suíte nutricional e Rules | `demo-ajfit-catalog-homologation` | `(default)` emulado | `127.0.0.1:8185` |
| Reprodução adversarial do diário | `demo-ajfit-audit-probes` | `(default)` emulado | `127.0.0.1:8185` |

O CLI registrou a identificação de projeto `demo`, para o qual serviços não emulados não ficam disponíveis. Os testes chamam handlers localmente; não há Functions publicadas. No probe adicional, o script exige host local exato, `GCLOUD_PROJECT=demo-ajfit-audit-probes` e igualdade com `db.projectId` antes de qualquer escrita.

UID adicional: `homologation-concurrency-synthetic`. A suíte existente cria UIDs aleatórios `catalog-it-*`. Não há conta real, autenticação real de usuário ou dados pessoais. O cliente autenticado do teste de concorrência é o contexto sintético do Rules Unit Testing.

Escritas autorizadas somente no emulador: documentos públicos em `nutritionFoods`/`foodLogCatalog`; configurações sintéticas de rollout; usuários sintéticos e suas subcoleções de perfil/questionário/treino/jobs/planos/alternativas/favoritos/diário/recibos; `nutritionRateLimits` e `nutritionAiOperations` sintéticos. Os testes fazem limpeza dos próprios usuários/alimentos/operações; o probe removeu usuário e alimento em `finally`. O emulador foi encerrado, sem exportação/importação para projeto remoto.

Configuração reproduzível: `/tmp/ajfit-catalog-emulator.json`; logs do CLI foram gerados em `/tmp`, sem sobrescrever `firestore-debug.log` do projeto.

**Preparação para a fase real:** amostra pública de 560 documentos em `/tmp/ajfit-homologation-20261018/public-sample.json`: 519 TACO do artefato preparado e 41 OFF derivados pelo mapper/normalizador existentes, incluindo dez produtos com fibra desconhecida. SHA-256 `728dd52c1954e1004e561124641e18cb8cf34fa6cb68dadfb694da49ad8b981a`. Nomes, nutrientes, status e IDs determinísticos não foram inventados. A versão OFF `homologation-local-v1` identifica a derivação local; não é uma afirmação sobre a versão remota. A amostra contém preparos diferentes, bloqueados e grupos públicos diversos; não foi importada em produção. O dataset completo normalizado para análises em memória também está no diretório temporário.

UIDs futuros reservados: `homologation-catalog-synthetic-01` a `08`, no projeto `demo-ajfit-catalog-homologation`, banco emulado. Limpeza futura: remoção dos UIDs/limites/operações do ensaio e descarte do emulador. Nenhuma credencial Firebase real é necessária. Provider real pode ser instanciado localmente e injetado no worker; deploy é desnecessário. Uma chave OpenAI autorizada precisará estar disponível somente no processo, sem exposição em argumentos/logs/relatório; não foi procurada no Secret Manager.

## 5. Arquitetura efetivamente verificada

Caminho principal:

`generation/request.ts → worker.ts → attempts.ts → ai/provider.ts → catalogLinking/pipeline.ts → resolver.ts → search.ts → pipeline/validação do domain.ts → transação no worker`.

- `request.ts` fixa `generationMode: catalog` somente quando a flag é exatamente `true`.
- `provider.ts` mantém schema de intenções sem IDs, Responses API, `store:false`, teto de 8.000 tokens de saída e timeout limitado a 90s. Instruções de catálogo são acrescentadas apenas no modo vinculado.
- `resolveIntent` consulta documentos reais e constrói IDs/vínculos a partir da fonte, nunca a partir de um ID fornecido pelo modelo.
- `pipeline.ts/rawItem` substitui os valores estimados pelos calculados do catálogo. `validateAndBuildPlan(..., [], false)` mantém o engine como autoridade e desliga a correção livre de nutrientes; as restrições passam pelo resolvedor independente.
- `assertCatalogBindingsCurrent` relê os vínculos dentro da transação de ativação. O worker também compara `nutritionProfile.updatedAt`, estado do job e geração ativa. Só então arquiva o plano anterior e cria o novo.
- `mealAlternativeRequest.ts` usa a mesma pipeline; para schema 3, lê metas do snapshot do plano e restrições atuais.
- `logMeal.ts` recebe somente origem/documento/opção/slot/data/timezone/requestId, resolve a opção do próprio UID e relê o catálogo. Não pesquisa por nome no consumo.
- `favoriteMeal.ts` copia somente uma opção original persistida pelo backend. `restore.ts` preserva snapshots históricos.

Contratos diferentes foram preservados: `nutritionFoods` usa `nf_`, `generationStatus`, alergênicos/flags/preparo revisados quando disponíveis; `foodLogCatalog` usa `flc_`, `status`, provenance/brand/servings e um catálogo mais amplo. `nutritionFailure` admite TACO aprovado/pendente e FLC TACO/OFF ativo, rejeita bloqueados/ocultos/depreciados segundo a coleção e valida o ID determinístico da fonte.

**Fibra entre cópias TACO:** o vínculo guarda coleção, ID, sourceId, composição por 100g e revisão canônica. Não troca `nf_` por `flc_` no diário. O teste de divergência passou. Isso preserva a composição escolhida; não resolve nem declara corretas as divergências do catálogo. Documento alterado/oculto/removido é bloqueado no consumo, sem reescrever o histórico.

## 6. Achados por severidade

### P1-01 — Equivalência perde a polaridade de composição

Evidência: `functions/src/nutrition/catalogLinking/resolver.ts:16`, `tokens:20`, `MODIFIERS:28`, `equivalenceScore:34`.

`com` e `sem` são removidos dos tokens; o conjunto de qualificadores protege lactose/glúten/pele/gordura, mas não açúcar, sal, sementes e outras composições. Assim, conjuntos de tokens iguais podem ter significados opostos.

Reprodução com documento público real local `nf_taco_22_e9f7b0c2636fa6c6`:

```json
{
  "intencao": "Cereais, milho, flocos, com sal",
  "documento": "Cereais, milho, flocos, sem sal",
  "equivalenceScore": 90,
  "resolveIntent": "aceitou e retornou o vínculo"
}
```

O teste usa somente esse candidato para verificar o invariante de equivalência quando não há uma correspondência correta disponível. Não afirma que toda busca no catálogo completo escolheria esse registro. O probe de mutação textual encontrou 17 registros locais que aceitam trocar “sem” por “com” na pontuação; para OFF, parte desses probes não incluía a marca e não representa uma resolução completa. A resolução completa acima é TACO e foi efetivamente executada.

Impacto: publicar nutrientes reais do alimento errado continua sendo erro, mesmo que os macros fechem. O preparo e a composição precisam ser equivalentes antes de otimizar gramas. Testes afetados interrompidos após a reprodução; nenhum plano desse probe foi ativado.

Correção proposta, não aplicada: preservar pares explícitos de presença/ausência numa representação comparável; recusar contradições antes dos aliases/tokens, inclusive açúcar/sal/ingredientes e variações linguísticas. Exigir compatibilidade de preparo textual e metadado quando ambos existirem. Adicionar testes negativos simétricos com/sem para TACO/OFF, não apenas uma lista de qualificadores especiais. Não relaxar matching.

### P1-02 — Escritor manual e consumo vinculado podem divergir dos agregados

Evidência: `src/services/nutritionDiary.ts:229` enumera itens antes da transação; `:242` subtrai totais atuais da refeição e acrescenta totais calculados sobre a lista antiga. `logMeal.ts` adiciona itens e totais atomicamente, mas o escritor manual não inclui os novos itens na própria lista congelada. As Rules de diário validam formato/faixas, não a igualdade entre agregados e soma dos documentos.

Reprodução no emulador, com arroz público de 124 kcal/100g:

1. Cliente manual lê lista vazia e prepara um item de 100g.
2. `logCatalogMealHandler` registra 100g e retorna sucesso.
3. Cliente executa a mesma matemática/transação de `replaceMealItemsOnMeal` com a lista já capturada. Essa escrita foi feita com SDK cliente autenticado e aceita pelas Rules reais carregadas no emulador.
4. Restam dois documentos de item, cada um com 124 kcal. Agregados da refeição/dia: 124 kcal; contagem: 2.

```json
{"items":2,"actualItemsKcal":248,"storedDayKcal":124,"storedCount":2,"clientRulesAccepted":true}
```

Evidências: `/tmp/ajfit-homologation-20261018/concurrency.ts`, `concurrency.json` e `concurrency.log`. O probe reproduz o protocolo do escritor manual; não importa a tela React Native. A reprodução não depende de cliente malicioso.

A vulnerabilidade de lista obsoleta já existe entre escritores manuais; a integração nova não a resolve e acrescenta um escritor backend com o qual também ocorre. Por isso não é possível homologar a integração como consistente sob concorrência. O cenário foi encerrado e limpo após a comprovação.

Correção proposta, não aplicada: introduzir controle de versão do conjunto de itens/refeição, lido **antes** da enumeração e novamente na transação, abortando/recarregando o conjunto quando mudar; assegurar que todos os escritores, inclusive mover/remover/editar e o novo backend, alterem o mesmo token. Alternativamente, centralizar operações de diário no backend com consulta transacional. A primeira opção pode reduzir o escopo; precisa ser testada contra todas as mutações. Apenas repetir a transação atual ou reler day/meal não corrige a lista congelada.

### P2-01 — Tratamento assimétrico de marca e exceção não estruturada

Evidência: `resolver.ts:45`. A marca é retirada somente da intenção, não do nome do candidato. Produtos cujo nome contém a marca podem ser recusados até quando a intenção é o próprio nome completo. Se nome e marca coincidem, a string restante fica vazia e `normalizeFoodName` lança `INVALID_FOOD_NAME`.

Exemplos públicos da derivação OFF: `MIZOS`/marca `MIZOS`, `Owyn`/marca `Owyn`, `NUTRI PROTEIN`/marca `NUTRI PROTEIN`. A busca deve rejeitar dados insuficientes com motivo estruturado, sem derrubar a operação com exceção genérica. Produtos completos devem comparar nome comercial e marca simetricamente, sem remover substrings de ingredientes. Não foi feita correção.

### P2-02 — Busca pode consumir grande parte do orçamento em uma intenção

Evidência: `search.ts:59` e `resolver.ts:151`. O cursor é coerente e todas as páginas processadas são mantidas; entretanto, os termos complementares são exauridos mesmo após um bom candidato por tokens, para verificar ambiguidade. No conjunto local completo utilizado pelo probe:

- `Queijo muçarela`: encontrado, 1.131 leituras estimadas e 41 consultas.
- `Pasta de Amendoim Integral Mandubim`: falhou por orçamento, 1.600 leituras/46 consultas; não é prova de que existe uma correspondência correta para essa intenção.

Isso pode deixar pouco orçamento para as refeições restantes. A busca não elimina permanentemente registros por corte de ranking/cursor, mas não garante recuperação de todo candidato dentro de cada orçamento. Proposta: planejar consultas mais seletivas e aliases canônicos, com reserva por item e métricas de esgotamento; nunca aceitar o primeiro candidato sem validar ambiguidade.

### P2-03 — Métricas não permitem calcular todas as taxas solicitadas com precisão

`requested`, `matched` e `rejected` são acumulados entre tentativas; `rejected` conta candidatos, não alimentos solicitados. `corrections` conta refeições/opções alteradas, não itens ajustados. `recordAiOperation` é chamado antes da releitura transacional final, então o snapshot de leituras não inclui essa fase. Leituras de páginas são contabilizadas depois de resposta bem-sucedida; timeout não cancela necessariamente a RPC nem demonstra ausência de cobrança.

O orçamento é explícito e foi respeitado pelos contadores nas execuções; não constitui teto exato de cobrança. Para o ensaio real, um wrapper local precisa guardar intenções/resultado somente de perfis sintéticos, separar tentativas e contar diferenças de gramas/substituições por item. Não somar snapshots cumulativos como se fossem deltas.

### P2-04 — Semântica de exclusão de ingrediente/grupo ainda precisa ser explícita

`restrictionFailure` confere exclusões por ID e tokens do nome. Selecionar um alimento chamado “Leite” em `excludedFoodIds` não equivale a excluir todo derivado: iogurte/queijo revisados com `allergens:['milk']` passam pela exclusão textual “Leite”, quando `excludedAllergens` está vazio. Isso foi observado com arquivos públicos. A alergia explícita `milk` não foi contornada: sem evidência, falha.

Não confundir esses contratos na UI ou nos cenários H/F. Definir se o picker exclui um alimento específico, um ingrediente ou uma família. Só o último caso autoriza expandir deterministicamente para derivados. Para alergia, manter exigência específica de evidência.

### P3-01 — Documentação e comentários residuais

`domain.ts` ainda descreve a montagem como “never recomputed from a catalog”, embora agora também receba valores canônicos da pipeline. A suíte de capacidade chama o caso F de exclusão de leite, sem testar lactose específica. Nenhum desses pontos deve ser usado como comprovação de homologação real de lactose.

Nenhum P0 foi observado no escopo executado. Isso não é certificação de ausência de vulnerabilidades fora do escopo.

## 7. Testes executados nesta auditoria

| Verificação | Resultado | Evidência local |
| --- | --- | --- |
| Resolvedor e capacidade | 49 passaram, 2 arquivos | `unit.log` |
| Functions/nutrição + inventário de exclusão, emulador | 228 passaram; 1 smoke real ignorado; 21 arquivos passaram | `emulator.log` |
| Rules completas | 572 passaram, 25 arquivos | `rules.log` |
| App/domínio nutricional + tipos e serviços selecionados | 498 passaram, 50 arquivos | `app.log` |
| TypeScript app e Functions | Ambos concluíram sem erros | `types-app.log`, `types-functions.log` |
| Espelho nutricional | `0 synchronized`, estado coerente | comando `syncNutritionToFunctions.cjs --check` |
| Probe negativo com/sem | Falha de invariante confirmada | `probes.ts`, `probes.json` |
| Concorrência diário sob Rules | Falha de invariante confirmada | `concurrency.ts`, `concurrency.json` |
| Inventário/análise pública em memória | Concluída, sem Firebase remoto | `audit.ts`, `local-inventory.json` |

Arquivos de evidência estão em `/tmp/ajfit-homologation-20261018/`; são temporários, não artefatos versionados. Contagens das suítes se sobrepõem e **não devem ser somadas como cobertura distinta**. A suíte de 1.415 casos relatada anteriormente não foi repetida integralmente; esta auditoria executou o recorte acima e testes adversariais adicionais.

Comandos principais, no diretório do projeto:

```sh
node scripts/syncNutritionToFunctions.cjs --check
./node_modules/.bin/tsc --noEmit
(cd functions && ./node_modules/.bin/tsc --noEmit)
node ./node_modules/vitest/vitest.mjs run src/nutrition/__tests__/catalogLinking.test.ts src/nutrition/__tests__/catalogCapacity.test.ts --root functions
# Os comandos seguintes foram executados dentro de emulators:exec com --project demo-ajfit-catalog-homologation:
(cd functions && ./node_modules/.bin/vitest run src/nutrition src/accountDeletion/firestoreCleanup/__tests__/resources.test.ts)
./node_modules/.bin/vitest run --config vitest.firestore.config.mts
```

As reproduções adversariais foram executadas separadamente e não foram inseridas na suíte do projeto, pois correções/testes de código dependem de autorização.

## 8. Testes não executados

- OpenAI real: proibido antes de autorização, chave ausente e P1 identificados.
- Tráfego Callable real com tokens de Auth/App Check: testes chamam handlers; enforcement foi conferido na configuração `onCall`, não homologado por transporte real.
- Homologação visual: há runtime iOS instalado, mas `simctl list devices booted` não retornou dispositivo iniciado. Mais importante: `.env` aponta para produção e `firebaseFunctions.ts` não conecta a emulador. Não foi iniciado app que pudesse atingir contas/dados reais. Configuração isolada do cliente precisa ser preparada/aprovada antes dessa etapa.
- Custo/latência de produção, contagens atuais do Firestore e validade das credenciais: não consultados.
- Regressão exaustiva de toda a aplicação e todos os interleavings concorrentes: não comprovados.

## 9. Provider real: preparação e orçamento para aprovação

Provider conferido: `OpenAiNutritionProvider`, endpoint `/v1/responses`; primário de plano/alternativa `gpt-6-luna`; fallback `gpt-6.1-sol`, somente na última tentativa para falhas de schema/macros. Máximo de três chamadas por operação; não foi mudado o modelo.

Preços públicos Standard consultados em 18/10/2026: Luna US$0,10 entrada/US$0,50 saída por milhão; Sol 6.1 US$2 entrada/US$10 saída por milhão. Fontes oficiais abertas: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) e [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Disponibilidade da chave/conta e cobrança efetiva permanecem não verificadas. Estimativa abaixo ignora desconto de cache e não usa a tabela interna como prova de preço atual.

**Proposta, ainda não autorizada:** oito cenários de plano e uma operação de alternativa no cenário convencional válido; máximo 27 chamadas no total, respeitando as três tentativas do aplicativo. Limite financeiro solicitado: **US$2,00**; sem deploy e sem escrita em produção.

Hipóteses conservadoras para o wrapper local futuro: máximo 30.000 tokens de entrada por chamada e 8.000 de saída, com recusa prévia de payload acima do limite; usar um limite conservador de bytes do payload ou tokenizer local validado, sem chamada paga para contar tokens. Reservar o pior custo da próxima chamada antes de enviá-la e interromper quando o orçamento restante não cobrir a reserva. Uma resposta sem usage não libera sua reserva; não reiniciar chamadas após timeout para “recuperar” dados. Não alterar o provider de produção para isso.

| Cenário de custo | Projeção, não medição |
| --- | --- |
| Uma chamada Luna, 5–10 mil entrada e 3–6 mil saída | US$0,002–0,004 |
| Duas Luna no teto + uma Sol no teto, uma operação | US$0,154 |
| Nove operações, até 18 Luna + 9 Sol no teto | US$1,386 |
| Limite solicitado, com margem e parada por reserva | US$2,00 |
| Teto agregado sob essas hipóteses | 810 mil entrada + 216 mil saída |

As 27 chamadas são teto, não objetivo de consumo. Perfis sem prova crítica devem ser registrados como falha explicável, sem novas chamadas além da política existente e sem inventar evidências. Estimativa não inclui impostos/conversão cambial. Firestore Emulator não gera cobrança remota.

**Gates antes da primeira chamada:** autorização das correções P1, correções e regressão aprovadas, credencial disponibilizada por mecanismo autorizado, confirmação do guard de isolamento/budget e autorização explícita do orçamento. Este relatório não representa nenhuma dessas autorizações. O wrapper pago ainda não foi implementado/executado.

## 10. Taxa de correspondência e cobertura observada

Origem: análise local dos 519 documentos de `taco-4a-edicao-2011-prepared.json` e 34.109 linhas de `off-brazil-csv.jsonl`, passando pelos métodos puros `processOffBatch` e `normalizeFoodLogRecord`. Resultado OFF: 23.043 documentos normalizados, 11.066 rejeições na entrada e nenhuma rejeição adicional de normalização. Isso não reproduz necessariamente todas as importações/versões do Firestore e não deve substituir a contagem histórica de 23.087 OFF.

Critério “nutricional”: `nutritionFailure(candidate) === null`, incluindo status, ID, fibra, qualidade, preparo e massa. “Autocomparação”: pontuação não negativa ao comparar o nome real, com marca quando aplicável, ao próprio documento; não envolve busca, ambiguidade nem garante geração completa.

| Fonte/arquivo | Total local | Passam filtros nutricionais | Autocomparação aceita |
| --- | ---: | ---: | ---: |
| TACO NF preparado | 519 | 366 (70,52%) | 346 (66,67% do total) |
| OFF derivado localmente | 23.043 | 11.463 (49,75%) | 9.230 (40,06% do total) |

TACO rejeitados pelo primeiro motivo: 69 preparo, 83 nutrição, 1 identidade/status. OFF: 10.818 nutrição, 713 quantidade/base volumétrica, 49 preparo. Motivos são o primeiro retorno da função, não causas exaustivas. O inventário confirmou localmente 173 aprovados, 345 pendentes e 1 bloqueado; os 428 tecnicamente prontos de outra auditoria usavam critérios diferentes e não são a elegibilidade desta implementação.

Busca em memória com os prefixos reais, paginação/limites reais e conjunto TACO NF + OFF acima, onze intenções ilustrativas:

| Intenção | Resultado | Leituras estimadas |
| --- | --- | ---: |
| Arroz branco cozido | Encontrado, OFF sem marca no registro | 4 |
| Arroz integral cozido, nome canônico | Encontrado, NF | 3 |
| Feijão carioca cozido | Encontrado, NF | 4 |
| Frango peito sem pele grelhado | Encontrado, NF | 3 |
| Ovo de galinha cozido | Não vinculado | 460 |
| Banana prata crua | Encontrado, NF | 3 |
| Queijo muçarela | Encontrado, NF | 1.131 |
| Pão francês | Não vinculado | 1.075 |
| Azeite de oliva extra virgem | Não vinculado | 502 |
| Pasta de Amendoim Integral Mandubim | Orçamento esgotado | 1.600 |
| Iogurte proteico YoPRO | Não vinculado | 651 |

Resultado bruto: 6/11 (54,55%). **Não é taxa de correspondência da IA** nem benchmark representativo; são intenções manuais ilustrativas, sem as cópias FLC TACO, sem latência de rede e sem estado remoto. O motivo final de falha é atualizado por candidatos rejeitados; por exemplo, `CATALOG_NUTRITION` não demonstra que o alimento desejado existe e tem erro nutricional. Ovo canônico contém “inteiro” e “10minutos”, detalhes ausentes na intenção do probe.

## 11. Taxa de sucesso das dietas

Provider real: **não medida; sem denominador**. Não reportar 0% ou 100%.

As seis composições positivas da fixture pública/sintética anterior continuam passando (A/B/C/D/F/H), enquanto G falha fechada por glúten e E é um teste negativo de uma composição vegana insuficiente. Esses resultados não são oito planos gerados pela IA. O teste E usa duas refeições e não implementa o cenário real vegano de cinco refeições; F usa exclusão textual de leite, não `excludedSubstances:['lactose']`.

| Cenário | Evidência local atual | Ensaio OpenAI futuro |
| --- | --- | --- |
| Convencional, 2.200 kcal/4 refeições | Composição previamente construída passou | Pendente |
| Hipertrofia, 3.000 kcal/5 | Composição previamente construída passou | Pendente |
| Emagrecimento, 1.600 kcal/4 | Composição previamente construída passou | Pendente |
| Vegetariano, 2.200 kcal/4 | Composição previamente construída passou | Pendente |
| Vegano, 2.400 kcal/5 | Apenas composição negativa diferente testada; capacidade global não demonstrada | Pendente |
| Sem lactose, 2.000 kcal/4 | Falha fechada sem evidência; não confundir com caso F legado | Pendente; falha é resultado aceitável |
| Sem glúten, 2.200 kcal/4 | Falha fechada na fixture | Pendente; falha é resultado aceitável |
| Múltiplas restrições, 2.000 kcal/4 | H positivo usa exclusões textuais; não prova exclusão de todos os derivados | Pendente após contrato explícito |

No ensaio futuro, metas serão calculadas por `loadGenerationContext`/Nutrition Engine a partir de perfis sintéticos coerentes; os valores calóricos acima são cenários de avaliação. Não sobrescrever output do engine para fabricar um sucesso.

## 12. Qualidade das refeições

Não houve avaliação de refeições produzidas por IA real ou de aceitação em dispositivo. As fixtures de capacidade contêm três alimentos por refeição e demonstram aritmética/validação, não experiência alimentar, micronutrientes ou diversidade de vários dias.

O backend limita seis itens, 1.200g por refeição, 600g por alimento, 60g por item classificado como `fat_source` e repetição por identidade. Esses limites não demonstram que toda porção será prática: dependem também da classificação correta do catálogo e da proposta inicial. A otimização de coordenadas pode falhar para um plano matematicamente viável; isso é uma limitação de cobertura, não permissão para editar nutrientes.

Falhas observadas separam-se em equivalência (P1-01), catálogo/intenção muito específica, ausência de fibra, marca, orçamento (P2-02) e falta de evidência de restrições. Não atribuir todas ao Nutrition Engine ou ao prompt.

## 13. Validação nutricional

Verificado em `catalog/math.ts`, `catalogLinking/pipeline.ts`, `generation/domain.ts`, `diagnostics.ts` e `engine/constants.ts`:

- `valorPor100g × gramas / 100`; duas casas por item; somas por opção/refeição/dia.
- Fibra deve ser numérica; ausente/null causa recusa, não zero.
- Nenhuma conversão cru/cozido inventada; alimentos OFF volumétricos/bebidas são recusados pela política atual.
- Ajuste local de até 40 passagens, dentro de 0,5–2 vezes a massa inicial e tetos de praticidade.
- Tolerâncias: calorias ±5%; proteínas/carboidratos/gorduras ±10%; fibras ±20%; margem numérica de 0,01.
- Macrodiagnóstico diário pode rejeitar um plano mesmo quando refeições individuais passaram. Não há publicação silenciosa nesse caso.
- Estimativas da IA deliberadamente incorretas nos testes foram substituídas pelo catálogo; falhas de otimização/macros são detectadas.

A matemática determinística não valida a qualidade material do rótulo/fonte. O gate energético usa a auditoria existente com tolerâncias amplas de Atwater; aprovação técnica não equivale à conferência individual do alimento.

## 14. Restrições alimentares

`verifiedEvidence` exige schema 1, revisão canônica atual, referência não vazia e listas estruturadas. `safetyEvidence` é dado administrativo global; a IA e o cliente das callables não o fornecem. String de referência e igualdade de revisão são mecanismos de integridade, não avaliação clínica da fonte. A semântica/governança de ausência crítica ainda precisa ser documentada antes de preencher esses metadados.

Nos arquivos analisados, todos os candidatos têm ausência dessa evidência. Entre os que passam os filtros nutricionais:

| Perfil/política | TACO NF | OFF |
| --- | ---: | ---: |
| Convencional, sem exclusões | 366 | 11.463 |
| Vegetariano | 87 | 0 |
| Vegano | 71 | 0 |
| Pescetariano | 103 | 0 |
| Alergia explícita a leite/ovo/soja/trigo, cada uma | 0 | 0 |
| Ausência crítica lactose ou glúten, cada uma | 0 | 0 |

São filtros contextuais, antes da equivalência/busca; não quantidades disponíveis hoje no Firestore. OFF não recebe flags/ingredientes estruturados pelo mapper atual. Os dados brutos OFF não autorizam automaticamente ausência de alergênicos/traços.

As falhas fechadas para alergia, doença celíaca/glúten e lactose estrita são coerentes com a política implementada na ausência de evidência específica. Flags vegetarianas e conhecimento de um ingrediente simples podem ampliar padrões alimentares, mas não provam contaminação cruzada ou quantidade de lactose. Revisão determinística de evidências existentes é possível para presença/contradições, identidade e padrões alimentares revisados; não foi demonstrada evidência existente suficiente para liberar essas ausências críticas nos arquivos locais.

Não foi encontrado bypass de alergia explícita nos testes executados. O P1 de polaridade precisa ser corrigido mesmo assim. Exclusão de trigo como alimento específico não é sinônimo de glúten/celiaquia; leite como alimento específico não é sinônimo de lactose nem de alergia à proteína. A UI atual não captura o novo campo `excludedSubstances`; disponibilidade contratual não significa uma jornada de usuário completa para esses casos.

## 15. Integração com o diário

Passaram na jornada existente: IDs reais, quantidade, composição da mesma referência, snapshot, agregados no uso serial, replay com mesmo request, rejeição de payload com nutrientes extras, UID diferente e mudança de revisão sem alterar histórico.

Segurança conferida por código: auth obrigatório, App Check na callable, guarda de conta ativa e lock relido na transação; caminhos de usuário derivados de `request.auth.uid`. O cliente não define coleção/foodId/gramas na nova callable. Recibos são backend-only e integram a exclusão de conta.

**Limite:** P1-02 reprova concorrência com o diário manual. Também não há nesta auditoria uma prova de bloqueio geral de valores arbitrários nos escritores manuais antigos; suas Rules validam formato, não recalculam composição. A autoridade da nova callable não deve ser generalizada ao diário inteiro.

## 16. Alternativas e favoritos

A suíte simulada executou alternativa vinculada, favorito criado pelo backend, consumo de favorito e rejeição de bookmark adulterado. Alternativas e plano passam pelo mesmo resolvedor/revalidação.

`logMeal.ts` confronta o conteúdo vinculado do favorito com uma opção do plano/alternativa original; o bookmark não se torna autoridade independente. Desativação da flag recusa nova alternativa vinculada em vez de gerar silenciosamente uma livre. Consumo de vínculos persistidos continua sujeito às verificações de revisão/restrições atuais.

Não foram medidos custo, diversidade ou latência de alternativa real. Favoritos/alternativas ainda herdam o P1 de equivalência durante geração e o risco concorrente no consumo. App Check via rede e UI pendentes.

## 17. Compatibilidade com planos antigos e funcionalidades

- Sem binding: fluxo legado de registro manual. Não há matcher retroativo nem regravação de histórico.
- Binding parcial: interface recusa sucesso de registro direto.
- Restauração: transação mantém refeições/snapshots e altera estado ativo/arquivado; uma revisão desatualizada continua bloqueada no consumo.
- Premium, onboarding automático, cooldown, geração inicial/manual e idempotência passaram nos testes de handlers existentes. Auth/App Check foram inspecionados, não testados por transporte real.
- Exclusão de conta: `nutritionCatalogLogReceipts` está em `firestoreCleanup/resources.ts`; testes do inventário passaram. Não foi feita exclusão de conta real.
- A flag OFF mantém jobs legados sem pipeline vinculada; jobs já marcados como catálogo não são convertidos para geração livre ao desligar a flag. O novo campo opcional de ausência crítica, se presente num perfil legado, falha antes da IA: isso é comportamento novo de segurança, não preservação literal para esses novos dados.

Não há evidência suficiente para afirmar “todas as funcionalidades anteriores preservadas” em todos os dispositivos/cenários concorrentes. Há integração ampla e regressão local positiva, com os bloqueios explicitados.

## 18. Custos e latência

Medições locais desta execução:

| Execução | Tempo da suíte |
| --- | ---: |
| 49 unitários/capacidade | 0,392s |
| 228 Functions com emulador | 18,82s |
| 572 Rules | 48,41s |
| 498 app/domínio | 1,33s |

Esses valores incluem orquestração de testes e **não** são latência por dieta real. A busca em memória não mede RPC Firestore. Custo de IA efetivamente consumido nesta auditoria: zero.

Por código: máximo 1.600 leituras estimadas/100 consultas-lookups por sessão; deadline do plano 430s dentro do worker de 540s; alternativa 110s dentro de callable 120s. Uma chamada pode levar até 90s. Não é possível estimar probabilidade de timeout sem ensaio real. Múltiplas buscas amplas podem esgotar orçamento antes do limite de tempo; os probes reproduziram esgotamento.

Com 20 mil registros, tokens não crescem linearmente com o catálogo, pois só entram intenções, contexto e reparos com poucos nomes. Leituras dependem da seletividade dos prefixos, duplicação de consultas e número de reparos. Os limites são úteis, mas cobertura/latência precisam de benchmark com o catálogo representativo e provider real após correções.

## 19. Riscos restantes

1. Dois P1 impedem ativação.
2. Catálogo remoto atual não auditado nesta execução; contagens são exclusivamente locais.
3. Cobertura OFF real de padrões restritivos permanece baixa/zero nos dados locais, apesar do grande número de registros nutricionais.
4. Names/aliases e marca podem causar recusas desnecessárias ou exceções genéricas.
5. Metadados de segurança não têm governança de evidência material homologada.
6. App está configurado para produção; falta preparar uma configuração de dispositivo isolada antes de iniciar testes visuais.
7. As métricas atuais não cobrem todas as taxas por item e a fase final de persistência.
8. Sem resultados reais de IA, não há taxa de sucesso, custo ou tempo por dieta, nem validação de praticidade/variedade.

## 20. Correções recomendadas e ordem

Nenhuma aplicada. Solicitar autorização separada para alterações de código:

1. Corrigir P1-01 com representação de polaridade/ingredientes e regressões negativas.
2. Corrigir P1-02 com protocolo consistente de concorrência para todos os escritores do diário; testar os dois sentidos do interleaving, duas chamadas vinculadas concorrentes, edição, remoção e movimento.
3. Corrigir P2-01 sem ampliar equivalência indevidamente; converter candidato insuficiente em rejeição estruturada.
4. Benchmark e refinamento seletivo de busca/orçamento; instrumentação de correções por item e leitura final.
5. Definir e testar os contratos de exclusão específica, família/ingrediente e ausência crítica; não aprovar o catálogo em massa.
6. Preparar cliente/simulador isolado e wrapper local de orçamento. Manter flag OFF até concluir os gates.

Não é necessário fazer deploy, migração destrutiva ou escrever em produção para corrigir/verificar esses problemas localmente.

## 21. Critérios pendentes para produção e respostas objetivas

Antes de qualquer ativação: P1 corrigidos e testes adversariais aprovados; regressão ampla; ensaio real autorizado dentro do orçamento; cenários restritivos com resultados explícitos de sucesso/falha; inspeção de refeições/porções; validação visual em ambiente isolado; mensuração de custo/latência/cobertura; decisão de escopo e evidência para restrições críticas. Publicar Functions/Rules/app exige autorização própria posterior, mesmo depois da homologação.

| Pergunta | Resposta |
| --- | --- |
| 1. O sistema realmente funciona? | O caminho determinístico funciona em casos simulados; há dois P1 e não está homologado como produto. |
| 2. Aproveita parte relevante da TACO/OFF? | Há potencial técnico local: 366 NF e 11.463 OFF passam filtros; busca/equivalência e restrições reduzem isso. Cobertura remota não medida. |
| 3. A IA gera dietas completas com os alimentos disponíveis? | Não demonstrado com provider real. Fixtures pré-compostas não respondem essa pergunta. |
| 4. Cumprem metas após recálculo? | Os planos aceitos nos testes cumprem as tolerâncias determinísticas. Há casos corretamente rejeitados. P1-01 ainda pode aceitar identidade errada. |
| 5. Restrições são respeitadas? | Ausência crítica falha fechada nos testes; exclusões/famílias têm limites. Não afirmar segurança universal. |
| 6. Registro direto funciona? | Sim, serialmente e com replay; não homologado sob concorrência manual devido ao P1-02. |
| 7. Preserva todas as funções anteriores? | Integrações principais e regressão selecionada passaram; garantia universal é inadequada diante dos bloqueios e UI pendente. |
| 8. Quanto custa/demora uma geração real? | Ainda não medido. Orçamento proposto de US$2/até 27 chamadas para oito cenários e uma alternativa. |
| 9. O que corrigir antes de ativar? | Obrigatoriamente polaridade de equivalência e concorrência do diário; tratar marcas, cobertura, métricas e semântica das restrições antes da homologação ampla. |
| 10. Pronto para dispositivo/produção? | Produção: não. Dispositivo: preparar isolamento e corrigir P1 antes de validar jornadas completas. |

Execução encerrada antes de qualquer chamada paga ou publicação. Aguardam autorização as correções propostas e, separadamente, o orçamento de homologação futura. Não confundir aprovação deste relatório com autorização para corrigir, chamar IA ou publicar.

### Registro final de integridade

Comparação SHA-256 com o snapshot do início: nenhum arquivo preexistente foi alterado pela auditoria. Somente este relatório foi acrescentado ao repositório. `git diff --check` concluiu sem erros.

Hashes dos insumos públicos usados, para reprodução dos números:

- `scripts/nutrition/sources/taco-4a-edicao-2011-prepared.json`: `e3282eeab992e3752cfc7e69a728bfc8d2c8cf069570e37ceeef94f911d8e227`.
- `scripts/nutrition/sources/off-brazil-csv.jsonl`: `bb13614115de34fdd306bf3468c7431150f64edfaa2f5309b23390fd37837fcb`.
