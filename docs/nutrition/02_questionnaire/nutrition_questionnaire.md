# AJ Fit Nutrition — Questionário Nutricional

## 1. Objetivo

Este documento define o questionário nutricional da V1 do AJ Fit.

O questionário existe para coletar apenas as informações necessárias para gerar um plano alimentar personalizado com IA e para estabelecer restrições rígidas que devem ser respeitadas pelo sistema.

A V1 deve priorizar um fluxo curto, progressivo e simples. Perguntas sem impacto direto na geração da dieta não devem ser adicionadas sem nova decisão de produto.

---

## 2. Princípios do questionário

1. Reutilizar dados já existentes no AJ Fit sempre que possível.
2. Não perguntar novamente informações físicas que o produto já conhece.
3. Mostrar apenas perguntas relevantes ao contexto do usuário.
4. Não criar um questionário clínico extenso na V1.
5. Alimentos marcados em “não gosto / não posso consumir” devem ser tratados como regras rígidas de geração. Preferências positivas apenas orientam priorização.
6. A dieta recomendada deve refletir as respostas disponíveis, mas o usuário continua livre para registrar qualquer alimento realmente consumido.
7. O questionário deve ser versionado.
8. Cada dieta gerada deve armazenar um snapshot das respostas utilizadas na geração.
9. O questionário deve existir em PT-BR, inglês e espanhol desde a V1.
10. A implementação deve seguir as convenções já existentes no AJ Fit para valores canônicos, enums, i18n e persistência; este módulo não deve criar uma convenção paralela sem necessidade.

---

## 3. Dados herdados do AJ Fit

Os seguintes dados NÃO devem ser perguntados novamente no questionário nutricional:

- sexo;
- data de nascimento / idade;
- peso;
- altura;
- objetivo.

### 3.1 Fonte do peso

Para nutrição, o peso utilizado deve ser o dado mais recente disponível no sistema de evolução do AJ Fit.

O questionário nutricional não deve manter uma cópia independente de peso apenas para nutrição.

### 3.2 Objetivo

O objetivo nutricional é herdado do objetivo geral do usuário no AJ Fit.

Não existe `nutritionGoal` independente na V1.

Objetivos suportados para a experiência de nutrição:

- perder peso;
- ganhar massa muscular;
- manter peso;
- melhorar composição corporal.

A alteração do objetivo geral do AJ Fit deve refletir no contexto nutricional. A dieta atual, porém, não deve ser alterada silenciosamente; o sistema deve sugerir a criação de uma nova dieta quando apropriado.

#### 3.2.1 Pergunta complementar para objetivos ambíguos (decisão final)

Cinco objetivos gerais do AJ Fit não têm direção nutricional inequívoca, confirmado por auditoria do código real (não por suposição a partir do nome):

- `strength` ("Aumentar minha força");
- `conditioning` ("Melhorar meu condicionamento físico");
- `perf` ("Performance") — o próprio AJ Fit já trata como ambíguo hoje (`LEGACY_PERFORMANCE_GOAL_AMBIGUOUS` em `src/workoutPrescription/input.ts`);
- `return_to_training` ("Voltar a treinar depois de um período parado");
- `recon` ("Recondicionamento") — normalizado para `return_to_training` pelo próprio `LEGACY_GOAL_MAP` do app, não para `body_composition`/`def` apesar do nome parecido.

Nenhum dos cinco pode ser mapeado automaticamente para `weight_loss`/`muscle_gain`/`maintenance`/`body_recomposition` — isso seria uma suposição do produto, não uma derivação do dado real. Nenhum default silencioso (ex. `maintenance`) é aceitável.

**Por que a pergunta existe**: quando o objetivo geral não é suficiente para o Nutrition Engine decidir a estratégia energética (déficit, superávit, manutenção ou recomposição), o Perfil Nutricional pergunta diretamente qual é a direção nutricional desejada.

**Quando aparece**: somente quando o objetivo geral do usuário for um dos cinco valores acima. Para os demais objetivos (`gain_muscle`/`hyper`, `lose_fat`/`cut`, `body_composition`/`def`, `health`), a pergunta não aparece — o mapeamento direto já resolve a direção.

**O que ela NÃO faz**: não substitui nem cria um segundo objetivo geral do AJ Fit. `nutritionGoalCategory` é um campo só do Perfil Nutricional, usado exclusivamente para resolver a direção energética quando o objetivo geral não a define. O objetivo geral do usuário continua sendo lido normalmente de onde já é lido hoje.

**Copy final aprovada:**

- Título: **"Qual é o seu principal objetivo com a alimentação?"**
- Subtítulo: **"Isso complementa seu objetivo de treino e define a direção da sua dieta."**
- Opções:
  - "Ganhar massa muscular" → `muscle_gain`
  - "Perder gordura" → `weight_loss`
  - "Manter meu peso" → `maintenance`
  - "Melhorar minha composição corporal" → `body_recomposition`

Contrato machine-readable em `canonical/questionnaire.json` (pergunta `nutritionGoalCategory`); lista dos cinco objetivos ambíguos em `canonical/nutrition_rules.json` `goals.normalization.ambiguous.values`.

### 3.3 Gestação

`Quiz.pregnancyScreening` é um snapshot imutável do onboarding e não pode ser tratado como autoridade eterna. Ele serve apenas para **pré-preencher** `nutritionProfile/current.pregnant` na primeira vez que o Perfil Nutricional é criado.

A partir daí, o estado de gestação passa a ser mantido e editado exclusivamente em `nutritionProfile/current`, como estado atual do Perfil Nutricional — não como dado herdado continuamente de `Quiz`.

Usuárias gestantes não são elegíveis para geração automática de dieta na V1. O backend deve validar `nutritionProfile/current.pregnant` a cada nova geração, nunca reler `Quiz.pregnancyScreening`.

### 3.4 Idade

Menores de idade não têm acesso ao app segundo a regra atual de produto, portanto não haverá fluxo nutricional específico para menores na V1.

---

## 4. Estrutura do onboarding nutricional

Nome recomendado da experiência:

**Perfil nutricional**

O fluxo deve ser curto e progressivo.

O CTA final em PT-BR será:

**Criar minha dieta**

O equivalente deve ser localizado para inglês e espanhol.

Não é necessária uma explicação textual do motivo de cada pergunta na V1.

Antes da geração, deve existir uma etapa final de revisão das informações coletadas.

---

## 5. Perguntas da V1

### 5.1 Quantidade de refeições por dia

Pergunta obrigatória.

Faixa suportada:

- mínimo: 2 refeições;
- máximo: 6 refeições.

O usuário não informa apenas um número abstrato. Ele seleciona quais refeições realiza normalmente.

Refeições disponíveis na V1:

- café da manhã;
- lanche da manhã;
- almoço;
- lanche da tarde;
- jantar;
- ceia.

O usuário pode selecionar qualquer combinação válida entre 2 e 6 refeições.

A IA deve montar o plano alimentar respeitando exatamente a estrutura de refeições selecionada.

Não são coletados horários das refeições na V1.

---

### 5.2 Velocidade de evolução

Pergunta obrigatória quando o objetivo envolver mudança corporal compatível com progressão de peso/composição.

Opções da V1:

- gradual;
- moderada;
- acelerada.

Esses valores representam intenção/preferência do usuário. Eles não autorizam o sistema a ultrapassar limites definidos posteriormente pelo Nutrition Engine ou pelos Safety Gates.

A escolha do usuário nunca deve substituir regras determinísticas de segurança.

---

### 5.3 Peso desejado

O usuário pode informar um peso-alvo.

O peso-alvo NÃO é obrigatório para gerar uma dieta.

O valor deve ser tratado como preferência/meta de produto e não como autorização para estratégias nutricionais agressivas.

---

### 5.4 Nível de atividade fora dos treinos

Pergunta obrigatória.

Objetivo: estimar o nível de movimento e atividade cotidiana fora das sessões de treino do AJ Fit.

Opções da V1:

- predominantemente sedentário;
- pouco ativo;
- ativo;
- muito ativo.

A pergunta deve usar linguagem simples e exemplos de rotina diária, trabalho e deslocamento.

A resposta é input do Nutrition Engine e não deve ser interpretada livremente pela IA.

A frequência de treino não deve ser perguntada novamente no Perfil Nutricional. O Nutrition Engine deve consumir `prescribedTrainingFrequency` do programa ativo de Treino, com fallback para `Quiz.days` quando não houver programa ativo — nunca `Quiz.frequency`/`Quiz.trainingDays`/`requestedDays` (ver decisão final em `10_integrations/workout_integration.md`).

### 5.5 Alimentos que gosta

Pergunta disponível no onboarding.

O usuário pode pesquisar alimentos e selecionar quantos quiser.

A busca deve permitir:

- descoberta por catálogo/lista;
- pesquisa textual.

Não existe quantidade mínima obrigatória.

O usuário pode escolher **Tanto faz** e não selecionar nenhum alimento.

Os alimentos marcados como preferidos devem aumentar a prioridade de uso na geração, mas não precisam obrigatoriamente aparecer em todas as dietas.

---

### 5.6 Alimentos que já costuma consumir

O usuário pode selecionar alimentos que fazem parte do seu dia a dia.

A seleção deve utilizar o mesmo catálogo de alimentos do produto.

Esses alimentos devem ser tratados como preferência positiva: a IA deve priorizá-los quando forem compatíveis com as metas, a estrutura da refeição e as demais regras.

Eles não são obrigatórios no plano gerado.

---

### 5.7 Alimentos que não gosta / não pode consumir

A experiência pode apresentar ao usuário uma área unificada de alimentos a excluir.

Na V1, qualquer alimento colocado nessa lista deve ser tratado como **restrição rígida**.

Ou seja:

- o gerador não pode usar o alimento;
- o substituidor não pode sugerir o alimento;
- uma nova dieta não pode conter o alimento;
- validações posteriores devem rejeitar um plano que contenha o alimento.

Não é necessário perguntar ao usuário se o motivo é alergia, intolerância ou simples preferência.

Na V1, todos os motivos produzem o mesmo comportamento operacional: **hard exclusion**.

O usuário pode selecionar quantos alimentos quiser.

A experiência de busca deve permitir lista/catálogo e pesquisa textual.

---

### 5.8 Padrão alimentar

Pergunta obrigatória.

Opções suportadas:

- onívoro;
- vegetariano;
- vegano;
- pescetariano.

A resposta funciona como restrição estrutural rígida na geração.

A combinação final de alimentos deve respeitar tanto o padrão alimentar quanto a lista individual de exclusões.

---

### 5.9 Intolerâncias e restrições alimentares comuns

O questionário deve permitir selecionar as restrições/intolerâncias alimentares mais comuns e relevantes para a V1.

A lista exata deve ser definida junto ao catálogo de alimentos e às regras de classificação de ingredientes.

Na experiência do usuário, essas informações podem ser absorvidas pelo fluxo de **não gosto / não posso consumir**, desde que o resultado final seja uma exclusão rígida e corretamente mapeada para alimentos/ingredientes incompatíveis.

A V1 não precisa coletar diagnóstico ou motivo clínico detalhado.

---

### 5.10 Condições médicas

A V1 NÃO terá um questionário abrangente de doenças ou condições clínicas.

Não perguntar na V1 sobre:

- diabetes;
- doença renal;
- doença hepática;
- condições gastrointestinais;
- outras doenças que exijam dieta terapêutica específica.

Esses fluxos poderão ser adicionados posteriormente após definição própria de elegibilidade e safety.

A ausência dessas perguntas não autoriza a IA a produzir dietas terapêuticas para condições médicas.

---

### 5.10 Gestação e lactação

#### Gestação

- pré-preencher a pergunta de gestação com `Quiz.pregnancyScreening` apenas na criação inicial do Perfil Nutricional (snapshot imutável, usado uma única vez como ponto de partida);
- a partir da criação, o estado de gestação vive e é editável em `nutritionProfile/current.pregnant`;
- bloquear geração automática na V1 com base no valor atual em `nutritionProfile/current`.

#### Lactação / amamentação

O perfil nutricional deve coletar se a usuária está amamentando.

O estado de lactação vive em `nutritionProfile/current.breastfeeding`, como estado atual e editável — não existe fonte prévia confiável no restante do AJ Fit para esse dado.

Usuárias em lactação não são elegíveis para geração automática de dieta na V1.

Quando houver bloqueio, o produto deve orientar acompanhamento profissional adequado.

Ambos os gates (gravidez e lactação) são revalidados a partir de `nutritionProfile/current` a cada nova geração, e nenhum dos dois pode ter bypass.

---

### 5.11 Suplementos

O questionário deve permitir informar suplementos utilizados.

Lista inicial sugerida:

- whey/proteína em pó;
- creatina;
- cafeína / pré-treino;
- multivitamínico;
- ômega-3;
- outros suplementos comuns definidos no catálogo do produto.

Na V1, **whey/proteína em pó** é o único suplemento que pode participar diretamente da composição energética/macronutricional do plano alimentar.

Para whey, o questionário precisa saber apenas se o usuário utiliza ou aceita utilizar whey na dieta.

Não é necessário coletar marca ou sabor no onboarding.

Outros suplementos podem ser armazenados como informação de perfil, mas não devem ser automaticamente prescritos pela IA na dieta da V1.

---

### 5.12 Preferência por repetição ou variedade

Pergunta disponível na V1.

Opções:

- prefiro refeições simples e repetíveis;
- prefiro maior variedade;
- tanto faz.

Essa resposta influencia a composição do plano e a quantidade de repetição de refeições/alimentos entre dias, sem alterar metas nutricionais.

---

## 6. Perguntas deliberadamente fora da V1

Não adicionar ao questionário nutricional da V1 sem nova decisão de produto:

- horários das refeições;
- horário do treino;
- passos diários;
- nível de atividade fora do treino;
- profissão ou rotina ocupacional;
- orçamento alimentar;
- tempo disponível para cozinhar;
- frequência de refeições fora de casa;
- uso de marmita;
- preferência por refeições grandes vs. distribuídas;
- fome por período do dia;
- compulsão, beliscos ou fome noturna;
- consumo de água;
- consumo de álcool;
- consumo de cafeína como hábito alimentar;
- bebidas açucaradas;
- texto livre final;
- histórico de transtorno alimentar na experiência V1;
- receitas;
- lista de compras.

A ausência desses campos é intencional para manter o onboarding curto.

---

## 7. Obrigatoriedade

### 7.1 Dados obrigatórios herdados

Para gerar uma dieta, o sistema precisa possuir:

- sexo;
- idade/data de nascimento;
- peso atual válido;
- altura;
- objetivo geral válido.

Caso algum dado herdado necessário esteja ausente, o usuário deve ser direcionado para corrigir/completar o perfil apropriado, em vez de criar uma cópia paralela dentro de nutrição.

### 7.2 Respostas obrigatórias do perfil nutricional

Obrigatórias:

- padrão alimentar;
- estrutura/quantidade de refeições (2 a 6);
- velocidade de evolução quando aplicável ao objetivo;
- `nutritionGoalCategory`, **somente quando** o objetivo geral for um dos cinco ambíguos (`strength`, `conditioning`, `perf`, `return_to_training`, `recon`) — ver §3.2.1;
- confirmação/revisão final do perfil.

Alimentos preferidos podem ficar vazios através de **Tanto faz**.

Alimentos excluídos podem ficar vazios quando o usuário não possuir exclusões.

Peso desejado é opcional.

Suplementos são opcionais.

Alimentos que já consome são opcionais.

Preferência por repetição/variedade pode aceitar **Tanto faz**.

---

## 8. Lógica progressiva

O questionário deve utilizar dependências para não mostrar perguntas desnecessárias.

Exemplos:

- só exibir peso desejado quando fizer sentido para o objetivo;
- só exibir detalhes de lactação quando aplicável;
- permitir encerrar seleção de alimentos preferidos com “Tanto faz”;
- só apresentar opções relacionadas a whey caso o módulo de suplementos esteja ativo naquela etapa;
- ocultar perguntas que não se aplicam ao perfil atual.

---

## 9. Revisão final

Antes de gerar a dieta, mostrar uma tela de revisão contendo no mínimo:

- objetivo herdado;
- peso atual utilizado;
- peso desejado, se informado;
- velocidade de evolução;
- refeições selecionadas;
- padrão alimentar;
- principais alimentos preferidos;
- alimentos excluídos;
- alimentos habituais;
- uso de whey, quando aplicável;
- preferência entre repetição e variedade.

A revisão é informativa e deve permitir retornar às etapas relevantes para edição.

---

## 10. Edição posterior

O Perfil Nutricional é preenchido inicialmente uma vez e depois pode ser editado por campo.

Não é necessário obrigar o usuário a refazer todo o questionário para alterar uma preferência.

Alterações no perfil NÃO devem modificar silenciosamente a dieta atual.

### 10.1 Mudanças comuns

Quando uma mudança puder tornar a dieta atual menos adequada, o app deve sugerir regeneração do plano.

Exemplos:

- objetivo geral alterado;
- quantidade/estrutura de refeições alterada;
- padrão alimentar alterado;
- preferências relevantes alteradas;
- velocidade de evolução alterada;
- peso atual mudou de forma relevante.

### 10.2 Nova exclusão alimentar

Quando o usuário adicionar um alimento à lista de “não gosto / não posso consumir”:

1. revisar a dieta atual;
2. detectar se o plano contém o alimento ou um item incompatível;
3. alertar que a dieta precisa ser revista;
4. recomendar regeneração/correção.

Não regenerar silenciosamente sem ação do usuário.

---

## 11. Versionamento

O questionário deve possuir versão explícita.

Exemplo conceitual:

`nutritionQuestionnaireVersion: 1`

Quando novas perguntas essenciais forem introduzidas, usuários antigos só devem ser solicitados a respondê-las quando realmente necessário para continuar usando ou regenerar a funcionalidade.

---

## 12. Snapshot por geração

Toda dieta gerada deve armazenar um snapshot imutável dos dados utilizados naquela geração.

O snapshot deve conter no mínimo:

- versão do questionário;
- dados físicos relevantes utilizados;
- objetivo herdado;
- respostas nutricionais;
- restrições;
- preferências;
- estrutura de refeições;
- timestamp/referência temporal apropriada.

Alterações futuras no perfil atual não devem alterar retrospectivamente o contexto histórico de uma dieta já gerada.

