# Log de Evolução

## 1. Objetivo deste documento

Registrar a evolução do projeto.

Registrar decisões.

Registrar alterações aprovadas.

Registrar pendências.

Registrar divergências.

Registrar eventos importantes do desenvolvimento.

Este documento é a fonte oficial de histórico do projeto.

---

# 2. Regras gerais

Toda decisão relevante deve ser registrada.

Nenhuma decisão importante deve existir apenas em conversas temporárias.

O log deve refletir a evolução real do projeto.

---

# 3. Quem pode registrar entradas

Podem registrar entradas:

* humano coordenador
* agente PO
* agente arquiteto
* agente backend
* agente frontend
* agente QA
* demais agentes autorizados

---

## Regra obrigatória

Toda entrada deve informar:

* data
* responsável
* categoria
* descrição

---

# 4. Categorias oficiais

## [DECISÃO]

Decisões aprovadas.

---

## [REQUISITO]

Novos requisitos aprovados.

---

## [IMPLEMENTAÇÃO]

Mudanças técnicas relevantes.

---

## [CORREÇÃO]

Correções importantes.

---

## [PENDENTE]

Informações aguardando decisão humana.

---

## [QUESTIONAMENTO]

Possíveis inconsistências identificadas.

---

## [CONFLITO]

Contradições entre documentos.

---

## [BLOQUEIO]

Impossibilidade de execução.

---

## [DESCARTADO]

Ideias avaliadas e rejeitadas.

---

# 5. Estrutura obrigatória das entradas

Modelo:

```txt id="iw7k6j"
Data:
Responsável:
Categoria:

Descrição:

Impacto:

Próxima ação:
```

---

# 6. Registro de decisões

Toda decisão aprovada deve registrar:

* o que foi decidido
* motivo da decisão
* impacto esperado

---

# 7. Registro de requisitos

Todo requisito novo deve registrar:

* requisito
* origem
* documentos impactados

---

# 8. Registro de implementação

Alterações relevantes devem registrar:

* módulo afetado
* alteração realizada
* motivo

---

# 9. Registro de correções

Correções devem registrar:

* problema encontrado
* causa identificada
* solução aplicada

---

# 10. Registro de pendências

Pendências devem registrar:

* informação ausente
* responsável esperado
* impacto da ausência da decisão

---

# 11. Registro de conflitos

Conflitos devem registrar:

* documentos envolvidos
* descrição da contradição
* necessidade de validação humana

---

# 12. Registro de bloqueios

Bloqueios devem registrar:

* causa
* impacto
* condição necessária para desbloqueio

---

# 13. Registro de itens descartados

Toda ideia descartada deve registrar:

* proposta original
* motivo do descarte

---

# 14. Ordem das entradas

As entradas devem ser registradas em ordem cronológica.

A entrada mais recente deve permanecer no topo do arquivo.

---

# 15. Restrições

Não registrar:

* discussões irrelevantes
* opiniões sem impacto
* alterações temporárias
* informações duplicadas

---

# 16. Leitura obrigatória

Todos os agentes devem consultar este documento antes de iniciar uma tarefa.

A leitura deve focar nas entradas relevantes para a atividade atual.

---

# 17. Exemplo de entrada

```txt id="ht4v7m"
Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso do RevenueCat para gerenciamento de assinaturas.

Impacto:
Integração obrigatória com App Store e Google Play.

Próxima ação:
Criar documentação específica de billing.
```

---

# 18. Primeiras entradas do projeto

Data: 2026-08-04
Responsável: Agente Frontend + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Consolidada a infraestrutura final de internacionalização para `pt-BR`, `en`
e `es`. O registro de resources e namespaces passou a ter fonte única em
`src/i18n/resourceCatalog.ts`; o helper global de paridade agora detecta
chaves ausentes/extras, folhas vazias e valores não-string. Foram adicionados
os comandos `i18n:check`, `i18n:audit` e `quality`, além da documentação
permanente em `docs/17_internacionalizacao.md`.

O baseline contém 9 namespaces, 582 folhas por idioma e 1.746 traduções. O
auditor registra 33 hardcodes visuais suspeitos existentes e seis números de
mock legados em `home`, mantidos em allowlist explícita. Os guards de Assessment
foram classificados como regressões permanentes de payload, fórmulas,
protocolos e queries, apesar dos nomes históricos dos arquivos.

Impacto:
Novos namespaces entram automaticamente na paridade ao serem registrados no
catálogo. Erros estruturais encerram a auditoria com falha; hardcodes suspeitos
são reportados para triagem humana. Nenhuma lógica funcional, autenticação,
sincronização, persistência, fórmula ou protocolo foi alterado.

Próxima ação:
Revisão editorial contínua e tratamento autorizado dos hardcodes registrados
no baseline. Não houve deploy.

---

Data: 2026-07-30
Responsável: Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Preparação operacional para release da Avaliação Física (revisão de
infraestrutura, UX de falha pós-salvamento, observabilidade, checklist de
staging). Não houve deploy — nem de rules/indexes, nem de app.

- `firebase.json` (novo): não existia no repositório; sem ele os comandos
  `firebase deploy --only firestore:*` não têm como saber quais arquivos
  publicar. Aponta para `firestore.rules`/`firestore.indexes.json`.
  `.firebaserc` NÃO foi criado — não existe projeto de staging separado do
  único projeto Firebase configurado (`ajfit-2f321`, via `.env`), e não
  cabe a este agente escolher um projeto arbitrariamente. Registrado como
  risco (ver `16_checklist_staging_avaliacao_fisica.md` §2).
- `firestore.rules`: `assessments.createdAt` passou de `is timestamp` para
  `== request.time` — a checagem anterior aceitava qualquer timestamp
  fabricado pelo cliente; a nova força o uso real de `serverTimestamp()`,
  fechando uma lacuna que já existia (de forma idêntica, não corrigida
  aqui) em `questionnaires.createdAt`. Demais pontos do checklist de
  revisão (índice composto batendo com a query, direção dos campos,
  isolamento por `uid`, `update`/`delete` proibidos, `keys().hasOnly`,
  `measuredAt` não-futuro) já estavam corretos.
- `useAssessments.ts`/`AssessmentScreen.tsx`: `saveGuided`/`saveImported`
  agora retornam `{ refreshFailed }`. A UI mostra três mensagens distintas
  e sempre em português simples, sem detalhe técnico: sucesso normal,
  "Avaliação salva, mas não foi possível atualizar os dados agora" (escrita
  OK, só a releitura falhou — antes essa distinção não existia: o comitê
  anterior só evitava reportar como erro, mas mostrava a mesma mensagem de
  sucesso normal, sem avisar que a tela podia estar desatualizada), e
  "Falha ao salvar" (antes deste ajuste, uma falha real de escrita não
  mostrava NENHUM texto ao usuário, só a animação de shake). O toast virou
  um componente genérico com 3 tons (`success`/`warning`/`error`) em vez de
  um componente fixo só de sucesso.
- Observabilidade: confirmado que o projeto não tem Sentry, Crashlytics
  nem serviço próprio de logs — só `console.error` avulso, mais o padrão
  `logAuthError` já existente em `services/auth.ts`. Generalizado em
  `src/lib/logError.ts` (mesmo formato `[scope] {code, message}`, sem PII)
  e aplicado em: falha ao carregar avaliações, falha no refresh pós-escrita,
  falha ao salvar (guiada/importada), questionário sem campo `answers`.
  Nenhuma dependência nova foi instalada — ausência de observabilidade
  remota permanece registrada como pendência de produção.
- Novo `docs/16_checklist_staging_avaliacao_fisica.md`: roteiro manual para
  Android/iOS (usuário novo, usuário legado, ordenação/evolução, erros e
  rede, UI), com dados de teste concretos e resultados esperados batendo
  com `src/lib/__tests__/skinfoldCalculator.test.ts`, e critérios de
  aprovação (bloqueadores vs. não-bloqueadores).

Impacto:
Nenhuma mudança de arquitetura. Mensagens de erro/sucesso mais honestas;
lacuna de segurança fechada nas rules; observabilidade mínima sem nova
dependência; existe agora um roteiro executável antes do release.

Testes: `npm test` (49 testes) e `npx tsc --noEmit` limpos após todas as
alterações desta entrada.

Próxima ação:
Humano coordenador decide sobre projeto de staging (§2 do checklist),
publica `firestore.rules`/`firestore.indexes.json`, e executa o roteiro
manual em dispositivo real antes do release.

---

Data: 2026-07-30
Responsável: Agente QA
Categoria: [CORREÇÃO]

Descrição:
Auditoria final de produção da Avaliação Física (onboarding, autenticação,
questionário, idade, avaliação física, Firestore, regras, testes,
componentes, hooks, services). Bugs corrigidos:
- `useAssessments.ts`: `saveGuided`/`saveImported` propagavam falha de
  `refresh()` pós-escrita como se a própria gravação tivesse falhado — a
  avaliação já estava salva no Firestore, mas a UI mostrava erro,
  arriscando duplicata em um retry. Agora a falha do refresh só é logada.
- `useAssessments.ts`: sem guarda de sequência em `refresh()` — respostas
  fora de ordem (troca rápida de `uid`, duplo clique em "tentar novamente")
  podiam sobrescrever dados mais novos com uma resposta mais antiga.
  Adicionado `fetchSeq` (mesmo padrão do `loadSeq` de `AuthContext.tsx`).
- `userProfile.ts`/novo `src/lib/questionnaireAnswers.ts`: `fromPersistedAnswers`
  quebrava (`TypeError`) se o documento de questionário estivesse sem o
  campo `answers` (documento corrompido). Agora nunca lança — usa
  `defaultQuiz` como base segura. As funções de conversão foram extraídas
  para `src/lib/questionnaireAnswers.ts` (sem o efeito colateral de
  inicializar o app Firebase), o que também as tornou testáveis.
- `AssessmentScreen.tsx` (`GuidedAssessmentModal`): idade automática podia
  exibir um valor negativo/absurdo ("-3 anos") se `birthDate` estivesse
  corrompido para o futuro; salvar já era bloqueado, mas o número exibido
  era enganoso. Agora cai para "—" nesse caso.
- `AssessmentScreen.tsx` (`GuidedAssessmentModal`): IMC/massa magra/massa
  gorda eram recalculados inline em vez de reusar `computeBmi`/
  `computeLeanMass`/`computeFatMass` de `skinfoldCalculator.ts` (duplicação
  de lógica de negócio já existente e testada).
- `DateFieldsInput.tsx`: `maxLength` era 4 para todos os campos (dia/mês
  aceitavam até 4 dígitos); ajustado para 2/2/4.

Testes: `src/lib/__tests__/questionnaireAnswers.test.ts` (6 casos novos —
round-trip, compat de `age` legado ancorado em `createdAt`, documento
ausente/corrompido nunca lança). Suíte completa: 49 testes, `npx tsc --noEmit`
limpo.

Riscos residuais documentados (não corrigidos nesta auditoria — fora do
escopo "sem mudanças grandes de arquitetura"): regras do Firestore não
validam a lista completa de dobras exigidas por protocolo+sexo (só exigem
`folds` não vazio); `useAssessments` refaz a consulta completa toda vez que
a tela de Avaliação Física é montada (sem cache entre aberturas); corrida em
`saveGuided`/`saveImported`/`fetchSeq` não tem cobertura de teste automatizado
(exigiria mock de Firestore/React Testing Library, não configurado no projeto).

Impacto:
Nenhuma mudança de arquitetura ou de schema. Cinco correções pontuais de
robustez, sem alteração de comportamento visível no caminho feliz.

Próxima ação:
Nenhuma pendência de código aberta nesta auditoria.

---

Data: 2026-07-30
Responsável: Agente Arquiteto + Agente Backend + Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Migração `age` → `birthDate` no onboarding, e suíte de testes unitários da
calculadora de dobras cutâneas.

**Migração de idade:**
- `Quiz.birthDate: Date | null` substitui `Quiz.age: number`
  (`src/state/AppState.tsx`). Motivo: `age` capturado uma única vez no
  onboarding nunca era recalculado — o usuário "parava de envelhecer" no
  app.
- Novo `src/lib/ageCalculator.ts`: `computeAge(birthDate, referenceDate)`
  é agora a ÚNICA função que calcula idade em todo o projeto (Avaliação
  Física, calculadoras JP3/JP7). `birthDateFromLegacyAge(age, referenceDate)`
  existe só para compatibilidade retroativa (ver abaixo).
- `QuizScreen.tsx`: pergunta "SUA IDADE?" (wheel numérico) substituída por
  "QUANDO VOCÊ NASCEU?" (`kind: 'date'`, novo `BirthDateWheel`), usando os
  novos `src/hooks/useDateParts.ts` e `src/components/ui/DateFieldsInput.tsx`
  (compartilhados com `AssessmentScreen.tsx`, que já tinha um seletor de
  data equivalente para `measuredAt` — extraído para evitar duplicação).
- `userProfile.ts`: `answers.birthDate` persistido como `Timestamp`
  (`toPersistedAnswers`/`fromPersistedAnswers`). Contrato atualizado em
  `04_contratos_de_api.md §5`.
- **Compatibilidade com usuários antigos**: documentos de questionário
  gravados antes desta migração têm `age: number`, sem `birthDate`. Nunca
  são reescritos. Na leitura (`getLatestQuestionnaire`), se `birthDate`
  estiver ausente, é aproximado a partir de `age` ANCORADO no `createdAt`
  do próprio questionário (não em "hoje") — isso faz a idade derivada
  continuar avançando corretamente nos anos seguintes, em vez de ficar
  congelada no valor original. Nenhuma escrita nova usa `age`.
- `AssessmentScreen.tsx` (`GuidedAssessmentModal`): quando existe
  `birthDate`, a idade na data da avaliação é sempre calculada
  automaticamente (inclusive para avaliações retroativas) — o campo manual
  de idade só aparece quando não há `birthDate` disponível (fallback).

**Suíte de testes:**
- Vitest escolhido (não Jest/jest-expo): os alvos de teste
  (`skinfoldCalculator.ts`, `ageCalculator.ts`) são TypeScript puro, sem
  nenhuma dependência de React Native/Expo — Vitest evita o overhead do
  pipeline de transformação RN do jest-expo para testar funções puras.
  `vitest.config.mts` + scripts `npm test`/`npm run test:watch`.
- `src/lib/__tests__/skinfoldCalculator.test.ts` (43 casos, com
  `ageCalculator.test.ts`): JP3/JP7 masculino/feminino com valores de
  referência calculados independentemente das fórmulas documentadas em
  `15_calculadora_de_dobras_subcutaneas.md` §6–§8, soma de dobras, IMC,
  massa magra/gorda, arredondamento (§14), validações de entrada (peso,
  altura, idade, dobras, protocolo inválido, BF fora da faixa plausível).
- `src/lib/__tests__/ageCalculator.test.ts`: aniversário ainda não
  ocorrido/já ocorrido, dia 29/02, avaliação retroativa, round-trip de
  `birthDateFromLegacyAge`.

Impacto:
Idade nunca mais fica congelada. Toda a base de usuários existente
continua funcionando sem migração manual de dados. Regra de negócio
crítica (cálculo de % de gordura) agora protegida por testes automatizados.

Próxima ação:
Nenhuma pendência de código aberta. `npx tsc --noEmit` e `npm test` limpos.
Validação humana recomendada do novo seletor de data de nascimento no
onboarding (dispositivo real).

---

Data: 2026-07-13
Responsável: Agente Arquiteto Frontend + Agente UI/UX + Agente React Native + Agente Revisor
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Refatoração completa de UI/UX da tela Avaliação Física (`AssessmentScreen.tsx`).
A tela era um formulário linear único (peso/altura, dobras, resultados,
histórico e CTA de salvar todos no mesmo nível). Reorganizada em blocos
hierárquicos conforme especificação do humano coordenador:

- `PhysicalAssessmentSummaryCard` (novo, `components/fitness/`): card de
  destaque no topo com peso, % gordura, massa magra, IMC e data da última
  avaliação.
- `AssessmentEvolutionCard` (novo): deltas desde a avaliação anterior +
  espaço reservado para gráfico futuro + CTA "Ver histórico completo".
- `AssessmentSection` (novo): wrapper genérico título+conteúdo, substitui os
  blocos `Slash` soltos repetidos na tela antiga.
- `AssessmentMetricCard` (novo): tile de métrica reutilizável (substitui
  `ResultCard`/`MiniStat` duplicados).
- `FoldableSection` (novo, `components/ui/`, genérico/reutilizável): usado
  para colapsar "Dobras Cutâneas" — só expande sob demanda, não fica visível
  por padrão.
- `AssessmentActionCard` (novo): bloco "Adicionar Avaliação" com duas opções
  — Avaliação Guiada (fluxo existente) e Importar Avaliação Profissional
  (novo).
- `AssessmentHistoryCard` (novo): histórico compacto (data/peso/BF%/chevron),
  com tag "IMPORTADO" para entradas vindas do fluxo profissional.

Lógica preservada integralmente: cálculo de IMC, estimativa de % de gordura
via Jackson & Pollock 7 dobras (fórmula e fallback 18,2% inalterados,
conforme 15_calculadora_de_dobras_subcutaneas.md), validação de peso/altura,
animação de shake/toast, dropdown de protocolo, todos os 4 protocolos de
dobras. O formulário original (Avaliação Guiada) foi movido para dentro de um
modal full-screen (`GuidedAssessmentModal`), aberto a partir do novo card de
ação — não fica mais exposto por padrão na tela principal.

Novo (UI + registro local, sem cálculo): `ImportAssessmentModal` — formulário
para registrar avaliação profissional já calculada (peso, BF%, massa magra,
massa gorda, água corporal, IMC, metabolismo basal, gordura visceral). O app
apenas grava os valores informados, sem recalcular nada, conforme pedido.

Fora de escopo (decisão registrada): fotos de evolução já existem em
`ProgressScreen.tsx` (aba Evolução, fora desta tela) — não foram duplicadas
nem movidas para Avaliação Física, para não expandir escopo sobre outra tela
sem solicitação explícita.

Verificação: app rodado localmente via `expo start` (porta 8081 já ativa),
navegado com Playwright headless até Perfil → Avaliação Física, com
screenshots confirmando resumo/evolução/informações básicas/dobras/ação/
histórico, e abertura de ambos os modais (Guiada e Importar) sem erros de
console. `App.tsx` foi temporariamente alterado para pular o gate de login
durante o teste e revertido ao estado original antes de finalizar (`git diff`
confirmado limpo).

Impacto:
Nenhuma regressão de comportamento identificada. Tela reorganizada, com menos
informação visível de início e aparência mais premium, mantendo toda a lógica
de cálculo e validação original.

Próxima ação:
Humano coordenador validar visualmente em dispositivo. Ciclo futuro: gráfico
real de evolução (placeholder reservado em `AssessmentEvolutionCard`);
avaliar se `ImportAssessmentModal` deve gravar em backend real (hoje é
somente estado local, igual ao fluxo guiado).

---

Data: 2026-07-13
Responsável: Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Navegação funcional conectando `ProfileScreen` → `SettingsScreen` (solicitação
pontual do humano coordenador, fora do escopo original "apenas frontend" da
entrada anterior desta mesma data).
- `ProfileScreen.tsx`: item "Configurações" (grupo PREFERÊNCIAS) recebe
  `onPress={onOpenSettings}`, nova prop opcional `onOpenSettings`.
- `AppShell.tsx`: novo estado `showSettings`, renderizado como overlay
  absoluto (mesmo padrão de `ConsistencyScreen`/`AssessmentScreen`), incluso
  em `overlayOpen` para ocultar a tab bar.

Impacto:
Botão "Configurações" no Perfil agora abre a tela real. Demais itens da tela
de Configurações continuam com `onPress={() => {}}` (sem lógica).

Próxima ação:
Nenhuma pendência de código aberta. Lógica individual de cada item de
Configurações permanece para ciclo futuro.

---

Data: 2026-07-13
Responsável: Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Criada do zero a tela Configurações (frontend, sem lógica). Componentes novos
em `src/components/ui/SettingsSection.tsx` (`SettingsSection`, `SettingsItem`,
`SettingsValue`, `SettingsDivider`, `SettingsHeader`), reutilizando o padrão
visual já existente em `ProfileScreen.tsx` (agrupamento tipo `ProfileGroup`,
`Slash`, cores e tipografia de `theme/tokens.ts`). Tela em
`src/screens/SettingsScreen.tsx` com as seções: Conta, Treino, Notificações,
Preferências, Privacidade, Suporte e Sobre. Ícones novos adicionados a
`src/components/ui/Icon.tsx`: `bell`, `moon`, `globe`, `ruler`, `download`,
`trash`, `help-circle`, `message`, `alert-triangle`, `info`, `file-text`,
`key`.

Todos os itens usam `onPress={() => {}}` (exceto "Versão", sem ação). Sem
navegação funcional, sem integração com backend/Firebase/RevenueCat, sem
estados ou persistência — conforme escopo solicitado. `ProfileScreen.tsx` não
foi alterado.

Impacto:
Nenhum. Tela isolada, não registrada em `AppShell.tsx` nem em nenhum fluxo de
navegação existente.

Próxima ação:
Humano coordenador validar visualmente a tela. Em ciclo futuro: conectar
navegação real a partir do item "Configurações" já existente em
`ProfileScreen.tsx` (grupo PREFERÊNCIAS) e implementar lógica de cada item.

---

Data: 2026-07-11
Responsável: Agente Segurança + Agente Arquiteto + Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Auditoria completa de encerramento da persistência de login (arquitetura,
segurança, limpeza de código, performance, memory leaks, fluxo de
autenticação, conformidade com 12_seguranca_geral_do_app.md). Ver relatório
completo entregue ao humano coordenador na mesma data.

Ações concretas desta entrada:
- Removidos todos os logs de depuração temporários (`[BOOT]`, `[AUTH]`,
  `[ROUTER]`) de `App.tsx`, `src/state/AuthContext.tsx` e
  `src/screens/SplashScreen.tsx`, junto dos comentários "TEMPORARY
  DIAGNOSTIC" associados.
- Mantida a correção comportamental encontrada na entrada anterior
  (2026-07-11, splash animation sem cleanup): `sequence.stop()` no cleanup do
  `useEffect` de `SplashScreen.tsx`, e a guarda `screenRef.current ===
  'splash'` em `App.tsx` antes de aplicar o `onDone` do splash.
- Nenhuma mudança na criptografia, no `secureAuthStorage.ts` ou no
  `firebase.ts` — auditoria de segurança não encontrou desvio de boas
  práticas que justificasse alteração (AES-256-GCM, IV aleatório por
  operação, chave em Keychain/Keystore via expo-secure-store, limpeza no
  logout já cobertos pela implementação de 2026-07-09).

Impacto:
Código de produção sem logs de depuração. Nenhuma dívida técnica nova
identificada nesta auditoria além das já registradas (offline-first do
Firestore, pendente desde 2026-07-04).

Próxima ação:
Nenhuma ação de código pendente. Validação manual do humano coordenador
(cold start Android/iOS, e-mail/senha e Google) permanece recomendada antes
de publicação.

---

Data: 2026-07-11
Responsável: Agente Frontend
Categoria: [CORREÇÃO]

Descrição:
Correção da auditoria anterior (2026-07-09, entrada abaixo): a conclusão de
que a persistência do Firebase era a causa raiz estava incompleta. A
persistência de fato funciona (confirmado por log real: sessão restaurada,
decriptada, `onAuthStateChanged` com uid correto). O defeito real estava no
roteamento inicial em `App.tsx`.

Causa raiz:
`SplashScreen` (`src/screens/SplashScreen.tsx`) inicia uma animação de
1.8s (`Animated.sequence`, `useNativeDriver: true`) que chama `onDone` ao
terminar, mas o `useEffect` que a inicia não tinha função de limpeza — a
animação nativa continuava rodando mesmo após o componente desmontar. Em
cold start autenticado: `RootNavigator` (`App.tsx`) renderiza `SplashScreen`
assim que `initializing` vira `false` (tela ainda é `'splash'`, valor
inicial); no mesmo ciclo de efeitos, o bootstrap de `App.tsx` (linha ~62,
versão anterior) já troca a tela para `'app'` porque o usuário existe,
desmontando o `SplashScreen`. Sem cleanup, a animação iniciada nesse
`SplashScreen` já desmontado continua e, ~1.8s depois, chama o `onDone`
antigo (`() => setScreen('onboarding')`), sobrescrevendo `'app'` por
`'onboarding'` — o usuário via a Home por um instante e depois "voltava"
para o onboarding público, mesmo autenticado.

Solução aplicada:
- `src/screens/SplashScreen.tsx`: a sequência de animação agora é capturada
  em variável; o `useEffect` retorna um cleanup que chama `.stop()`,
  impedindo que `onDone` dispare após o unmount.
- `App.tsx`: reforço defensivo no roteador — o `onDone` do `SplashScreen`
  agora consulta uma `ref` (`screenRef`) com a tela atual e ignora a
  transição para `'onboarding'` se a tela já não for mais `'splash'` (guarda
  contra qualquer race futura do mesmo tipo, sem uso de timeout artificial).
- Logs temporários `[BOOT]`/`[AUTH]`/`[ROUTER]` com timestamp adicionados em
  `App.tsx`, `AuthContext.tsx` e `SplashScreen.tsx` para validação manual.
  Mantidos até validação humana (não remover nesta entrada).

Impacto:
Nenhuma mudança na criptografia/persistência (fora de escopo desta correção,
confirmada funcional na entrada anterior). Usuário autenticado em cold start
não deve mais "saltar" de volta para o onboarding público.

Testes feitos:
- `npx tsc --noEmit` sem erros.
- Aguardando validação manual do humano coordenador: fechar o app
  completamente, reabrir, e confirmar que a Home permanece estável (sem
  voltar para onboarding) mesmo após os ~1.8s da janela de risco.

Próxima ação:
Humano coordenador validar manualmente em dispositivo (Android e iOS) e
confirmar remoção dos logs temporários.

---

Data: 2026-07-09
Responsável: Agente Segurança
Categoria: [CORREÇÃO]

Descrição:
Auditoria da persistência de login (relato: usuário deslogava ao fechar e
reabrir o app, tanto por e-mail/senha quanto por Google).

Problema encontrado:
A implementação de persistência criptografada registrada na entrada abaixo
(2026-07-09, "Persistência de login criptografada em repouso") havia sido
adicionada ao `package.json`/`app.json` (`expo-secure-store`) sem que os
projetos nativos `android/`/`ios/` (gerados localmente, fora do controle de
versão) fossem reconstruídos. O dev client instalado no dispositivo não
possuía o módulo nativo `expo-secure-store` compilado. Toda vez que
`initializeAuth` tentava usar a persistência criptografada, a checagem
interna `_isAvailable()` do Firebase Auth (que grava/lê um valor de teste via
`secureAuthStorage`) falhava silenciosamente, e o Firebase caía para
persistência em memória sem lançar nenhum erro visível — a sessão nunca
sobrevivia ao fechamento completo do app. Isso não é um bug de lógica: o
código de `src/lib/secureAuthStorage.ts` e `src/lib/firebase.ts` está correto
(API do `expo-crypto` AES e do `expo-secure-store` conferida contra o código
nativo instalado).

Causa raiz:
Build nativo desatualizado — dependência nova adicionada sem `expo prebuild`/
rebuild do dev client.

Diagnóstico:
Instrumentação temporária (logs `[authDiag]`) foi adicionada em
`secureAuthStorage.ts`, `firebase.ts` e `AuthContext.tsx`, além de um módulo
de auto-teste isolado (`authPersistenceDiagnostics.ts`, removido após a
confirmação) que exercitava SecureStore, o roundtrip AES e o contrato
`_isAvailable()`/`_set`/`_get` do Firebase de forma independente. Após rodar
`npx expo run:android` (reconstrução completa do dev client), dois cold
starts reais (fechar totalmente o app e reabrir) mostraram a sessão sendo
lida do `AsyncStorage`, decriptada com sucesso e `onAuthStateChanged`
disparando com o `uid` correto — sem nenhum erro na cadeia.

Solução aplicada:
Nenhuma alteração de código foi necessária. A instrumentação temporária foi
revertida (código voltou ao estado da entrada de implementação anterior).
Rollback da camada de criptografia foi avaliado e descartado — não há
evidência de defeito nela.

Impacto:
Nenhuma pendência de código aberta. Este documento agora registra
explicitamente que **qualquer nova dependência nativa (SDK Expo) exige rebuild
do dev client (`npx expo run:android` / `npx expo run:ios`, ou novo build
EAS) antes de validar em dispositivo** — `android/`/`ios/` são gerados e não
acompanham automaticamente mudanças em `package.json`/`app.json`.

Testes feitos:
- `npx tsc --noEmit` sem erros após reverter a instrumentação.
- Cold start real (app fechado via app switcher e reaberto) validado 2x após
  `npx expo run:android`, com sessão de e-mail/senha persistindo.
- Logout (`signOutUser`) não foi alterado nesta entrada; segue limpando a
  sessão via `clearSecureAuthSession` (ver entrada anterior).

Próxima ação:
Humano coordenador validar também o cold start com login Google (mesma
camada de persistência, risco residual baixo) e num build iOS.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Autenticação social (Google e Apple) para produção (dev/EAS build).
- Firebase JS SDK mantido; login social via `signInWithCredential` (Google:
  @react-native-google-signin/google-signin; Apple: expo-apple-authentication
  + nonce SHA-256 com expo-crypto).
- Camada centralizada e agnóstica de provedor: `src/services/socialAuth.ts` +
  `src/services/providers/{google,apple}.{native,web}.ts` (split de plataforma;
  web fica sem imports nativos). Telas chamam `signInWithProvider(provider)`,
  sem ifs por provedor.
- Primeiro login social provisiona `users/{uid}` (e questionário só se houver
  respostas reais). Reuso de `ensureUserProvisioned` (checa existência —
  nunca duplica/sobrescreve). Listener continua somente-leitura.
- Account Linking: `auth/account-exists-with-different-credential` →
  `fetchSignInMethodsForEmail` → reautenticação + `linkWithCredential`
  (mesmo UID, dados preservados). Cobre Email↔Google↔Apple.
- AuthContext expõe `linkedProviders`; ProfileScreen lista métodos vinculados.
- app.json: plugins google-signin (iosUrlScheme) + expo-apple-authentication,
  `ios.usesAppleSignIn`, `googleServicesFile` (iOS/Android), client IDs em
  `extra`.

Impacto:
Login Google/Apple funcional em build nativa, sem duplicação de usuários.
Nenhum `addDoc` em `users`. Web permanece compilável (stubs de plataforma).

Próxima ação:
Ver [PENDENTE] de configuração de console/credenciais abaixo.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [DECISÃO]

Descrição:
Mantido o Firebase JS SDK (sem migrar para @react-native-firebase). Login social
usa credenciais nativas + `signInWithCredential`, padrão suportado do JS SDK em
React Native. Arquivos de plataforma (.native/.web) evitam imports nativos no
bundle web; tipos resolvidos por `.d.ts` (Metro resolve o arquivo de plataforma).

Impacto:
Menor disrupção. A pendência de offline-first do Firestore em RN permanece
independente desta decisão.

Próxima ação:
Nenhuma imediata.

---

Data: 2026-07-04
Responsável: Agente Backend
Categoria: [PENDENTE]

Descrição:
Configuração externa necessária (não código) para o login social funcionar:
- Firebase Console → habilitar provedores Google e Apple; manter "uma conta por
  e-mail"; avaliar proteção de enumeração de e-mail (afeta
  `fetchSignInMethodsForEmail` usado no account linking).
- Apple Developer: Sign In with Apple, Service ID; credenciais no EAS.
- Build: requer dev/EAS build (não Expo Go) para validar em dispositivo.

Impacto:
Sem essa configuração o fluxo social não completa em runtime. Verificação em
dispositivo real fica pendente.

Próxima ação:
Humano coordenador configurar console/credenciais e rodar em dev build.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [CORREÇÃO]

Descrição:
Corrigida condição de corrida na criação do documento do usuário.
Problema: a criação era feita dentro do listener `onAuthStateChanged` via
`ensureUserProfile` (padrão check-then-act não atômico: getDoc → setDoc). O
listener dispara múltiplas vezes no cadastro (criação da conta + updateProfile
do displayName), executando a criação mais de uma vez. Com o documento chaveado
por uid (setDoc) isso gerava escrita redundante; com id gerado (subcoleção)
geraria documentos duplicados.
Causa: creation dentro de fluxo reativo disparado N vezes, sem atomicidade.
Solução: a criação passou a ser um fluxo único em `signUp` (writeBatch atômico:
documento principal + questionário inicial), executado exatamente uma vez. O
listener tornou-se somente-leitura (carrega perfil + questionário no estado
global), com guarda de sequência para descartar leituras obsoletas. Nenhum uso
de `addDoc` na coleção `users` (sempre `doc(db,'users',uid)` + `setDoc`).

Impacto:
Elimina definitivamente a duplicação. `ensureUserProfile`/`createUserProfile`
removidos; `provisionNewUser` é a única função de criação.

Próxima ação:
Publicar `firestore.rules` atualizadas e validar em ambiente real.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [DECISÃO]

Descrição:
Modelagem do questionário movida para subcoleção
`users/{userId}/questionnaires/{questionnaireId}` com campos `answers`,
`version` (>=1), `createdAt` (serverTimestamp). O documento principal do usuário
deixa de conter `questionnaire`. Resolve o [PENDENTE] anterior sobre histórico
de questionários: cada reavaliação cria um novo documento imutável; o atual é o
de `createdAt` mais recente. Documentado em 03_modelagem §12 e 04_contratos §5.

Impacto:
Histórico de questionários passa a ser preservado. Regras Firestore incluem a
subcoleção (leitura/criação só do próprio dono; documentos imutáveis).
AuthContext passa a expor `profile` e `questionnaire` (mais recente).

Próxima ação:
Ao implementar reavaliações (novo treino a cada 30/60 dias), usar
`addQuestionnaire` com `version` incremental.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DESCARTADO]

Descrição:
Descartada a modelagem anterior com `users/{userId}.questionnaire` como campo
único no documento principal (snapshot mutável). Substituída pela subcoleção
`questionnaires`. A nota de "Escopo do campo questionnaire" em 04 §5 foi
substituída pela seção "Subcoleção de questionários".

Impacto:
O campo `questionnaire` no documento principal não deve mais ser usado.

Próxima ação:
Nenhuma — modelagem consolidada na subcoleção.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido o escopo do campo `users/{userId}.questionnaire`: ele representa
apenas o questionário inicial/atual usado na criação da conta (snapshot único e
mutável, atualizado junto com `updatedAt`). NÃO é histórico definitivo de todos
os questionários do usuário. Documentado em 04_contratos_de_api.md §5 ("Escopo
do campo questionnaire").

Impacto:
Nenhum agente deve tratar o campo atual como fonte de histórico. Reavaliações ou
novo questionário sobrescrevem o valor anterior. Sem impacto em código agora.

Próxima ação:
Ver pendência técnica abaixo ([PENDENTE]) sobre a modelagem de histórico.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [PENDENTE]

Descrição:
Falta modelagem de histórico de questionários. Quando o app implementar
evolução contínua, reavaliações periódicas ou novos questionários com
necessidade de histórico, será preciso criar uma modelagem própria, provável:

```txt
users/{userId}/questionnaires/{questionnaireId}
```

Nesse caso, `users/{userId}.questionnaire` passaria a referenciar apenas o
questionário ativo (ex.: por id), com o histórico na subcoleção.

Impacto:
Enquanto não existir, o sistema mantém apenas o último questionário. Histórico
de evolução do perfil (respostas anteriores) não é recuperável.

Próxima ação:
Definir a subcoleção e a estratégia de migração antes de habilitar reavaliações
— responsável: Agente Arquiteto + Humano Coordenador.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Aprovada a expansão do contrato do usuário (04_contratos_de_api.md §5),
resolvendo o [CONFLITO] registrado anteriormente nesta data. O documento
`users/{userId}` passa a incluir campos client-owned adicionais:
`role` (default "user"), `name`, `questionnaire` (respostas do questionário
inicial) e `updatedAt`. Os campos de assinatura/treino permanecem backend-owned.

Impacto:
- O app grava `userId, role, name, email, questionnaire, createdAt, updatedAt`.
- `role` restrito a "user" pelo cliente (regras Firestore); promoção só no
  backend.
- `name` e `questionnaire` tornam-se editáveis pelo próprio usuário.
- Cadastro passa a coletar o nome; questionário é persistido no documento.
- Regras Firestore e repositório `userProfile.ts` atualizados.

Próxima ação:
Revisar/publicar `firestore.rules`. Unificar o enum de status de assinatura
(04 §11 `GRACE_PERIOD` vs 13 §22) permanece pendente.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Integração inicial Firebase Authentication + Firestore para o fluxo de usuário.
- Auth por e-mail/senha (cadastro, login, recuperação de senha, logout).
- Repositório `src/services/userProfile.ts` (createUserProfile, getUserProfile,
  ensureUserProfile, updateUserProfile) como única camada de acesso a
  `users/{userId}`.
- Estado global de autenticação + perfil em `src/state/AuthContext.tsx`.
- Perfil (ProfileScreen) passa a exibir dados reais (e-mail, ano de criação,
  status de assinatura quando existir).
- Proteção de rotas: telas privadas exigem usuário autenticado.
- `firestore.rules` sugerido (acesso apenas ao próprio documento; campos
  backend-owned protegidos).

Impacto:
Cadastro cria o documento mínimo do usuário. Login carrega o perfil. Módulos
seguintes (treino, assinatura) podem consumir `activeWorkoutId` e
`subscriptionStatus` quando o backend os popular.

Próxima ação:
Validação humana das regras Firestore e das divergências abaixo.

---

Data: 2026-07-04
Responsável: Agente Backend
Categoria: [DECISÃO]

Descrição:
O documento `users/{userId}` segue o contrato oficial (04_contratos_de_api.md
§5). O aplicativo grava apenas os campos client-owned: `userId`, `email`,
`createdAt` (serverTimestamp). Os campos `subscriptionStatus`,
`subscriptionProvider`, `trialEndsAt`, `subscriptionEndsAt` e `activeWorkoutId`
são backend-owned e nunca escritos pelo cliente (RevenueCat/Cloud Functions são
a fonte de verdade — 12_seguranca §3–§11).

Impacto:
Front não define status de assinatura nem treino ativo. Regras Firestore
bloqueiam escrita desses campos pelo cliente.

Próxima ação:
Implementar Cloud Function `syncSubscriptionStatus` e webhook RevenueCat para
popular os campos de assinatura.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [CONFLITO]

Descrição:
Divergências entre a tarefa solicitada e a documentação oficial no schema do
usuário. Não foram inventados campos fora do contrato (00_orientacao §3.2):
- `displayName`/`name`, `role`, `updatedAt`, `onboardingCompleted`,
  `questionnaireCompleted`, `couponCode`: pedidos na tarefa, ausentes no
  contrato 04 §5. Não persistidos até decisão humana.
- Nome do campo de identificação: contrato usa `userId` (adotado); a tarefa
  sugeria `uid`.
- Status de assinatura: 04 §11 lista `GRACE_PERIOD`; 13 §22 lista
  `BILLING_ISSUE`/`CANCELED`. Adotado o conjunto de 13 §22 no tipo do cliente
  (não escrito pelo front). Requer unificação documental.

Impacto:
Modelo do usuário permanece aderente ao contrato. Campos adicionais dependem de
atualização do contrato antes de serem gravados.

Próxima ação:
Humano coordenador decide se o contrato 04 §5 será expandido (nome, role,
flags de onboarding, cupom) e unifica o enum de status.

---

Data: 2026-07-04
Responsável: Agente Frontend
Categoria: [PENDENTE]

Descrição:
Offline-first (02 §3.5) para Firestore não é atendido de forma durável pelo
Firebase JS SDK em React Native (persistência baseada em IndexedDB). A
integração atual usa cache em memória por sessão.

Impacto:
Leituras/escritas offline não persistem entre reinícios do app com o SDK atual.

Próxima ação:
Decidir arquitetura offline (ex.: @react-native-firebase nativo) — responsável:
Agente Arquiteto + Humano Coordenador.

---

Data: 2026-07-04
Responsável: Agente Frontend
Categoria: [PENDENTE]

Descrição:
Captura de cupom promocional no cadastro (03 §15, 13 §19) não implementada por
ausência de campo no formulário atual e de definição do campo no contrato 04 §5.

Impacto:
Origem do usuário/comissão não é rastreada no cadastro atual.

Próxima ação:
Definir UI do cupom e o campo correspondente no contrato — responsável: Agente
PO + Humano Coordenador.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso de Firebase como plataforma principal de backend.

Impacto:
Uso de Firestore, Authentication, Storage e Cloud Functions.

Próxima ação:
Definir modelagem detalhada dos dados.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso do RevenueCat para gerenciamento de assinaturas.

Impacto:
Assinaturas passam a utilizar App Store, Google Play e RevenueCat como fonte oficial de verdade.

Próxima ação:
Criar documentação específica de billing.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido que os treinos serão pré-definidos e selecionados através do questionário.

Impacto:
O sistema não gera treinos livres na versão inicial.

Próxima ação:
Definir lógica de seleção de treinos.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido funcionamento offline como requisito obrigatório.

Impacto:
Todas as decisões de arquitetura devem considerar sincronização posterior.

Próxima ação:
Definir estratégia de sincronização.

---

Data: 2026-07-09
Responsável: Agente Segurança + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Persistência de login criptografada em repouso (12 §16.1).
- `src/lib/secureAuthStorage.ts` (novo): backend compatível com
  `AsyncStorage` para `getReactNativePersistence` do Firebase JS SDK. Cada
  valor é cifrado com AES-256-GCM (`expo-crypto`, `AESEncryptionKey` /
  `aesEncryptAsync` / `aesDecryptAsync`) antes de gravar no `AsyncStorage`;
  falha de descriptografia (chave corrompida/ausente) descarta o item em vez
  de derrubar o app.
- A chave de criptografia é gerada uma vez por dispositivo e armazenada só
  no Keychain/Keystore via `expo-secure-store` (nova dependência, plugin
  registrado em `app.json`), nunca no `AsyncStorage`.
- `src/lib/firebase.ts`: `initializeAuth` passa a usar `secureAuthStorage` no
  lugar do `AsyncStorage` puro.
- `src/services/auth.ts`: `signOutUser` chama `clearSecureAuthSession` após
  `signOut`, descartando a chave de criptografia no logout (defesa em
  profundidade além da limpeza própria do Firebase).
- `docs/12_seguranca_geral_do_app.md`: adicionada seção 16.1 documentando a
  decisão (Firebase JS SDK mantido — sem Keychain nativo — logo a
  criptografia é aplicada na camada de storage).

Motivo:
12 §16 exige mecanismo seguro de armazenamento local; o `AsyncStorage` puro
usado antes é texto plano, expondo tokens de sessão em caso de acesso ao
dispositivo. Migrar para `@react-native-firebase/auth` (Keychain/Keystore
nativo) foi avaliado e descartado por ora (maior escopo/risco de regressão
no login social) — decisão validada com o humano coordenador.

Impacto:
Nenhuma mudança de comportamento para o usuário (login continua persistindo
entre reinícios). Requer novo build nativo/dev client (plugin
`expo-secure-store` adicionado ao `app.json`), mesmo fluxo já necessário por
`expo-apple-authentication`.

Próxima ação:
Humano coordenador validar em dev build. Nenhuma pendência de código aberta.

```
```

---

Data: 2026-08-06
Responsável: Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado o módulo de Suporte do aplicativo: Central de Ajuda pesquisável e
categorizada, artigos locais por repositório substituível, formulários de bug,
sugestão e chamado, anexo opcional no Firebase Storage, criação atômica do
ticket e primeira mensagem, tela de sucesso, i18n em pt-BR/en/es e regras de
segurança testadas no emulador. Contrato detalhado em
`docs/18_modulo_suporte.md`.

Impacto:
Usuários autenticados podem criar e ler somente os próprios tickets. O cliente
não pode alterar status/prioridade nem criar mensagens administrativas. A
estrutura já suporta histórico de mensagens e evolução por backend.

Próxima ação:
Publicar `firestore.rules` e `storage.rules` no ambiente alvo; em fase futura,
implementar painel administrativo, respostas, push e limpeza de anexos órfãos.

---

Data: 2026-08-07
Responsável: Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Reorganizadas exclusivamente as telas de Perfil e Configurações. Perfil
passou a concentrar evolução, plano, conta, métodos de login e sessão; a área
de Avisos Inteligentes foi preparada como componente apresentacional que não
renderiza quando vazia. Configurações passou a concentrar somente preferências
do aplicativo, notificações, privacidade e dados, suporte e informações sobre
o app. Os fluxos existentes de Avaliação Física, Editar Perfil, idioma,
unidades e Suporte foram preservados. Itens sem tela permanecem placeholders
visuais, sem novas rotas ou lógica.

Impacto:
Nenhuma alteração em serviços, providers, hooks, contexts, Firebase,
RevenueCat, modelos ou regras de negócio. A estrutura neutra de listas foi
unificada em `SettingsSection`; adicionada cobertura estrutural contra itens
duplicados ou removidos acidentalmente. A entrada Versão passou a ler
`expo.version` do `app.json` por `Constants.expoConfig`, sem valor fixo na tela.

Próxima ação:
Validar comparação visual em iOS e Android antes do merge.

---

Data: 2026-08-07
Responsável: Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado exclusivamente o front-end da tela Segurança, acessível por
Configurações. A tela possui as seções Segurança da conta, Sessões,
Atividade e Zona de segurança, com textos estáticos e itens visuais sem ação.
O componente compartilhado `SettingsSection` passou a aceitar descrição de
item, descrição de seção e estado desabilitado.

Impacto:
Adicionado somente um overlay de navegação local entre Configurações e
Segurança. Nenhuma autenticação, biometria, validação, persistência,
integração, serviço, provider, hook ou regra de negócio foi implementada.

Próxima ação:
Validar a composição visual em iOS e Android antes do merge. As futuras ações
de segurança dependem de requisitos e contratos próprios antes da implementação.

---

Data: 2026-08-07
Responsável: Agente Segurança + Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado o fluxo de alteração de senha para contas que possuem o provider
Firebase `password`. A tela solicita senha atual, nova senha e confirmação; o
hook aplica as validações locais e o serviço executa obrigatoriamente
`reauthenticateWithCredential` antes de `updatePassword`. O item fica oculto
para contas exclusivamente Google/Apple e há proteções adicionais na
navegação, na tela, no hook e no serviço. Estados de carregamento, sucesso e
erros controlados foram traduzidos em pt-BR, inglês e espanhol.

Impacto:
Somente a ação Alterar senha passou a ter lógica. Biometria, verificação em
duas etapas, sessões, histórico e exclusão de conta permanecem estritamente
visuais. Nenhuma senha é persistida ou enviada a serviços próprios; as
credenciais são usadas apenas pela API oficial do Firebase Auth durante a
reautenticação. Adicionados testes de validação, mapeamento de erro, elegibilidade
por provider, ordem das chamadas e interrupção do fluxo em falhas.

Próxima ação:
Validar o fluxo com uma conta de teste e-mail/senha em dev build. O repositório
não possui emulador de Firebase Auth configurado, portanto a suíte automatizada
cobre o contrato com mocks, não uma autenticação real.

---

Data: 2026-08-07
Responsável: Codex — Agente Frontend
Categoria: [REFATORAÇÃO]

Descrição:
Reorganizada exclusivamente a apresentação da Avaliação Física. A tela
principal passou a seguir Resumo, Evolução, Adicionar avaliação, Dobras
cutâneas e Histórico. Removidos o aviso azul do estado vazio e a seção visual
duplicada de Informações básicas; seus valores continuam disponíveis
internamente como preenchimento inicial dos formulários. Dobras cutâneas virou
um resumo compacto. O protocolo ganhou ênfase visual nos formulários e as
ações de salvar das avaliações guiada e importada passaram para um rodapé fixo
compartilhado. A avaliação mais recente recebeu maior destaque na timeline.
No estado sem evolução, dicas repetidas dentro dos dois gráficos foram
suprimidas e permaneceu apenas a mensagem central já traduzida.

Impacto:
Nenhum cálculo, validação, protocolo, gráfico, callback, payload, consulta,
persistência, serviço, hook, provider, navegação ou resource de i18n foi
alterado. A mudança se limita a `AssessmentScreen`, apresentação da timeline,
testes estruturais e documentação de staging.

Próxima ação:
Humano coordenador validar hierarquia, rodapé fixo e comportamento do teclado
em iOS e Android, incluindo telas compactas.

---

Data: 2026-08-07
Responsável: Codex — Agente Frontend
Categoria: [REFATORAÇÃO]

Descrição:
Simplificado o formulário de Avaliação Guiada (“Novo registro”). Os campos
visuais de sexo e idade foram removidos; sexo passa a priorizar o questionário
persistido do cadastro e idade continua calculada internamente pela data de
nascimento, considerando a data da avaliação. O campo de data foi substituído
por `NativeDatePickerField`: diálogo nativo no Android, picker nativo em modal
no iOS e fallback textual ISO na web. Datas futuras permanecem bloqueadas.

Impacto:
O payload guiado continua enviando `measuredAt`, `sex` e `age` exatamente como
antes. Fórmulas, protocolos, validação do serviço, Firestore, hooks e navegação
não foram alterados. Adicionada mensagem localizada para cadastros legados sem
sexo/data de nascimento e cobertura estrutural do picker nas duas plataformas.

Próxima ação:
Validar o seletor nativo em dispositivo iOS e Android e confirmar a seleção de
datas retroativas em ambos.

---

Data: 2026-08-07
Responsável: Codex — Agente Frontend
Categoria: [REFATORAÇÃO]

Descrição:
Altura removida dos formulários de Avaliação Guiada e Avaliação Importada. O
valor agora vem do questionário persistido do cadastro, com a avaliação mais
recente usada apenas como compatibilidade para contas legadas. A tela de
importação foi alinhada ao Novo registro: datepicker nativo, bloco separado de
informações básicas e resultados, e peso em campo de largura integral.

Impacto:
Altura continua sendo usada internamente no IMC e persistida no payload das
duas avaliações, sem alteração de contrato ou fórmulas. Cadastros sem altura
válida recebem uma mensagem localizada e não salvam dados inconsistentes.

Próxima ação:
Validar em iOS e Android o layout dos dois formulários, incluindo datepicker,
teclado e rodapé fixo em telas compactas.

---

Data: 2026-08-07
Responsável: Codex — Agente Frontend
Categoria: [REFATORAÇÃO]

Descrição:
Removida da página principal de Avaliação Física a seção visual de Dobras
cutâneas. A hierarquia agora segue diretamente de Adicionar avaliação para
Histórico. Também foram removidos o resumo derivado da última avaliação guiada
e as quatro traduções que existiam exclusivamente para esse bloco.

Impacto:
As dobras continuam disponíveis no formulário de Novo registro, permanecem
nos cálculos e seguem sendo persistidas normalmente. Nenhum contrato, fórmula,
serviço, consulta, payload ou registro histórico foi alterado.

Próxima ação:
Validar visualmente a transição entre Adicionar avaliação e Histórico em telas
iOS e Android.

---

Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementada a verificação obrigatória de e-mail exclusivamente para contas
que possuam o provider Firebase `password`. O cadastro inicia um único
`sendEmailVerification` assim que o usuário é criado, preservando em paralelo
o provisionamento existente. A nova `EmailVerificationScreen`, o hook e o
serviço dedicado oferecem confirmação explícita via `User.reload()`, reenvio
manual com loading/rate limit, feedback localizado e logout pelo fluxo já
existente.

O guard central de `App.tsx` passou a priorizar a condição `password` +
`emailVerified === false` antes do questionário e do aplicativo, inclusive em
sessões restauradas. Firebase Authentication permanece como única fonte de
verdade; nenhum campo foi adicionado ao Firestore ou à persistência local.
Google e Apple foram preservados sem regra de verificação inferida por
provider. O linking continua no mesmo UID e agora devolve explicitamente o
`User` atualizado retornado por `linkWithCredential`, incluindo o valor real
de `emailVerified` após a operação.

Impacto:
Usuários de e-mail/senha não acessam o fluxo principal até a confirmação real
no Firebase. Contas exclusivamente Google/Apple não são bloqueadas. Não houve
migração do Firebase Auth, dependência nova, alteração de Rules, deep linking,
polling ou implementação de MFA.

Testes feitos:
- serviço de envio/recarga, sessão nula/trocada e
  `auth/too-many-requests` com mocks;
- regra do guard para password verificado/não verificado, Google, Apple,
  providers vinculados e ausência de sessão;
- contrato estrutural do guard, cadastro, logout e account linking;
- paridade e cobertura de textos em pt-BR, inglês e espanhol;
- suíte completa e TypeScript.

Próxima ação:
Humano coordenador validar o fluxo real em development build com contas de
teste e-mail/senha, Google e Apple. O repositório não possui emulador de
Firebase Auth; os testes automatizados cobrem o contrato com mocks.

Assinatura:
Codex — 2026-08-10 — prompt da tarefa de verificação de e-mail (versão 1).

---

Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
POC técnica isolada de TOTP MFA preparada na branch
`feature/totp-mfa-poc`, mantendo Firebase Authentication no JS SDK. A POC
temporária e exclusiva de development cobre geração do segredo, URI
`otpauth://`, assertion/enrollment, leitura de `enrolledFactors`, captura de
`auth/multi-factor-auth-required`, seleção do hint TOTP e resolução do login.
O fluxo concluído por `resolveSignIn` não navega manualmente: permanece sob o
listener do `AuthContext` e o guard central já existente.

Resultado:
TypeScript, 870 testes da suíte completa, 548 testes de i18n, auditoria i18n e
21 verificações do Expo Doctor foram aprovados. A execução real do ciclo com o
backend Firebase e autenticador ainda não foi realizada em development builds
Android e iOS; portanto, o resultado desta fase permanece **NO-GO** até a
validação obrigatória nos dois sistemas.

Impacto:
Não houve implementação de MFA de produção, migração de SDK, dependência nova,
mudança de persistência, Firestore/Storage Rules, claims, SMS, reCAPTCHA ou
alteração da `SecurityScreen`. O segredo e o OTP não são persistidos nem
logados. O acesso à POC e a captura experimental no login são condicionados a
`__DEV__`.

Próxima ação:
Executar enrollment, código incorreto e novo login com TOTP em Android e iOS,
confirmando que um usuário com questionário existente retorna ao Dashboard e
não ao Quiz. Somente após os dois resultados reais a POC poderá ser marcada
como GO.

Assinatura:
Codex — 2026-08-10 — Fase 1 da POC TOTP MFA.

---

Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Substituído o enrollment experimental da POC por gerenciamento TOTP de
produção em Configurações → Segurança → Verificação em duas etapas. O status
é relido de `multiFactor(user).enrolledFactors`; ativação e desativação exigem
reauth de senha, operam sobre fatores TOTP explícitos e não criam flags no
Firestore ou na persistência local. O enrollment oferece QR Code, chave
manual, cópia explícita e abertura segura da URI `otpauth://`.

Segurança:
O segredo permanece somente na memória do hook e é limpo após sucesso,
cancelamento, troca de usuário e unmount. Nenhum segredo, OTP ou token é
logado. Contas somente Google/Apple ficam bloqueadas até a reautenticação
federada da Fase 3. Na desativação de contas já protegidas, o fluxo também
resolve o challenge TOTP se o Firebase o exigir durante a reautenticação.

Resultado automático:
TypeScript, 879 testes da suíte completa, 548 testes de i18n, auditoria i18n,
21 verificações do Expo Doctor e `git diff --check` aprovados. A validação
manual desta implementação em development builds Android/iOS permanece
pendente antes da aprovação humana da fase.

Limites:
O enrollment DEV da POC e seu acesso em Configurações foram removidos. A ponte
DEV de challenge por e-mail/senha permanece temporariamente para preservar a
prova da Fase 1. O challenge definitivo de login para e-mail/senha, Google e
Apple, recovery e revogação de sessões não foram implementados.

Próxima ação:
Executar o roteiro manual de ativação, configuração com um celular, código
incorreto, cancelamento e desativação em Android e iOS. Depois da revisão
humana, iniciar a Fase 3 para o challenge de login de produção.

Assinatura:
Codex — 2026-08-10 — Fase 2 de enrollment/gerenciamento TOTP.

---

Data: 2026-08-10
Responsável: Codex — Agente Frontend + Segurança + QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Implementado o challenge TOTP definitivo no login de produção para
e-mail/senha, Google e Apple. Os services preservam o
`auth/multi-factor-auth-required` original; `src/services/mfaTotp.ts` mantém o
`MultiFactorResolver` somente em memória; `useTotpChallenge` controla seleção
de fator, OTP, retry, expiração e cancelamento; `TotpChallengeScreen` fornece a
UI única do fluxo. A ponte DEV da POC e seus três arquivos paralelos foram
removidos.

Integração:
Após `resolveSignIn`, nenhum `User` é definido e nenhuma rota é aberta
manualmente. `onAuthStateChanged` continua sendo a autoridade, carrega perfil
e questionário e entrega o estado ao guard central. Assim, um usuário existente
com questionário e TOTP retorna ao Dashboard, sem passar pelo Quiz. Linking
continua separado de `account-exists-with-different-credential` e conclui a
credencial pendente no mesmo UID depois do segundo fator.

Segurança:
Resolver, hints internos, credencial de linking e OTP não são persistidos nem
logados. Cancelamento/unmount/erro terminal limpam a memória. Código incorreto,
rede e rate limit permitem retry. Nenhuma alteração foi feita em
`secureAuthStorage`, inicialização/persistência do Firebase, Firestore/Storage
Rules, schemas ou custom claims. SMS, reCAPTCHA, recovery codes e revogação de
outras sessões seguem fora do escopo.

Validação:
Testes automatizados cobrem primeiro fator com e sem MFA nos três provedores,
resolução/retry/limpeza do resolver, linking, múltiplos hints, fator não TOTP,
expiração, logout, verificação de e-mail, persistência segura, guard
Quiz/Dashboard e paridade i18n. A validação runtime com contas reais e
development builds Android/iOS continua obrigatoriamente manual.

Assinatura:
Codex — 2026-08-10 — Fase 3 do challenge de login TOTP.

---
