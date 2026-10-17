# AJ Fit Nutrition — Regras de Segurança Nutricional

Implementação de geração (2026-10-16, ajuste solicitado pelo produto): não há confirmação ou bloqueios de gravidez/amamentação na interface, callable, worker ou engine. Os campos históricos permanecem apenas para compatibilidade de armazenamento, sem envio à IA ou uso pelo treino.

A IA compõe alimentos livres, com ingredientes/origens obrigatórios na resposta (schema 3.1.0). O backend valida alergênicos, padrões alimentares, exclusões por nome/ingredientes e macros, tanto para plano quanto alternativas. Composição desconhecida é rejeitada para padrões restritivos; exclusões de catálogo sem nome resolvido bloqueiam antes da chamada. Restrições vencem preferências/suplementos. Mudança de perfil durante a chamada impede persistir o resultado.

Limite técnico: a composição e os alergênicos continuam declarados pela IA. A verificação por nomes cobre ingredientes comuns e não equivale à certificação independente de cada receita/produto. Nenhuma garantia absoluta de ausência de ingredientes ocultos é possível com geração livre; não usar esse mecanismo como validação clínica ou de rotulagem.

## 1. Princípio

Segurança nutricional é responsabilidade determinística do backend.

A IA nunca pode:

- relaxar safety gates;
- aceitar calorias abaixo do mínimo;
- aumentar agressividade além dos limites;
- ignorar exclusões;
- ignorar alergênicos;
- ignorar validações do perfil e contexto físico.

Em conflito entre IA e regra determinística:

**a regra determinística vence sempre**.

---

## 2. Elegibilidade

Gestação e amamentação não são coletadas e não bloqueiam geração, regeneração ou alternativas. Valores históricos positivos são preservados sem efeito na elegibilidade. Não existe confirmação de ausência dessas condições na revisão.

---

## 3. Limites do Nutrition Engine

O engine impõe (valores fechados em `canonical/nutrition_rules.json`, implementados em `src/nutrition/engine/`):

- calorias mínimas por sexo — 1500 kcal (masculino) / 1200 kcal (feminino), guardrail de produto, não prescrição clínica;
- limites máximos de déficit/superávit — 20%/15% do TDEE no ritmo `accelerated` (ver `03_nutrition_engine/energy_calculation.md` §7);
- intervalos de proteína por `NutritionGoalCategory`;
- mínimo de gordura — 0.8 g/kg;
- tolerâncias de macros — `canonical/nutrition_rules.json` `tolerances`;
- regra de fibra — 14 g/1000 kcal.

Mesmo o ritmo `accelerated` permanece dentro desses limites. O clamp de calorias é aplicado **depois** do ajuste de objetivo (déficit/superávit/manutenção/recomposição), nunca antes — a IA nunca pode contornar o clamp.

---

## 4. Pedido extremo do usuário

A interface não oferece campo livre para solicitar dieta extrema.

Se, no futuro, qualquer input tentar exigir valor fora das regras:

- ignorar a instrução incompatível;
- aplicar limite seguro;
- informar que a meta foi limitada quando relevante.

---

## 5. Exclusões

Todo alimento em:

`excludedFoodIds`

é hard exclusion.

A regra se aplica a:

- geração inicial;
- nova opção de refeição;
- restauração/revalidação futura;
- seleção de candidatos pela IA.

---

## 6. Alergênicos

Alergênicos do catálogo são uma camada adicional.

Se o sistema souber que um produto contém ingrediente/alergênico incompatível, ele deve ser bloqueado mesmo que seu `foodId` específico não esteja na lista de exclusões.

---

## 7. Produtos compostos/industrializados

Quando metadados disponíveis indicarem ingrediente/alergênico incompatível:

- excluir o produto dos candidatos;
- rejeitar saída da IA que o contenha.

Se os metadados forem insuficientes, não inventar composição.

---

## 8. Validação pós-IA

Toda saída passa por:

1. schema validation;
2. food ID validation;
3. exclusion validation;
4. dietary-pattern validation;
5. allergen validation;
6. nutrition target validation;
7. safety validation.

Só então pode ser persistida.

---

## 9. Falha

Se nenhuma combinação válida puder ser gerada:

- falhar de forma explícita;
- não flexibilizar segurança para concluir a operação.

---

## 10. Threat review final (Fases 27–30)

- Callables usam exclusivamente `request.auth.uid`, App Check, conta ativa e
  rollout aplicável. Restore revalida rollout e deletion lock na transação.
- Planos, jobs, alternativas, AI operations, rate limits, catálogo global,
  metadata e rollout são backend-only para writes.
- Diário exige data civil válida e timezone não vazio, com até 6 meals e 6
  items por meal. Receitas aceitam até 6 ingredientes; listas e favoritos têm
  bounds; IDs de recipe/custom food têm até 120 caracteres; brand/productName
  têm até 200.
- Favorito `plan` exige somente `planId`; `alternative` exige somente
  `alternativeId`, impedindo referências ambíguas.
- Alternativa deriva target, plano, meal e candidates no servidor. UUID de
  request serve só para idempotência; ownership e plano ativo são revalidados
  no commit.
- Contexto da IA é JSON estruturado e strings são declaradas como dados não
  confiáveis. Structured Output, candidate IDs e validator continuam sendo a
  autoridade.
- Logs, analytics e AI operations não guardam secret, prompt, output bruto,
  diário, alergias, peso ou PII nutricional desnecessário.
