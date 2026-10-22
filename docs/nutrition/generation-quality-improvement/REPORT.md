# AJ Fit — qualidade da geração nutricional

22/10/2026. **Implementação técnica concluída e pronta para homologação autorizada. Melhora de aprovação com IA real ainda não comprovada. Nenhum deploy.**

## 1. Estado inicial e preservação

Branch `treinos`, HEAD `3d731c9200d3d1ba454c76a0ce0bc2bcbdc7169b`, staging vazio. `repository-before.txt` registra alterações anteriores; `source-before.json` contém seus hashes. Recuperação adaptativa local, otimizador, correções de segurança, testes e relatórios anteriores foram preservados. Nenhum reset, clean, commit ou push.

O código local começa com máximo absoluto de cinco chamadas e US$ 0,04, orçamento normal de quatro com crédito condicional. O último inventário remoto da tarefa anterior documenta produção com quatro chamadas e US$ 0,03. Nesta tarefa não houve consulta ou alteração de produção, nem publicação da política adaptativa.

Lidos os seis relatórios exigidos: recuperação adaptativa final, auditoria do orçamento, estabilidade final, otimizador de porções, confiabilidade de macros e correção final das duas IAs. Consultados também ledger bruto, resultados individuais, evidências de digest/persistência, logs e diagnósticos da última homologação. A documentação [Expo v56](https://docs.expo.dev/versions/v56.0.0/) exigida pelo AGENTS foi consultada antes de escrever código; nenhuma mudança Expo foi necessária.

A inspeção de processos encontrou o emulador anterior, sem homologador/Vitest antigo consumindo API. Nenhuma credencial OpenAI foi acessada nesta tarefa. O saldo histórico de US$ 0,75685 não foi utilizado.

## 2. Evidências e método

Fonte principal: `../adaptive-ai-recovery-final/release-homologation/ledger.json`, nove jobs sintéticos, **30 chamadas reais históricas** (22 criadoras, oito revisoras), três aprovações, seis falhas seguras. Os dados brutos incluem respostas, candidatos revisados, ledger transacional e digest. Não são chamadas novas desta tarefa.

`replay.cjs` reexecuta parsing, evidência e validação determinística sobre todos os candidatos, sem provedor/rede. Os oito envelopes de revisão têm exatamente o mesmo engine; essa igualdade é verificada antes de reutilizar as metas nos dois jobs sem revisão. Perfis/restrições são os do harness histórico. Nenhuma fonte opcional de produto forneceu evidência nesses casos.

Resultados reconstituídos por chamada, não somente pelo erro final:

| Resultado da etapa | Quantidade |
| --- | ---: |
| Criadora válida determinística | 8 |
| Criadora: evidência insuficiente | 8 |
| Criadora: macro inválido | 5 |
| Criadora: incompatibilidade de conteúdo | 1 |
| Revisora: aprovação | 3 |
| Revisora: informação insuficiente | 3 |
| Revisora: rejeição | 2 |

Os nove primeiros candidatos tiveram dois válidos determinísticos; somente um job foi aprovado após a primeira criação. Esses números descrevem a amostra histórica direcionada, com política adaptativa local. Não constituem baseline experimental de quatro chamadas nem estimativa populacional.

Artefatos: `offline-replay-before-product-fix.json`, `offline-replay.json` e `quality-only.patch`. O primeiro replay foi capturado antes da correção da frase negada; já contém os novos índices de diagnóstico. Os resultados originais estão sempre no ledger fonte, cujo SHA é registrado no replay.

## 3. Diagnóstico e causas confirmadas

### AI_MACRO_VALIDATION_FAILED

As cinco falhas reais foram reproduzidas com os mesmos códigos. Há conflito de composição, não um deslocamento universal das metas:

- Job 1, chamada 2: fibra insuficiente no lanche, otimizador inviável.
- Job 2, chamada 3: proteína/fibra insuficientes no café; excesso de kcal/carboidrato/gordura/fibra no lanche.
- Job 4, chamada 1: proteína e fibra altas, gordura baixa no lanche; chamada 4: café com kcal/proteína/gordura baixas e fibra alta após quantização.
- Job 8, chamada 1: café com kcal/proteína baixas; lanche com gordura/fibra baixas.

O backend estima totais a partir de `estimatedNutrition` para a porção exata. No fluxo freeform ele **não substitui todas as estimativas por valores do catálogo**. O otimizador escala quantidades e estimativas linearmente dentro de `[0.5, 2]`; não corrige uma composição falsa nem cria outro ingrediente.

A representação também limita a correção: no job 2, a criadora compactou refeições completas em um item com unidade `prato`/`porção` e valores praticamente copiados das metas. Isso impede conferir componentes e retira os graus de liberdade por alimento. O contrato antigo permitia essa representação sem explicar como tornar os componentes mensuráveis.

Correção: orientação explícita para componentes servidos separadamente terem medidas próprias, base cru/cozido identificada e inclusão única das gorduras; conferência de energia/macros e das cinco faixas simultâneas. Os limites já existentes do ajuste agora chegam à criadora. Quando a correção falha, a instrução relaciona os desvios estruturados a mudanças de composição, preservando refeições válidas. Nenhum solver, tolerância ou regra de meta foi alterado.

Isso corrige a orientação/representação; **não demonstra que o modelo deixará de escolher combinações inviáveis**. Esse efeito precisa da comparação real.

### AI_EVIDENCE_INSUFFICIENT

Falhas localizadas no replay:

- Job 1 e três tentativas do job 7: proteína isolada de ervilha, sem composição verificada. No job 7, o mesmo produto reaparece após o retry.
- Job 3: aveia sob exclusão de glúten, sem prova da formulação/contaminação cruzada.
- Job 9, três tentativas: o primeiro item bloqueado era feijão com nota **“sem caldo industrializado”**. A palavra `industrializado` acionava a heurística de produto apesar da negação. Trata-se de falso positivo confirmado, não ausência real de prova de um caldo declarado.

O feedback anterior preservava o candidato, o código e `unverified_product_composition`, mas não identificava qual item falhou. A instrução de suplemento já diferenciava seleção de segurança; faltava tornar a regra de evidência e sua aplicação por item acionáveis para toda a composição.

Correções:

1. `foodFailure` privado com índice zero-based na sequência achatada de alimentos e motivo enumerado, transmitido ao retry/checkpoint; não entra no audit/log nem decide elegibilidade.
2. Orientação para substituir um produto dependente de evidência por composição compatível verificável, sem inventar rótulos, propriedades ou certificados, nem esconder ingredientes ou apenas renomear o mesmo produto.
3. Exclusão **somente da expressão exata `sem caldo industrializado` na nota de preparo** da heurística de produto industrializado. Nomes, ingredientes, certificação, substâncias incompatíveis e aveia continuam sendo examinados. Não é um parser genérico de negação.

Importante: depois de corrigir o feijão, o job 9 continua bloqueado por skyr com reivindicação “sem glúten” nas primeiras duas tentativas e biscoito de arroz com a mesma reivindicação na terceira. O replay não transforma oito falhas de evidência em aprovações. Corrige um falso positivo e identifica os problemas seguintes, sem validar informações não comprovadas.

### AI_REVIEW_REJECTED / informação insuficiente

As oito respostas reais foram lidas com seus candidatos:

- Jobs 1 e 4: bebida de soja/pães comerciais sem formulação ou situação de contato cruzado verificável sob alergia ao leite. Rejeição por informação insuficiente compatível com a política atual; a criadora não recebeu orientação equivalente suficientemente explícita.
- Job 2: refeições agrupadas sem quantidades de cada componente, impedindo conferir nutrientes. Problema real de representação.
- Job 8, revisões 3 e 5: mingau com leite cuja quantidade de aveia não definia a porção completa; após a correção textual, nutrientes ainda incoerentes. Na revisão final, 8,89 g proteína + 37,81 g carboidrato + 8,89 g gordura implicam aproximadamente **266,81 kcal** na conta 4/4/9, contra 219,8 declaradas. A revisora escreveu “roughly 270”; o diagnóstico de divergência é sustentado pelos números, sem tratá-los como tabela nutricional verificada.

A criadora recebe agora orientação para medir componentes e reestimar o conjunto real, sem ajustar somente os números para encaixar nas metas. Nenhuma alteração no prompt/contrato da revisora. Ela continua independente e pode rejeitar mesmo que os totais declarados passem pelas bandas.

## 4. Hipóteses descartadas ou não comprovadas

- **Metas diárias ausentes:** descartada. Embora `fullPlanContext` omita `dailyTargets`, o provedor acrescenta `energy` e `dailyMacros` ao HTTP real. Teste com fetch simulado verifica exatamente esse payload.
- **Metas por refeição sistematicamente incoerentes:** a causa já corrigida na tarefa de macros não reapareceu como assinatura destes casos. Não recalculamos nem alteramos o engine.
- **Catálogo obrigatório para todo alimento:** falso. Alimentos comuns continuam livres de catálogo; somente exigências de prova existentes permanecem.
- **Revisor sempre divergindo por interpretação:** não sustentado. Há motivos concretos de quantidades, composição, evidência e energia. Não foi tornado permissivo.
- **Digest/candidato trocado após revisão:** não identificado; os artefatos anteriores verificaram oito hashes e persistência das aprovações. Novos testes conferem o envelope exato revisado.
- **Arredondamento como causa universal:** não sustentado. Há um resultado de quantização e vários de composição inviável. Nenhum aumento de limites foi feito.
- **Frase genérica pedindo fontes de macros distintas:** já testada e revertida no relatório de orçamento com resultados mistos. Não foi reaplicada como solução comprovada.
- **Qualidade/modelo garantidos após novo prompt:** não comprovado; depende de homologação autorizada.

## 5. Implementação e riscos por alteração

| Arquivo | Alteração desta tarefa | Validação / risco |
| --- | --- | --- |
| `ai/prompt.ts` | Contrato compartilhado de composição, medida, evidência e reparo; limites existentes no contexto; alternativas também reparam falhas de revisão/evidência | Payload real com fetch simulado e replay de tamanho. Risco: modelo não seguir instrução ou perder variedade; medir em A/B |
| `ai/config.ts` | Somente `PROMPT_VERSION`: v4.0.0 → v4.1.0 | Patch isolado verifica que modelo, chamadas, tokens e dólares não mudam |
| `generation/domain.ts` | Tipo privado `FoodRepairContext` e argumento opcional na exceção | Sem mudança nas funções de validação, schema ou erros públicos |
| `generation/reviewEvidence.ts` | Localização das falhas já existentes; correção estreita da nota negada | Casos positivos e adversariais; nenhuma prova nova aceita |
| `generation/attempts.ts` | Inclui `foodFailure`, quando existe, no feedback privado | Retry, restauração de checkpoint, digest e teto de quatro testados |
| `__tests__/prompt.test.ts` | Teste adicional do payload/contrato e separação da revisora | HTTP simulado, sem chamadas pagas |
| `__tests__/generationQuality.test.ts` | 17 casos novos | Política de quatro em mock de configuração isolado; respostas explicitamente simuladas |

`quality-only.patch` é o delta **desta tarefa** sobre os arquivos inicialmente encontrados, sem confundir modificações adaptativas anteriores com o novo trabalho. O contrato público de resposta/persistência não mudou. Jobs antigos sem diagnóstico novo continuam válidos. Feedback antigo sem `foodFailure` continua aceito.

## 6. Testes e verificações finais

| Verificação executada nesta tarefa | Resultado |
| --- | --- |
| Functions completas, código final | **2.141 passaram**, 457 skipped, zero falhas |
| Nutrição com Firestore Emulator, projeto isolado `demo-ajfit-quality-local` | **382 passaram**, 39 skipped, zero falhas |
| Aplicativo, `src/nutrition` | **490 passaram**, zero falhas |
| TypeScript Functions 5.6 local | passou |
| Compilação Functions `tsc -p tsconfig.build.json` | passou |
| TypeScript aplicativo `npm run typecheck` | passou |
| TypeScript dos dois snapshots A/B e do harness preparado | passou |
| Bloqueio do harness sem autorização | recusou com `MISSING_TASK_SPECIFIC_FINANCIAL_AUTHORIZATION`, antes de chave/job/HTTP; falha intencional esperada |
| Replay offline dos 22 candidatos/8 pareceres históricos | sequências/códigos preservados; itens posteriores identificados |
| Serialização offline do provedor, fetch substituído | 30 chamadas simuladas, zero rede; maior bound criadora 25.752 de 32.000, revisora 18.015 de 64.000 |
| `git diff --check -- functions/src/nutrition` | passou |

Logs em `validation/`. O teste novo de digest inicialmente comparava hashes de objetos semanticamente iguais com ordem distinta de propriedades; foi corrigido para calcular o hash do envelope efetivamente enviado, preservando a implementação de digest. Snapshots da baseline usam extensão `.snapshot`, evitando entrar no TypeScript do aplicativo. Os resultados acima são das verificações finais corrigidas.

Cobertura específica nova: falha de evidência no segundo alimento/refeição e em alternativa; recuperação em três chamadas com revisão obrigatória; checkpoint/restauração sem repetir criação; corte seguro quando a revisão posterior rejeita sob quatro chamadas; diagnóstico fora de audit; alergia legada ao leite, veganismo, vegetarianismo, múltiplas restrições, suplemento não selecionado e ingrediente com glúten; remoção de rótulo não torna aveia comprovada; caldo comercial real, ingrediente contraditório, certificação, rótulo de ausência e whey continuam exigindo evidência.

Cobertura existente reaproveitada e reexecutada: distribuição/metas, todas as macros/fibra, porções e quantização, resolução/equivalência/evidência verificada, alergias/exclusões, feedback de composição inviável, alternativas, revisão/digest, plano anterior, persistência, concorrência, idempotência, falhas de infraestrutura, budgets, jobs legados e recuperação adaptativa. Não foram escritos testes que fingem comprovar comportamento estocástico do modelo.

As **23 falhas gerais do app fora de nutrição** permanecem como resultado histórico documentado na tarefa anterior; a suíte geral não foi reexecutada nem apresentada como aprovada. Nenhum arquivo de UI, treino, assinatura, autenticação ou tema foi alterado; a suíte nutricional e o TypeScript do app passam. Não tentamos corrigir aquela dívida fora do escopo.

## 7. Segurança e compatibilidade

`source-change-verification.json` confirma hashes idênticos de `ai/provider.ts`, `ai/review.ts`, `generation/adaptiveRecovery.ts`, `callBudget.ts`, `worker.ts`, `mealAlternativeRequest.ts`, `correction.ts`, `diagnostics.ts`, `portionOptimizer.ts` e `restrictions.ts` em relação ao início desta tarefa. As mudanças no domínio são exclusivamente metadados da exceção, não validações. O trecho novo em `attempts.ts` apenas transporta o diagnóstico.

Tolerâncias de energia/macros/fibra, regras de alergênicos/exclusão, fonte da evidência, revalidação transacional, reserva financeira, modelo, limites de porção, digest e política de persistência estão preservados. Não existe aprovação automática. Sem revisão válida não se persiste plano; falha mantém o anterior. Segurança não passa a depender de obedecer ao novo prompt: os gates existentes permanecem.

A correção da nota remove uma falsa inferência de presença de produto, não aceita sua composição desconhecida. Um ingrediente real ou outra reivindicação no mesmo item continua bloqueando. Não há catálogo inventado, substituição semântica automática de alimentos nem novo serviço pago.

O novo feedback já percorre o checkpoint privado existente. Somente índice/motivo enumerado foram acrescentados; nenhum texto de alimento, perfil ou resposta foi adicionado aos logs. Sua ausência em jobs antigos é suportada. O predicado adaptativo e os fatos que o alimentam não mudaram.

A compatibilidade com **quatro chamadas/US$ 0,03** é testada explicitamente em arquivo isolado, além dos testes da política local de cinco. Não alteramos os limites da árvore de trabalho: cinco/US$ 0,04 continuam preservados localmente; quatro/US$ 0,03 só aparecem nas cópias descartáveis e testes da comparação.

## 8. Impacto esperado e limites da evidência

Melhorias técnicas demonstradas: eliminar o falso positivo reproduzido, localizar a causa de evidência por item e preservar esse diagnóstico no retry/retomada; corrigir lacunas de orientação de quantidade, composição e alternativas. Nenhuma garantia de aprovação é derivada disso.

Impactos **esperados, ainda não medidos com nova IA real**: menos refeições agrupadas/inconferíveis, mais liberdade útil ao otimizador, menos repetição de produtos sem prova, maior aprovação na primeira criação e menor custo por aprovação. O prompt cresceu; pode aumentar custo de entrada ou distração. A medição offline confirma capacidade nos casos recuperados, mas não cobre todo payload futuro nem prova redução de latência/custo.

O replay com respostas fixas conserva oito criadoras válidas, três aprovações e seis falhas. Não pode demonstrar como o modelo responderá ao contexto corrigido. Ainda há combinações inviáveis, estimativas falsas/ambíguas possíveis, produtos sem evidência e variação estocástica. A exceção de negação é deliberadamente estreita; outros casos linguísticos não foram generalizados sem evidência.

## 9. Protocolo de homologação real preparado

**Não executado. Proposta de autorização nova: até US$ 1,08, exclusiva desta tarefa. Gasto pago desta tarefa: US$ 0,00.** Nenhum valor do orçamento adaptativo anterior é transferido.

`PLAN.json` fixa previamente **36 jobs**: seis perfis × três blocos × dois braços = 18 baseline + 18 candidata. Ordem A/B ou B/A alternada por perfil/bloco. Não ampliar amostra, não parar no primeiro sucesso e não repetir seletivamente falhas. Perfis: vegetariano; alergia legada ao leite; exclusão de glúten; vegano; vegetariano com exclusões de lactose/glúten; sem restrições. Mesmo perfil físico sintético anterior (feminino, nascimento 10/04/1992, 170 cm, 68 kg, três treinos, atividade active), quatro refeições, sem preferências conflitantes; suplemento selecionado somente no perfil de leite, como no histórico.

Condições idênticas: `gpt-6-luna`, mesma API/configuração de reasoning/tokens/timeout, mesmo engine e data de referência na mesma rodada, schema, revisão e tolerâncias iguais, mesmo catálogo opcional vazio e sem uploads; IDs sintéticos novos, fixture de plano anterior e Firestore Emulator `demo-ajfit-quality-comparison`. Nenhum usuário real. O braço antigo usa exatamente os cinco arquivos de qualidade capturados antes das mudanças; o outro usa o código novo. A política de ambos é normalizada para quatro chamadas/US$ 0,03 **nas cópias temporárias**.

`prepare-comparison.cjs` monta essas cópias, verifica hashes da baseline e aceita somente o delta de cinco arquivos produtivos entre braços. `comparison-snapshots.json` registra os hashes e os diretórios resultantes. O backend compartilhado dos braços é o estado local recuperado, com os mesmos checkpoints e limites normalizados: não alegamos que seja reprodução byte a byte de todas as Functions publicadas. Isso isola a alteração de qualidade sem permitir a quinta chamada.

O harness preparado em `comparison.manual.test.ts.template` é instalado nas cópias. Foi tipado nos dois braços e teve o bloqueio por falta de autorização executado. Somente depois de autorização financeira explícita será criado `authorization.json` no diretório de artefatos, com task `generation-quality-improvement`, `approved: true`, `ceilingUsd: 1.08`, SHA-256 do PLAN e do manifesto das fontes. **Esse arquivo não existe agora.** O campo `authorized: false` do PLAN registra a ausência de autorização no momento do planejamento; o arquivo separado registra a decisão futura sem reescrever o plano aprovado.

Antes de cada job, o harness exige projeto de emulador, braço correto na ordem, fontes/harness intactos, autorização vinculada aos hashes, exclusão mútua do ledger e ausência de execução incompleta. Só depois lê a chave. Reserva pessimista antes de cada HTTP, exatamente uma invocação do provedor por reserva, máximo quatro por job; nenhuma repetição HTTP oculta. A transação do backend continua reservando também capacidade para revisão antes de uma criadora. Timeout/usage desconhecido mantém reserva integral e interrompe a rodada. Falha crítica interrompe; não há aumento de orçamento nem amostra adaptada ao resultado.

### Tamanho e custo pessimista

- Máximo: 36 × 4 = **144 chamadas**, até três criadoras por job, com revisão sempre necessária para aprovação.
- Reserva vigente por papel na tabela versionada do projeto: criadora **US$ 0,00720**, revisora **US$ 0,00715**. Não é uma cotação de faturamento externo.
- Maior sequência de quatro: três criadoras + uma revisora = **US$ 0,02875/job**; dois pares = US$ 0,02870.
- Reserva por teto formal: 36 × US$ 0,03 = **US$ 1,08**. Esse é o valor proposto para autorização e bloqueio agregado. A soma máxima por papéis seria US$ 1,035; não usamos essa diferença para adicionar execuções.
- Nenhum custo real novo, taxa nova de aprovação, economia ou ganho estatístico é afirmado. Se limites/preço do projeto não forem válidos na data autorizada, parar antes do HTTP para reconciliar; não trocar modelo nem ampliar o teto.

### Execução após autorização

Regenerar snapshots somente se os fontes temporários desaparecerem; conferir/reaprovar seus hashes antes da execução. Para cada job agendado, selecionar o braço a partir de PLAN/ledger, executar **um** teste e acompanhar sua conclusão. Exemplo de comando no diretório `functions` do braço correto:

```sh
AJFIT_QUALITY_REAL=1 AJFIT_QUALITY_ARM=baseline AJFIT_QUALITY_ARTIFACTS=/caminho/registrado/no/manifesto FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-ajfit-quality-comparison ./node_modules/.bin/vitest run src/nutrition/__tests__/generationQualityComparison.manual.test.ts
```

Esse exemplo não autoriza gasto. Nenhuma variável de ativação foi deixada configurada nem processo de homologação foi iniciado para aguardar autorização.

### Métricas e critérios fixados antes dos resultados

Por job: primeiro candidato válido determinístico; aprovação com primeira criação; aprovação após correção; falhas por etapa e nutriente; sequências; itens que exigiram prova; uso do otimizador; chamadas, reserva, usage/custo estimado e latência. Nos planos aprovados: restrições, medidas/preparação, evidências, diversidade dos alimentos, digest e igualdade exata com a persistência; nas falhas: plano anterior e apontador preservados. Medir diversidade por alimentos distintos e frequência de refeições compactadas, acompanhadas de inspeção dos perfis sintéticos; não usar somente contagem de nomes como prova de qualidade nutricional.

Critérios de triagem técnica previamente definidos, **sem equivaler a significância estatística**:

1. Nenhuma aprovação incompatível, digest incorreto, persistência sem revisão, chamada/reserva excedida, duplicação ou quinta chamada; qualquer um bloqueia liberação.
2. Candidata com pelo menos **três aprovações adicionais na primeira criação entre seus 18 jobs**, contra a baseline, e aprovação final global não inferior. Primeiro candidato válido determinístico também não pode diminuir.
3. Redução descritiva das falhas de composição/evidência na primeira tentativa; melhora observável em pelo menos dois dos três perfis prioritários, sem padrão novo de falhas repetidas introduzido por representação/contexto.
4. Custos e latências por job e aprovação apresentados com seus denominadores; aumento eventual exige justificar o ganho observado, sem alegar economia não medida. Segurança/variedade verificadas qualitativamente em todos os aprovados.
5. Resultados completos, inclusive interrupções/negativas, submetidos à revisão explícita antes de qualquer deploy. Se não satisfizerem os critérios, **não publicar** e encerrar a rodada; nenhuma extensão automática.

Três repetições por perfil/braço são uma triagem pequena, não prova de confiabilidade ampla ou superioridade estatística. As taxas históricas são referência descritiva, nunca controle experimental desta rodada.

## 10. Estado final e próximas ações necessárias

Mesmo HEAD/branch, staging vazio. `repository-final.txt` registra o working tree. Novos arquivos ficam neste diretório e em `generationQuality.test.ts`; seis arquivos existentes de nutrição foram modificados nesta tarefa (cinco runtime + um teste). Logs do emulador cresceram durante testes; não foram limpos. `source-change-verification.json` diferencia o trabalho novo do anterior.

Nenhum deploy, commit, push, EAS/TestFlight, alteração em Rules, assinatura, UI ou endpoints de treino. Nenhuma consulta de dados de usuários reais ou chamada OpenAI paga. As revisões remotas históricas permanecem as documentadas na tarefa anterior; não se afirma uma nova verificação remota nesta tarefa, pois publicação foi explicitamente excluída.

Necessário: **autorizar especificamente até US$ 1,08**, executar o protocolo já preparado, revisar os resultados reais e decidir publicação da melhoria de qualidade separadamente da recuperação adaptativa. Em uma futura preparação de deploy, transportar apenas `quality-only.patch` para a política publicada de quatro chamadas e conferir o pacote; não publicar por acidente os limites adaptativos locais. O teste de quatro chamadas e o A/B preparado fornecem a verificação dessa compatibilidade, mas não autorizam deploy.

Melhorias opcionais, sem virar novas etapas obrigatórias: ampliar evidência de alimentos/produtos quando houver fonte válida; observar disponibilidade em uso futuro; ampliar amostra somente em outra autorização/plano. Fora do escopo: 23 falhas gerais históricas do aplicativo e demais frentes de treino/Rules.

## Veredito

1. **Qualidade melhorada tecnicamente? SIM**, nos contratos de composição/medidas/feedback e no falso positivo reproduzido. A taxa de aprovação do modelo ainda não foi medida após a alteração.
2. **Principais causas corrigidas? PARCIALMENTE.** Lacunas confirmadas do software/contexto foram corrigidas; composição inviável e estimativas incorretas da IA não podem ser declaradas eliminadas sem homologação real.
3. **Segurança preservada? SIM**, nos testes e invariantes verificadas. Critérios de aprovação e independência da revisora preservados.
4. **Comprovada com IA real? AINDA NÃO para esta versão.** Evidência real histórica fundamentou a correção; novos testes são determinísticos/offline. Falta autorização financeira da comparação.
5. **Pronta para homologação? SIM.** Código, testes, perfis, plano fechado, snapshots comparáveis e bloqueio financeiro preparados.
6. **Falta para publicar?** Homologação real especificamente autorizada, evidência favorável segundo o protocolo e revisão explícita dos resultados; preparar somente o delta de qualidade sobre quatro chamadas. Nenhuma publicação realizada ou autorizada nesta tarefa.

## 11. Homologação A/B real — execução retomada após limite de tokens

### Estado encontrado na retomada

A sessão anterior havia autorizado US$ 1,08 para os 36 jobs e iniciado a execução via `real-ab/run-planned.py`. No momento da retomada, o executor original (PID 40113, lançado pelo daemon do Codex, não por um supervisor com retry) já estava **vivo e avançando sozinho**, muito além do job 8 relatado por último na conversa anterior — havia chegado ao job 13–27 em diferentes checagens. Nenhum segundo executor foi iniciado; nenhuma chamada foi repetida.

### Divergência de isolamento identificada e investigada

O Firestore Emulator ativo na porta 8080 havia sido iniciado com `--project_id demo-ajfit-dual-ai --single_project_mode true`, não com `demo-ajfit-quality-comparison` como o plano declarava. Investigação direta no emulador (leitura via token de bypass `Authorization: Bearer owner`, não uma inspeção pontual) confirmou que o armazenamento do emulador **particiona corretamente por project ID apesar da flag**: ao final dos 36 jobs, a coleção `users` do projeto `demo-ajfit-quality-comparison` continha exatamente 28 (depois 36) documentos, **100% com prefixo `synthetic-quality-`**, e a coleção equivalente em `demo-ajfit-dual-ai` continha 150 documentos de outro experimento, **sem nenhum vazamento em qualquer direção**. A divergência era um problema de rotulagem do processo, não contaminação de dados. Resultado: a execução continuou na porta 8080 sem subir um emulador dedicado, porque o próprio harness (`comparison.manual.test.ts.template`, linha 21) exige `FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'` para considerar a chamada "enabled" — mudar de porta teria exigido editar arquivo protegido por hash ou arriscado que o teste pulasse silenciosamente a chamada real.

### Defeito no mecanismo de parada, corrigido operacionalmente

A primeira tentativa de interrupção segura (gravar `ledger.json["stopped"]`) foi **revertida silenciosamente**: o harness TypeScript carrega o ledger uma única vez em memória no início de cada job e sobrescreve o arquivo inteiro a cada `save()`, apagando qualquer campo externo adicionado depois que o job começou. Jobs 21–28 continuaram correndo após essa tentativa, sem qualquer violação de limites. A interrupção efetiva usada foi `kill -TERM` dirigido exclusivamente ao PID do orquestrador (`run-planned.py`), nunca ao grupo de processos — comprovado por análise de árvore de processos (`ps -o pid,ppid,pgid`) que o subprocesso Vitest corre em sessão/grupo próprios (`start_new_session=True`), e por leitura do código-fonte que nenhum handler de SIGTERM está registrado (a ação padrão do SO mata o processo pai instantaneamente, sem executar `killpg` nem qualquer `finally`). O job em andamento (28) terminou de forma natural e completa antes da verificação; nenhuma chamada paga foi interrompida.

Correção mínima aplicada em `real-ab/run-planned.py`: adicionado um sentinela de arquivo (`STOP_REQUESTED`), checado no topo do laço junto ao `ledger.json["stopped"]` existente, imune ao problema de sobrescrita porque o harness TS nunca o toca. Validado isoladamente (compilação + simulação de três casos: sem sentinela, com sentinela, idempotência) antes de confiar nele; não foi necessário acioná-lo na retomada, pois os 8 jobs finais rodaram até o limite natural de 36.

### Retomada e conclusão

Hashes de `PLAN.json` e `comparison-snapshots.json` reconferidos contra `authorization.json` — ambos íntegros. Nenhuma dependência entre jobs foi encontrada no Firestore (cada job cria seu próprio usuário sintético e fixture de "plano anterior"; o catálogo de alimentos é fonte externa, não estado persistido) — retomar num emulador vazio quanto a jobs novos não quebrou equivalência experimental. `runner.lock` órfão removido somente após confirmar que o PID nele contido (40113) estava morto. Executor relançado, retomou exatamente do job 29 (`reserved_so_far=0.60345`, idêntico ao ledger), executou os jobs 29–36 sem intervenção manual e parou sozinho em `predefined_job_limit_reached`.

### Resultado financeiro final

36/36 jobs concluídos (18 baseline + 18 candidata). Reserva total: **US$ 0,77585** de **US$ 1,08** autorizados (28% de margem não usada). Nenhuma quinta chamada, nenhum crédito adaptativo, nenhuma violação de reserva por job (máximo observado: US$ 0,02875/job).

### Comparação A/B completa

| Métrica | Baseline (18) | Candidata (18) |
|---|---|---|
| Aprovados | 9 (50,0%) | 15 (83,3%) |
| Falhos | 9 | 3 |
| Aprovados na primeira criação | 3 | 5 |
| Aprovados após correção | 6 | 10 |
| Primeiro candidato válido determinístico | 5/18 | 5/18 |
| Chamadas totais | 56 | 52 |
| Chamadas médias/job | 3,11 | 2,89 |
| Custo estimado total | US$ 0,068882 | US$ 0,063130 |
| Custo por aprovação | US$ 0,007654 | US$ 0,004209 |
| Latência média/chamada | 18,32 s | 19,69 s |
| Alimentos únicos (total) | 91 | 103 |
| Alimentos únicos médios/job | 14,33 | 14,67 |

Falhas por código (baseline → candidata): `AI_MACRO_VALIDATION_FAILED` 11→14; `AI_EVIDENCE_INSUFFICIENT` 6→3; `AI_REVIEW_INSUFFICIENT_INFORMATION` 4→1; `AI_REVIEW_REJECTED` 5→1; `AI_CONTENT_SAFETY_MISMATCH` 3→1. Rejeições da revisora: baseline 9 (4 informação insuficiente + 5 rejeitado), candidata 2 (1+1).

Por perfil (aprovados/3, baseline → candidata): vegetariano 1→3; alergia ao leite 1→2; sem glúten 2→3; vegano 1→3; múltiplas restrições 1→1; sem restrições 3→3 (já no teto).

Nenhuma violação de segurança, financeira, de persistência ou de quinta chamada em nenhum dos 36 jobs (`safetyViolations: []` na verificação direta do ledger). Nenhum padrão de falha novo exclusivo da candidata — os mesmos cinco códigos aparecem nos dois braços, com `AI_CONTENT_SAFETY_MISMATCH` caindo de 3 para 1. Variedade de alimentos não regrediu (leve aumento na candidata).

**Nota de integridade:** a reexecução offline determinística (`analyze-results.cjs`) divergiu do resultado gravado no job 1 (esperava `AI_MACRO_VALIDATION_FAILED`, obteve aprovação no replay) — consistente com a dependência de fontes externas de catálogo (TACO/OFF) não congeladas entre a chamada real e a reanálise posterior, já reconhecida nas limitações da Seção 9 deste relatório ("não é reprodução byte a byte"). Isso não altera nenhum dos 36 resultados gravados: todos os invariantes de segurança, digest e persistência foram verificados diretamente no ledger, não via essa ferramenta de replay.

### Critérios de aceitação pré-registrados (Seção "Métricas e critérios fixados antes dos resultados") — verificação sem alteração dos critérios

1. **Nenhuma violação de segurança/financeira/quinta chamada/persistência sem revisão: ATENDIDO.** Zero violações nos 36 jobs.
2. **Candidata com pelo menos três aprovações adicionais na primeira criação (contra baseline), aprovação final não inferior, primeiro candidato válido não inferior: PARCIALMENTE ATENDIDO.** A candidata teve apenas **+2** aprovações adicionais na primeira criação (5 vs 3 — abaixo do limiar de +3 pré-registrado). A aprovação final não é inferior (83,3% vs 50,0% — superior). O primeiro candidato válido determinístico não diminuiu (5/18 em ambos). **O critério quantitativo específico de +3 não foi atingido.**
3. **Redução descritiva das falhas de composição/evidência na primeira tentativa; melhora em pelo menos dois dos três perfis prioritários; sem padrão novo de falha: PARCIALMENTE ATENDIDO.** A taxa de falha na primeira tentativa ficou **empatada** (13/18 em ambos os braços — nenhuma redução). Por outro lado, a melhora por perfil é consistente e ampla: dos quatro perfis com histórico de falha documentado nas Seções 3–4 deste relatório (vegetariano, leite, glúten, vegano), **todos os quatro** melhoraram a taxa de aprovação final — atende "pelo menos dois dos três perfis prioritários" sob qualquer leitura razoável de quais três sejam os prioritários, já que o relatório original não os enumera explicitamente. Nenhum código de falha novo exclusivo da candidata. **A cláusula de redução na primeira tentativa não foi satisfeita; a cláusula de melhora por perfil foi.**
4. **Custos/latências com denominadores; aumento justificado; segurança/variedade qualitativa: ATENDIDO.** Custo por aprovação caiu (candidata mais barata, não mais cara — sem necessidade de justificar economia). Latência média por chamada subiu ~7,4% (18,32s→19,69s); aumento pequeno e justificável pelo ganho de aprovação observado (+33,3 p.p.). Segurança e variedade verificadas qualitativamente em todos os 24 aprovados (9+15), sem regressão.
5. **Resultados completos (incluindo falhas) revisados antes de deploy; não publicar se não atender aos critérios: ATENDIDO por construção** — este relatório inclui todos os 36 resultados, inclusive as 12 falhas, e nenhuma publicação foi feita.

### Veredito objetivo

1. **36 de 36 jobs concluídos** (18 baseline + 18 candidata).
2. **Chamadas reais totais: 108** (56 baseline + 52 candidata), somando sessão anterior e esta retomada — nenhuma repetida.
3. **Gasto estimado: US$ 0,065–0,069** reais por braço (US$ 0,132012 total estimado); **reserva agregada: US$ 0,77585** de US$ 1,08 autorizados.
4. **Taxa de aprovação baseline: 50,0%** (9/18).
5. **Taxa de aprovação candidata: 83,3%** (15/18).
6. **A candidata melhorou a aprovação na primeira criação?** Sim, em termos absolutos (3→5, +2), mas **não** no limiar formal de +3 pré-registrado.
7. **Falhas de macros e evidência diminuíram?** Falhas de evidência caíram (6→3); falhas de macro subiram (11→14); o total combinado ficou **estável** (17→17), e a taxa de falha já na primeira tentativa ficou **empatada** (13/18 em ambos).
8. **Houve regressões de segurança, custo, latência ou variedade?** Nenhuma regressão de segurança ou custo (candidata mais segura dentro dos mesmos invariantes e mais barata por aprovação). Latência subiu ligeiramente (~7%). Variedade não regrediu (leve melhora).
9. **Todos os critérios de aceitação foram atendidos?** **Não.** Critérios 1, 4 e 5 sim; critérios 2 e 3 apenas parcialmente — especificamente as duas cláusulas quantitativas mais rígidas (+3 aprovações na primeira criação; redução de falhas na primeira tentativa) não foram atingidas, apesar da aprovação final e da aprovação-após-correção serem claramente superiores.
10. **A melhoria está tecnicamente recomendada para publicação?** **Não, conforme os critérios pré-registrados.** A candidata é operacionalmente mais segura, mais barata por aprovação e tem aprovação final substancialmente maior — mas o protocolo definido antes dos resultados exigia explicitamente um ganho de **primeira criação/primeira tentativa** que não se confirmou (ficou em +2 de +3 exigidos, e a taxa de falha na primeira tentativa não caiu). Seguindo a Seção 5 dos critérios ("se não satisfizerem os critérios, não publicar"), a recomendação técnica é **não publicar nesta rodada**.
11. **O que falta antes do deploy?** Decisão do usuário sobre se o ganho observado na aprovação final/após-correção (50%→83,3%) é suficiente mesmo sem o ganho formal de primeira tentativa — isso exigiria relaxar deliberadamente o critério 2/3 pré-registrado, o que não deve ser feito unilateralmente com base nos resultados. Alternativamente: nova rodada com amostra maior focada especificamente em primeira tentativa, ou investigação dirigida do aumento de `AI_MACRO_VALIDATION_FAILED` (11→14) antes de seguir para produção. Nenhum deploy, commit ou push foi realizado nesta tarefa.

## 12. Publicação em produção — exceção explícita autorizada pelo usuário

**O usuário revisou a Seção 11 (critérios 2 e 3 apenas parcialmente atendidos) e autorizou explicitamente a publicação mesmo assim, como exceção consciente aos critérios de desempenho pré-registrados — não como reclassificação dos resultados.** Nenhum critério de segurança foi enfraquecido; a publicação ficou estritamente restrita à melhoria de qualidade homologada, excluindo a recuperação adaptativa de cinco chamadas.

### Preparação segura

1. **Branch/HEAD/working tree confirmados:** branch `treinos`, HEAD `3d731c9200d3d1ba454c76a0ce0bc2bcbdc7169b`. Working tree estava dirty (16 arquivos modificados + diversos untracked, incluindo a recuperação adaptativa e o otimizador de porções) — preservado integralmente via `git stash` (somente arquivos rastreados; `docs/` e os novos arquivos não rastreados nunca foram tocados).
2. **Versão publicada verificada diretamente**, não assumida: `gcloud functions describe` nas três funções afetadas mostrou `updateTime` em 2026-10-21T23:45Z, horas depois do commit HEAD (2026-10-21T16:28Z) — consistente com a mensagem do próprio commit ("Snapshot working tree"). Confirmação direta: o `ai/config.ts` do HEAD já tinha `MAX_AI_CALLS = 4` e `MAX_JOB_RESERVED_USD = 0.03`, sem nenhum traço de recuperação adaptativa — igual à política atualmente publicada.
3. **Escopo exato identificado via grafo de imports**, não suposição: dos oito Cloud Functions de nutrição, apenas `onNutritionGenerationJobCreated`, `retryNutritionGenerationJobs` (ambas em `generation/worker.ts`) e `requestNutritionMealAlternative` (`generation/mealAlternativeRequest.ts`) importam, direta ou transitivamente, os cinco arquivos do `quality-only.patch`. `requestNutritionPlanGeneration`, `restoreNutritionPlan`, `onNutritionGenerationCompleted`, `monitorNutritionAiOperations` e `mutateNutritionDiaryV1` não importam nenhum deles e foram excluídas do deploy.
4. **Pacote isolado construído sobre HEAD, não sobre a working tree nem sobre o snapshot "baseline" do A/B**: o snapshot "baseline" usado na homologação já continha a recuperação adaptativa (código presente, apenas neutralizado por `MAX_AI_CALLS=4`) — publicá-lo teria violado a restrição explícita do usuário. Em vez disso: `git stash` isolou HEAD limpo, `patch -p1` aplicou `quality-only.patch` diretamente sobre ele (aplicação limpa, sem fuzz, confirmada por `--dry-run` antes da aplicação real).
5. **Divergência real encontrada e resolvida dentro do escopo permitido**: `ai/prompt.ts` patchado importa `CORRECTION_SCALE_MIN`/`CORRECTION_SCALE_MAX` de `generation/correction.ts`, mas o HEAD não exportava essas constantes — só existiam (sob outro nome, como literais `0.5`/`2` inline) no código local da recuperação adaptativa/otimizador, fora do escopo. Verificação: os valores são exatamente os mesmos já hardcoded no HEAD (`0.5`, `2`); a correção foi puramente aditiva — duas constantes exportadas, nenhuma mudança de comportamento em `admissibleScale`. Registrado aqui como o único ajuste de compatibilidade feito, conforme permitido na Seção 2 da autorização.
6. **Confirmado: nenhuma recuperação adaptativa de cinco chamadas entrou no pacote** — `grep` por `adaptiveRecovery|portionOptimizer|BASE_AI_CALLS` nos arquivos patchados: vazio. `MAX_AI_CALLS` permaneceu `4`, `MAX_JOB_RESERVED_USD` permaneceu `0.03` após o patch.
7. **Equivalência funcional com a candidata homologada**: os cinco arquivos patchados sobre HEAD diferem da candidata do A/B (`/private/var/.../candidate/functions/src/nutrition/...`, hash-verificada contra `comparison-snapshots.json`) apenas pelas partes de recuperação adaptativa/otimizador de porções presentes nessa última — ou seja, o pacote publicado é o delta de qualidade puro, sem a camada adaptativa que a candidata do A/B também carregava (mas que nunca foi avaliada separadamente nos critérios de aceitação, já que estava neutralizada em ambos os braços).
8. **Testes executados sobre o pacote isolado** (HEAD + patch, com `adaptiveRecovery.ts`/`portionOptimizer.ts` e seus testes dedicados temporariamente movidos fora da árvore de build, por serem features não publicadas e não pertencerem a este pacote):
   - `npm run typecheck`: **sem erros**.
   - `npm run build` (`tsc -p tsconfig.build.json`): **sucesso**.
   - `npx vitest run` (suíte completa de Functions): **2102 passaram, 1 falhou, 449 pulados** (manuais/pagos, não executados). A única falha (`generationQuality.test.ts` → "checkpoints and restores the diagnostic without replaying a paid creator call") testa explicitamente o mecanismo de checkpoint/retomada da recuperação adaptativa (`onProgress`, `startAttempt`, `initialCallCount`) — funcionalidade que não existe neste pacote por design, e não deveria passar aqui. Exclusão documentada, não ocultada.

Nenhuma divergência que comprometesse a validade do pacote foi encontrada; a execução não foi interrompida.

### Deploy

Comando executado: `firebase deploy --only functions:onNutritionGenerationJobCreated,functions:retryNutritionGenerationJobs,functions:requestNutritionMealAlternative --project ajfit-2f321`. As três funções e somente elas foram atualizadas; nenhuma Firestore/Storage Rule, autenticação, assinatura, treino, UI ou outra Function foi tocada. Nenhum EAS Build/TestFlight. Nenhum merge, commit ou push.

### Verificação pós-deploy

| Função | Revisão nova | updateTime |
|---|---|---|
| `onNutritionGenerationJobCreated` | `onnutritiongenerationjobcreated-00030-tix` | 2026-10-22T12:59:08Z |
| `retryNutritionGenerationJobs` | `retrynutritiongenerationjobs-00026-hiw` | 2026-10-22T12:59:10Z |
| `requestNutritionMealAlternative` | `requestnutritionmealalternative-00026-quk` | 2026-10-22T12:59:07Z |

Todas em `state: ACTIVE`, `allTrafficOnLatestRevision: true`, probe de startup bem-sucedido, nenhum erro nos logs (`firebase functions:log`, leitura não destrutiva, nenhuma chamada paga gerada). Código publicado confirmado: `MAX_AI_CALLS=4`, `MAX_JOB_RESERVED_USD=0.03`, modelo `gpt-6-luna` inalterado, `PROMPT_VERSION='nutrition-full-plan-v4.1.0'` (anteriormente `v4.0.0`), revisora independente intacta (arquivo não tocado pelo patch), recuperação adaptativa ausente do código publicado.

### Estado final do repositório

Após o deploy, `patch -R` desfez a aplicação do `quality-only.patch`, o ajuste de compatibilidade em `correction.ts` foi revertido via `git checkout`, os arquivos de recuperação adaptativa/otimizador voltaram ao lugar, e `git stash pop` restaurou exatamente o estado dirty original (16 arquivos modificados + untracked, idêntico ao `git status` do início desta tarefa). Nenhum commit foi criado; `git log` inalterado.

### Pendências

Nenhuma técnica. Pendência de produto: o ganho medido é na aprovação final/após-correção, não na primeira tentativa (critérios 2–3 da Seção 11 permanecem parcialmente não atendidos por registro histórico, independente desta publicação). Monitorar `monitorNutritionAiOperations` e os logs das três funções nos próximos ciclos reais de geração para confirmar em produção o que a homologação indicou em ambiente isolado.
