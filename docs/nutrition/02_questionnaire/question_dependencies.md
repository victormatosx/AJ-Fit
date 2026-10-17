# AJ Fit Nutrition — Dependências do Questionário

> Revisão 2026-10-16: padrão alimentar fica na página de exclusões e pode estar
> vazio (`omnivore`). Alimentos habituais são apenas legado. As páginas de
> gestação/amamentação e a confirmação de elegibilidade foram removidas.
> Flags históricas são preservadas para compatibilidade, sem bloqueio de geração.
> As dependências de treino continuam usando suas próprias triagens, sem ler
> o perfil nutricional. Esta revisão prevalece sobre as regras históricas abaixo.


## 1. Objetivo

Este documento define quando cada pergunta nutricional deve aparecer, quais dados dependem do perfil existente do AJ Fit e quais respostas alteram elegibilidade ou geração.

A regra central é manter o questionário progressivo e evitar perguntas que não tenham utilidade direta na V1.

---

## 2. Pré-condições

Antes de iniciar o Perfil Nutricional, o sistema deve verificar a disponibilidade dos seguintes dados já mantidos pelo AJ Fit:

- sexo;
- data de nascimento / idade;
- altura;
- peso atual mais recente da evolução;
- objetivo atual;
- estado de gestação inicial (`Quiz.pregnancyScreening`), usado apenas como pré-preenchimento de `nutritionProfile/current.pregnant` na primeira criação do Perfil Nutricional.

Se um dado obrigatório estiver ausente ou inválido, o fluxo deve direcionar o usuário para a fonte autoritativa daquele dado.

Não criar campos nutricionais duplicados para resolver ausência de informação do perfil principal.

---

## 3. Elegibilidade inicial

### 3.1 Idade

Menores não têm acesso ao app na regra atual de produto.

Nenhum fluxo nutricional específico para menor deve existir na V1.

### 3.2 Gestação

O estado de gestação é mantido em `nutritionProfile/current.pregnant`, não em `Quiz.pregnancyScreening`.

`Quiz.pregnancyScreening` (snapshot imutável do onboarding) é usado apenas para pré-preencher `nutritionProfile/current.pregnant` na primeira criação do Perfil Nutricional. Depois disso, o valor é editável pela usuária e vive exclusivamente em `nutritionProfile/current`.

Se `nutritionProfile/current.pregnant == true`:

- não iniciar geração automática;
- apresentar estado de inelegibilidade para a V1;
- recomendar acompanhamento profissional.

Essa validação deve ocorrer no backend a cada nova geração, lendo o valor atual — nunca reutilizando `Quiz.pregnancyScreening` como se fosse eterno.

### 3.3 Lactação

Coletar e manter o status de lactação em `nutritionProfile/current.breastfeeding`, como estado atual e editável.

Se `nutritionProfile/current.breastfeeding == true`:

- não permitir geração automática na V1;
- apresentar orientação para acompanhamento profissional.

Nenhum dos dois gates (gravidez, lactação) pode ter bypass.

---

## 4. Sequência recomendada

Fluxo conceitual:

1. validar dados herdados;
2. validar elegibilidade básica;
3. confirmar objetivo herdado de forma visual;
4. definir refeições habituais;
5. definir velocidade de evolução;
6. coletar peso desejado opcional, quando aplicável;
7. definir nível de atividade fora dos treinos;
8. definir padrão alimentar;
9. selecionar alimentos preferidos;
10. selecionar alimentos já consumidos habitualmente;
11. selecionar alimentos excluídos;
12. informar suplementos utilizados;
13. definir preferência de repetição/variedade;
14. revisar perfil;
15. gerar dieta.

A ordem pode ser refinada pela UX, desde que as dependências abaixo sejam respeitadas.

---

## 5. Dependências por pergunta

### 5.0 Objetivo nutricional complementar (`nutritionGoalCategory`)

Dependência (decisão final):

```text
generalGoal in goalCategoryResolution.ambiguousGeneralGoals
-> require nutritionGoalCategory
```

Onde `ambiguousGeneralGoals` é exatamente `["strength", "conditioning", "perf", "return_to_training", "recon"]` (`canonical/nutrition_rules.json` `goals.normalization.ambiguous.values`, duplicado para referência em `canonical/questionnaire.json` `goalCategoryResolution.ambiguousGeneralGoals` — mesma fonte, nunca divergente).

Para os demais objetivos gerais (`gain_muscle`/`hyper`, `lose_fat`/`cut`, `body_composition`/`def`, `health`), a pergunta não é exibida — o mapeamento direto (`goals.normalization.mapping`) já resolve a direção nutricional, e não há necessidade de perguntar de novo.

Não oferecer esta pergunta como opcional/"tanto faz" quando ela for exigida — ver §3.2.1 de `nutrition_questionnaire.md` para o motivo (ausência de direção nutricional inequívoca no objetivo geral).

---

### 5.1 Refeições

Sempre disponível.

Regras:

- mínimo de 2;
- máximo de 6;
- selecionar entre café da manhã, lanche da manhã, almoço, lanche da tarde, jantar e ceia;
- qualquer combinação válida é permitida.

A geração não pode prosseguir com menos de 2 refeições ou mais de 6.

---

### 5.2 Velocidade de evolução

Exibir quando o objetivo exigir ou puder envolver progressão de composição corporal/peso.

Opções:

- gradual;
- moderada;
- acelerada.

A resposta influencia o Nutrition Engine dentro dos limites de segurança definidos por esse módulo.

Ela não concede ao modelo de IA liberdade para decidir déficit, superávit ou ritmo fora dos limites determinísticos.

---

### 5.3 Peso desejado

Exibir apenas quando fizer sentido para o objetivo atual.

O preenchimento é opcional.

A ausência do peso desejado não bloqueia geração.

---

### 5.4 Nível de atividade fora dos treinos

Sempre obrigatório.

Opções:

- predominantemente sedentário;
- pouco ativo;
- ativo;
- muito ativo.

A resposta descreve apenas a rotina fora das sessões de treino e é utilizada pelo Nutrition Engine.

Não perguntar frequência de treino novamente no Perfil Nutricional. O engine deve consumir `prescribedTrainingFrequency` do programa ativo de Treino, com fallback para `Quiz.days` apenas quando não houver programa ativo — nunca `Quiz.frequency`/`Quiz.trainingDays`/`requestedDays`/`scheduleConfig.trainingDays.length` (ver decisão final em `10_integrations/workout_integration.md`).

### 5.5 Padrão alimentar

Sempre obrigatório.

Opções:

- onívoro;
- vegetariano;
- vegano;
- pescetariano.

O padrão alimentar produz filtros rígidos na geração.

---

### 5.6 Alimentos preferidos

Sempre disponível.

O usuário pode:

- selecionar alimentos por catálogo;
- pesquisar alimentos;
- selecionar nenhum e marcar “Tanto faz”.

Nenhum alimento preferido é obrigatório.

---

### 5.7 Alimentos habituais

Sempre opcional.

Somente itens presentes no catálogo devem virar referências estruturadas.

A IA pode priorizá-los, mas a ausência de itens não bloqueia geração.

---

### 5.8 Alimentos excluídos

Sempre disponível.

A seleção pode ficar vazia.

Qualquer item selecionado vira regra rígida.

Não perguntar motivo clínico na V1.

O sistema deve impedir que um item excluído apareça em:

- nova dieta;
- nova opção de refeição;
- substituição de alimento;
- regeneração parcial.

---

### 5.9 Lactação

Mostrar quando aplicável ao perfil da usuária. Não existe fonte autoritativa prévia no AJ Fit para lactação — o valor é coletado e mantido inteiramente em `nutritionProfile/current.breastfeeding`.

Se positivo, encerrar o fluxo de geração com bloqueio de elegibilidade.

---

### 5.10 Suplementos

Pergunta opcional.

A lista pode incluir suplementos comuns definidos pelo produto.

Na V1:

- whey/proteína pode influenciar diretamente alimentos/macros do plano;
- outros suplementos são apenas informação do perfil e não devem ser prescritos automaticamente.

Não solicitar marca ou sabor de whey no onboarding.

---

### 5.11 Repetição vs. variedade

Sempre disponível.

Opções:

- simples e repetível;
- maior variedade;
- tanto faz.

A resposta altera preferência de montagem, nunca metas nutricionais.

---

## 6. Perguntas que não possuem dependências porque estão fora da V1

Não criar lógica condicional para os itens abaixo porque eles não devem existir no questionário V1:

- passos diários;
- horário do treino;
- horários das refeições;
- orçamento;
- preparo/cocção;
- refeições fora de casa;
- fome/apetite;
- água;
- álcool;
- cafeína como hábito;
- bebidas açucaradas;
- texto livre;
- histórico de transtorno alimentar;
- doenças crônicas detalhadas.

---

## 7. Edição posterior e impacto no plano

Editar o Perfil Nutricional não altera automaticamente uma dieta ativa.

O sistema deve avaliar a alteração e, quando necessário, recomendar regeneração.

### 7.1 Alterações que devem gerar recomendação de revisão/regeneração

- objetivo geral do AJ Fit;
- peso atual relevante;
- velocidade de evolução;
- peso desejado;
- número ou tipos de refeições;
- padrão alimentar;
- preferências importantes;
- alimentos habituais;
- exclusões alimentares;
- preferência por repetição/variedade;
- uso/aceitação de whey quando a dieta atual depender dele.

### 7.2 Exclusão adicionada após a geração

Ao adicionar uma nova exclusão:

1. revalidar a dieta atual contra a lista de exclusões;
2. se existir conflito, sinalizar incompatibilidade/revisão necessária;
3. recomendar regeneração ou correção;
4. não alterar silenciosamente o plano.

### 7.3 Mudanças de elegibilidade

Se o perfil passar para uma condição bloqueada na V1, como gestação ou lactação:

- impedir novas gerações automáticas;
- interromper ações que gerem novas prescrições/refeições;
- tratar a dieta existente conforme política de safety a ser definida em `09_safety`.

---

## 8. Migração de versões do questionário

Quando uma versão nova incluir uma pergunta essencial:

- não obrigar todos os usuários imediatamente;
- solicitar a nova resposta apenas quando necessária para uma ação relevante, como regenerar a dieta;
- preservar snapshots antigos sem retroativamente preencher respostas que não existiam naquele momento.

---

## 9. Matriz resumida

| Campo | Origem | Obrigatório | Pode ser “Tanto faz”/vazio | Hard rule | Pode bloquear geração |
|---|---|---:|---:|---:|---:|
| Sexo | AJ Fit | Sim | Não | Não | Indiretamente |
| Idade | AJ Fit | Sim | Não | Não | Sim, conforme elegibilidade geral |
| Peso atual | Evolução AJ Fit | Sim | Não | Não | Sim se ausente |
| Altura | AJ Fit | Sim | Não | Não | Sim se ausente |
| Objetivo | AJ Fit | Sim | Não | Não | Sim se ausente/inválido |
| Objetivo nutricional (`nutritionGoalCategory`) | Nutrição | Somente quando objetivo geral é ambíguo (§5.0) | Não | Não | Sim quando exigida e ausente |
| Gestação | `nutritionProfile/current` (pré-preenchido 1x por `Quiz.pregnancyScreening`) | Quando aplicável | Não | Sim | Sim |
| Lactação | `nutritionProfile/current` | Quando aplicável | Não | Sim | Sim |
| Refeições | Nutrição | Sim | Não | Sim para estrutura | Sim |
| Velocidade | Nutrição | Quando aplicável | Não | Limitada pelo engine | Sim quando requerida |
| Peso desejado | Nutrição | Não | Sim | Não | Não |
| Padrão alimentar | Nutrição | Sim | Não | Sim | Sim |
| Alimentos preferidos | Nutrição | Não | Sim | Não | Não |
| Alimentos habituais | Nutrição | Não | Sim | Não | Não |
| Alimentos excluídos | Nutrição | Não | Sim | Sim | Não por si só |
| Suplementos | Nutrição | Não | Sim | Parcial | Não |
| Repetição/variedade | Nutrição | Não | Sim via “Tanto faz” | Não | Não |

