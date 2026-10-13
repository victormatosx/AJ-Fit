# AJ Fit Nutrition — Visão e Escopo do Produto

## 1. Visão

O módulo de Nutrição do AJ Fit será uma área própria do aplicativo, acessível exclusivamente a usuários com assinatura ativa, incluindo período de teste gratuito e assinantes pagantes.

A proposta da V1 é permitir que o usuário:

1. gere um plano alimentar personalizado com apoio de inteligência artificial;
2. acompanhe diariamente o que deveria consumir;
3. registre o que realmente consumiu em cada refeição, mesmo quando diferente do plano recomendado;
4. visualize a diferença entre o planejado e o consumido;
5. acompanhe métricas de adesão e evolução nutricional ao longo do tempo.

A Nutrição deve funcionar como parte integrada do ecossistema AJ Fit, mas com navegação e experiência próprias.

## 2. Princípio central do produto

O AJ Fit deve separar claramente dois conceitos:

- **Plano recomendado:** o que o AJ Fit sugere que o usuário consuma.
- **Consumo realizado:** o que o usuário efetivamente registrou que consumiu.

O usuário não é obrigado a seguir o plano. Ele pode registrar qualquer alimento consumido. O produto deve informar de forma clara, objetiva e não punitiva quando o consumo real se afastar do planejado.

A inteligência artificial participa da criação e personalização do plano alimentar, mas a experiência do usuário não deve ser apresentada como um chatbot nem depender de interação conversacional com IA.

## 3. Objetivos atendidos na V1

A V1 deve suportar planos alimentares voltados para:

- emagrecimento;
- ganho de massa;
- manutenção;
- definição/composição corporal.

A definição exata das regras nutricionais de cada objetivo pertence ao `03_nutrition_engine/` e não a este documento.

## 4. Público e elegibilidade

### 4.1 Acesso ao módulo

O módulo é acessível a usuários com acesso válido ao AJ Fit:

- período de teste gratuito ativo;
- assinatura paga ativa.

Não existe uma camada gratuita independente para Nutrição na V1.

### 4.2 Elegibilidade nutricional

A V1 terá públicos e condições para os quais a geração automática poderá ser bloqueada por segurança.

A lista final de públicos bloqueados ainda não está definida e deverá ser especificada em `09_safety/eligibility_and_gates.md`.

Quando um usuário cair em um caso bloqueado:

- o AJ Fit não deve gerar automaticamente um plano alimentar;
- o aplicativo deve orientar o usuário a buscar acompanhamento profissional apropriado.

## 5. Experiência alimentar da V1

### 5.1 Plano alimentar

O AJ Fit gera um plano com refeições específicas e alimentos definidos.

Cada refeição deve oferecer, por padrão, aproximadamente 2 a 3 opções equivalentes para facilitar adesão e flexibilidade.

O plano deve respeitar, quando aplicável:

- alimentos de que o usuário gosta;
- alimentos de que o usuário não gosta;
- alimentos que ele já costuma consumir;
- vegetarianismo;
- veganismo;
- intolerâncias;
- alergias;
- quantidade desejada de refeições por dia.

Na V1, a experiência será orientada prioritariamente a alimentos comuns no Brasil e ao contexto alimentar brasileiro.

### 5.2 Flexibilidade

O produto deve combinar estrutura e liberdade.

O usuário poderá:

- trocar um alimento individual;
- trocar uma refeição inteira;
- editar quantidades;
- escolher entre opções equivalentes;
- favoritar refeições;
- informar que não gostou de uma sugestão;
- informar o motivo da rejeição;
- registrar alimentos diferentes dos previstos no plano.

Feedbacks e preferências aprendidas devem persistir e influenciar sugestões futuras.

### 5.3 Regeneração do plano

Na V1, após a criação inicial, o fluxo padrão não deve incentivar regeneração completa e irrestrita da dieta.

As alterações devem ocorrer prioritariamente de forma parcial:

- troca de alimento;
- troca de refeição;
- edição de quantidade;
- aplicação de preferências.

Versões anteriores do plano devem ser mantidas em histórico e poderão ser restauradas.

## 6. Diário alimentar

A V1 terá um diário alimentar completo.

O usuário poderá registrar o que realmente consumiu em cada refeição, independentemente de o alimento estar ou não no plano recomendado.

O diário deve permitir comparar:

- planejado vs. consumido;
- calorias planejadas vs. consumidas;
- proteína planejada vs. consumida;
- carboidratos planejados vs. consumidos;
- gorduras planejadas vs. consumidas;
- fibras planejadas vs. consumidas;
- aderência diária e semanal.

## 7. Métricas e acompanhamento

A Home de Nutrição deverá priorizar:

- calorias e macronutrientes do dia;
- refeições do dia;
- próxima refeição;
- progresso semanal/aderência.

A V1 deve reutilizar a estrutura de evolução já existente no AJ Fit para peso, medidas e demais métricas corporais relevantes, evitando duplicação de fontes de verdade.

Na V1, o AJ Fit **não ajustará automaticamente** o plano com base no progresso do usuário.

Também não haverá revisão automática semanal, quinzenal ou mensal.

## 8. Relação com treino

Na V1, a Nutrição não terá regras diferentes para dias de treino e descanso.

O plano alimentar não deve, nesta primeira versão:

- variar automaticamente calorias por dia de treino;
- variar distribuição de carboidratos em função do treino;
- gerar refeições específicas pré/pós-treino por lógica do calendário;
- criar planos separados para treino e descanso.

A integração profunda treino + nutrição permanece como evolução futura do produto.

## 9. IA na experiência

A IA deve atuar nos bastidores.

O usuário não deve precisar saber qual modelo ou provedor gerou sua recomendação.

Na V1:

- não haverá chat nutricional;
- não haverá assistente conversacional aberto;
- IA será usada para gerar e adaptar opções dentro de fluxos controlados do produto;
- ações de substituição devem aparecer como funcionalidades normais do AJ Fit.

O tom da experiência deve ser simples, profissional e humano, sem soar robótico.

## 10. Dados nutricionais exibidos

A V1 exibirá:

- calorias;
- proteínas;
- carboidratos;
- gorduras;
- fibras.

Micronutrientes completos ficam fora do escopo inicial.

## 11. Suplementos

A V1 terá suporte mínimo a suplementos nutricionais, inicialmente com foco em whey/proteína em pó.

O usuário poderá cadastrar suplementos próprios.

**Pendente de definição:** se o cadastro de suplemento próprio poderá representar qualquer suplemento ou apenas itens com contribuição nutricional compatível com o diário alimentar da V1.

## 12. Idiomas e mercado

A Nutrição deve nascer preparada para:

- português do Brasil;
- inglês;
- espanhol.

Mesmo com suporte de idioma internacional desde o início, o conteúdo alimentar e a curadoria da V1 serão prioritariamente orientados ao Brasil.

## 13. Fora do escopo da V1

Ficam explicitamente fora da primeira versão:

- reconhecimento de comida por foto;
- leitura de código de barras;
- chat nutricional com IA;
- receitas completas;
- lista de compras;
- integrações com Apple Health, Health Connect ou equivalentes;
- plano diferente para dia de treino e descanso;
- ajuste automático da dieta baseado na evolução;
- ciclos automáticos de revisão do plano;
- micronutrientes completos.

## 14. Critério de sucesso da V1

A V1 estará funcionalmente pronta quando um usuário elegível conseguir:

1. concluir os dados necessários para Nutrição;
2. gerar um plano alimentar personalizado;
3. visualizar sua recomendação por refeições e opções;
4. registrar os alimentos realmente consumidos ao longo do dia;
5. comparar consumo real com o plano recomendado;
6. realizar substituições e edições permitidas;
7. visualizar métricas de adesão e evolução;
8. recuperar versões anteriores do plano quando necessário.

## 15. Princípios de produto

1. **Recomendação, não imposição:** o plano orienta; o diário registra a realidade.
2. **Flexibilidade com estrutura:** o usuário tem alternativas sem perder referência de metas.
3. **IA invisível e controlada:** IA melhora a experiência, mas não é a experiência.
4. **Uma única fonte de verdade:** dados corporais compartilhados com o restante do AJ Fit não devem ser duplicados.
5. **Segurança antes da geração:** casos inelegíveis devem ser bloqueados antes da criação do plano.
6. **Feedback gera personalização:** rejeições, preferências e favoritos devem melhorar sugestões futuras.
7. **Brasil primeiro, internacionalização desde o início.**
