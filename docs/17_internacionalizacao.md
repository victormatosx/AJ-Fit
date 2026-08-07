# Internacionalização

## 1. Escopo e idiomas

O AJ Fit suporta `pt-BR`, `en` e `es`. O contrato está em
`src/types/language.ts`; IDs persistidos não mudam com o idioma.

O catálogo runtime único fica em `src/i18n/resourceCatalog.ts`. Os namespaces
registrados são: `common`, `settings`, `errors`, `onboarding`, `quiz`, `home`,
`profile`, `workout`, `assessment`, `auth` e `support`.

## 2. Fonte de verdade e bootstrap

- Firestore: preferência da conta autenticada.
- AsyncStorage (`ajfit-language`): cache local da escolha aplicada.
- AsyncStorage (`ajfit-pending-language-sync`): escolha autenticada ainda não
  confirmada pelo Firestore.
- `expo-localization`: idioma inicial do sistema quando não há cache.
- inglês: fallback final do i18next para idioma ou chave indisponível.

`App.tsx` aguarda fontes e `initI18n()` antes de renderizar a aplicação. O
bootstrap é idempotente e mantém uma única Promise por runtime, evitando
reinicialização, listeners duplicados e flicker.

Na reconciliação autenticada, a precedência é:

1. escolha pendente do mesmo UID;
2. preferência remota válida;
3. idioma local já aplicado;
4. idioma do sistema no primeiro bootstrap;
5. inglês como fallback do i18next.

Uma escolha pendente de outro UID é descartada. Falha remota recuperável mantém
a escolha local pendente; rejeição permanente restaura uma preferência remota
válida quando disponível. A implementação e seus testes ficam em
`syncLanguage.ts` e `syncLanguage.test.ts`.

## 3. Responsabilidade dos namespaces

| Namespace | Chaves | Responsabilidade | Consumidores principais | Avaliação |
|---|---:|---|---|---|
| `common` | 21 | ações, estados, navegação e acessibilidade compartilhados | AppShell, formulários e componentes de data | tamanho adequado |
| `settings` | 34 | tela e seletor de idioma | SettingsScreen | coeso |
| `errors` | 6 | erros genéricos controlados | sem consumidor de produção no baseline | pequeno; manter até decisão editorial |
| `onboarding` | 28 | apresentação inicial e montagem visual do plano | OnboardingScreen, AnalyzingScreen | coeso |
| `quiz` | 138 | questionário e catálogo visual de equipamentos | QuizScreen, EquipmentPicker | grande por catálogo, mas ainda coeso |
| `home` | 86 | dashboard, progresso e consistência mensal | HomeScreen, ProgressScreen, ConsistencyScreen, AppShell | contém seis números de mock allowlisted |
| `profile` | 96 | perfil, edição, foto e sessão | ProfileScreen, EditProfileScreen, ProfileAvatar | amplo, porém dentro do domínio |
| `workout` | 105 | execução, séries, substituições e catálogo de exercícios | WorkoutScreen | grande por catálogo, sem ganho claro em dividir agora |
| `assessment` | 118 | estrutura, formulários, resultados e histórico | AssessmentScreen e cards | grande, mas a divisão aumentaria risco sem reduzir acoplamento atual |
| `auth` | 67 | cadastro, login, recuperação, erros visuais e vinculação | AuthScreen | coeso; não contém lógica dos providers |
| `support` | 63 | central de ajuda, tickets, sugestões e sucesso | telas e componentes de Support | coeso |

Total: 11 namespaces, 763 folhas por idioma e 2.289 traduções carregadas. Não há
namespace `paywall` ou `navigation` separado; navegação compartilhada
está em `common`.

## 4. Convenção de resources

- Use chaves semânticas: `dominio:responsabilidade.elemento`.
- Não use o texto traduzido como chave.
- Toda folha nova deve ser string e existir nos três idiomas.
- Arrays de strings são aceitos como coleções visuais; cada elemento é uma
  folha validada.
- Valores não-string são proibidos, exceto os seis números de mock existentes
  em `home:upcoming.items.*`, registrados explicitamente em
  `resource-audit-allowlist.json`.
- `common` recebe somente ações, estados, navegação ou acessibilidade realmente
  globais. Não foram encontradas frases de negócio ou copy específica nele.

## 5. Como adicionar uma chave

1. Escolha o namespace proprietário.
2. Adicione a mesma chave em `pt-BR`, `en` e `es`.
3. Use uma folha string não vazia.
4. Consuma com `useTranslation(namespace)` e chave literal quando possível.
5. Use interpolação para frases completas e `count` para plurais.
6. Execute `npm run i18n:check` e `npm run i18n:audit`.

Exemplo de plural:

```json
{
  "records_one": "{{count}} registro",
  "records_other": "{{count}} registros"
}
```

```ts
t('records', { count })
```

Exemplo de interpolação:

```json
{ "welcome": "Olá, {{name}}." }
```

Não monte frases com `t(...) + texto` ou fragmentos traduzidos.

## 6. Como adicionar um namespace

1. Crie o JSON de mesmo nome nas três pastas de idioma.
2. Importe os três resources e registre o namespace uma única vez em
   `resourceCatalog.ts`.
3. Adicione o resource pt-BR à augmentação de `types.d.ts`.
4. O teste global de paridade passará a cobri-lo automaticamente.
5. Documente responsabilidade e consumidores neste arquivo.

## 7. Como adicionar um idioma

Não adicionar sem decisão de produto e revisão de persistência/regras.

Quando autorizado:

1. amplie `SUPPORTED_LANGUAGES` e a validação correspondente do Firestore;
2. crie todos os resources com paridade;
3. registre o idioma no catálogo;
4. atualize normalização, seletor, testes de storage/sync e documentação;
5. valide datas, números, plurais e layout em dispositivo.

## 8. Datas e números

- Use o idioma ativo em `Intl.DateTimeFormat` e `Intl.NumberFormat`.
- Não hardcode `pt-BR` para apresentação.
- Não altere timestamp, timezone, ordenação ou formato persistido.
- Não converta unidades por inferência do idioma.
- Símbolos universais (`kg`, `cm`, `mm`, `%`) podem ser literais quando não
  formam uma frase.

## 9. Persistência

Nunca traduzir ou persistir:

- IDs, enums, status e nomes de campos;
- payloads, protocolos e chaves de dobras;
- nomes e observações do usuário;
- valores numéricos e resultados calculados;
- nomes originais vindos de serviços externos.

A UI traduz labels ao redor desses dados. Testes permanentes protegem IDs do
questionário, protocolos, payloads de avaliação e catálogo de exercícios.

## 10. Chaves dinâmicas e fallbacks

Casos autorizados:

- Quiz: IDs fechados de `Quiz` e opções persistidas; cobertura em
  `quizIds.test.ts` e `quizRuntime.test.ts`.
- Workout: `db` estável do ExerciseDB; o catálogo completo é testado. Ausência
  usa o nome original e emite warning somente em `__DEV__`.
- Equipamentos: ID externo permanece persistido; ausência usa o ID em title
  case, nunca uma chave i18n crua.
- Perfil: status de assinatura usa `subscription.labels.unknown`; provider IDs
  permanecem `google.com`, `apple.com` e `password`.
- Assessment: IDs fechados de protocolos, dobras e classificações são mapeados
  para chaves visuais e cobertos pelos guards de domínio.

Fallbacks de idioma inválido usam inglês; ausência de preferência remota mantém
o idioma local e produz log técnico. Nenhum fallback escreve tradução em dados.

## 11. Política contra hardcodes

- Todo texto visível ao usuário deve usar i18n.
- Logs técnicos, comentários e testes não precisam de tradução.
- IDs, códigos, conteúdo do usuário e marcas não são traduzidos.
- Símbolos universais podem permanecer literais.
- Erros externos devem ser mapeados para mensagens controladas.
- Frases não podem ser concatenadas.
- Plurais devem usar as regras do i18next.
- Labels traduzidos nunca podem compor IDs, payloads ou persistência.

`npm run i18n:audit` gera relatório de paridade, tipos inválidos, consumidores
literais sem recurso e hardcodes suspeitos. Marca, símbolos, IDs, testes, logs,
comentários e documentação ficam fora da detecção. Hardcodes são relatório
informativo; erros estruturais encerram o script com falha.

## 12. Testes e comandos

```sh
npm run typecheck
npm test
npm run test:rules
npm run i18n:check
npm run i18n:audit
npx expo-doctor
```

O helper global `resourceParity.ts` detecta chaves ausentes/extras, folhas
vazias e valores não-string. Bootstrap, fallback, normalização, storage,
pending sync, sincronização remota e contratos persistidos têm testes próprios.

## 13. Baseline e limitações conhecidas

Baseline de 2026-08-04:

- 11 namespaces;
- 763 folhas por idioma;
- 2.289 valores traduzidos;
- 7 hardcodes suspeitos detectados em produção;
- 6 valores numéricos legados de mock explicitamente allowlisted em `home`;
- 0 erro estrutural de resource ou consumidor literal;
- dependências i18n presentes e usadas: `i18next`, `react-i18next`,
  `expo-localization` e AsyncStorage; uma única versão de i18next instalada.

Telas/componentes com consumidores i18n: AppShell, Auth, Settings, Onboarding, Analyzing, Quiz,
Home, Progress, Consistency, Profile, EditProfile, Workout, Assessment,
EquipmentPicker, componentes de data, avatar e cards de Assessment.

Hardcodes conhecidos estão concentrados em PaywallScreen e PlanReadyScreen.
Esta fase
não os altera porque mudanças foram limitadas à infraestrutura, testes,
resources, scripts e documentação. A contagem é aproximação estática, não um
percentual de cobertura editorial.

## 14. Checklist de PR

- [ ] Texto visível usa o namespace correto.
- [ ] pt-BR, en e es têm a mesma chave string não vazia.
- [ ] Frases usam interpolação; plurais usam `count`.
- [ ] Nenhuma tradução entra em ID, payload ou persistência.
- [ ] Datas e números usam o idioma ativo.
- [ ] Chave dinâmica usa ID estável, fallback seguro e teste.
- [ ] `npm run i18n:check` e `npm run i18n:audit` passam.
- [ ] TypeScript e testes gerais passam.
