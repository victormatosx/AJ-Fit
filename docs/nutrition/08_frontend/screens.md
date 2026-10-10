# AJ Fit Nutrition — Telas da V1

## 1. NutritionHome

Tela principal da Nutrição.

Ordem recomendada:

1. calorias e macros do dia;
2. próxima refeição;
3. refeições do dia;
4. resumo semanal;
5. acessos secundários.

Blocos principais:

- calorias consumidas / meta;
- proteína;
- carboidratos;
- gordura;
- fibra;
- próxima refeição;
- lista de refeições;
- progresso semanal.

A Home deve priorizar leitura rápida.

---

## 2. NutritionOnboarding

Nome funcional:

`Perfil nutricional`

Questionário progressivo e curto.

Deve reutilizar dados já existentes do AJ Fit em vez de perguntar novamente.

CTA final:

`Criar minha dieta`

---

## 3. NutritionGenerating

Experiência semelhante ao fluxo já usado para “montando treino”.

Objetivo:

- reduzir sensação de espera;
- deixar claro que o plano está sendo preparado;
- sobreviver a navegação/background.

Exemplos de etapas visuais:

- analisando seu perfil;
- calculando suas metas;
- selecionando alimentos;
- montando suas refeições;
- validando sua dieta.

Essas etapas são UX, não necessariamente correspondência 1:1 com cada chamada backend.

---

## 4. NutritionPlan

Tela do plano recomendado.

Navegação interna:

`Plano | Diário`

Na aba Plano:

- metas do plano;
- refeições;
- opções de cada refeição;
- opção principal destacada;
- troca de refeição;
- histórico/acesso a versões.

---

## 5. MealDetails

Exibe os dois contextos de forma clara:

### Recomendado
- opções da dieta;
- alimento;
- quantidade;
- macros estimados.

### Consumido
- registro real daquela refeição naquele dia.

Usuário pode alternar entre os dois estados.

---

## 6. LogMeal

Registro livre.

Permitir:

- selecionar opção recomendada como ponto de partida;
- registrar alimento diferente;
- alterar quantidade;
- adicionar vários alimentos;
- usar alimento próprio;
- usar receita própria.

Não forçar correspondência com o plano.

---

## 7. FoodSearch

Busca rápida no catálogo.

Deve suportar:

- nome;
- aliases;
- industrializados;
- alimentos próprios.

Resultados devem indicar claramente alimento global vs. próprio quando necessário.

---

## 8. CreateCustomFood

Campos mínimos:

- nome;
- kcal por 100 g;
- proteína;
- carboidratos;
- gordura;
- fibra opcional.

O alimento fica disponível apenas para o próprio usuário.

---

## 9. CreateRecipe

Campos:

- nome;
- descrição;
- ingredientes;
- quantidade de cada ingrediente.

Macros são calculados automaticamente.

---

## 10. WeeklyNutrition

Resumo semanal detalhado.

Mostrar tendências sem transformar a experiência em punição.

Pode incluir:

- calorias médias;
- proteína média;
- carboidratos médios;
- gordura média;
- fibra média;
- refeições registradas;
- comparação com peso/evolução existente.

Implementação da Fase 26:

- semana local de segunda a domingo, com navegação para semanas anteriores;
- médias de consumo calculadas somente sobre documentos de diário existentes;
- dia sem documento aparece como `sem registro`, nunca como zero;
- meta diária resolvida a partir do plano correspondente a cada data;
- refeições que seguiram uma opção recomendada aparecem como contagem descritiva, sem score;
- peso vem exclusivamente de `users/{uid}/assessments`, com gráfico compacto reutilizado da área Evolução;
- detalhes de histórico, fotos e body map continuam na área Evolução.

---

## 11. NutritionHistory

Lista planos anteriores.

Ações:

- visualizar;
- comparar datas;
- restaurar.

---

## 12. NutritionProfile

Editar:

- número/slots de refeições;
- padrão alimentar;
- preferidos;
- habituais;
- excluídos;
- suplementos;
- atividade fora do treino;
- ritmo de progressão;
- variedade.

Mudanças não alteram plano automaticamente.

Quando necessário, mostrar recomendação de gerar novo plano.
