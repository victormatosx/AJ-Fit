# Nutrition Engine — Professional Review Checklist

Status global: **NOT REVIEWED**. Nenhum item deste documento foi validado por
um nutricionista qualificado registrado no sistema CFN/CRN. "Status" abaixo
nunca deve ser lido como aprovação — é só o estado documental/de implementação.

## Como ler este documento

Para cada regra:

- **Rule**: o que o engine faz hoje.
- **Current value**: valor exato implementado.
- **Source/rationale**: citação já registrada em `canonical/nutrition_rules.json`
  (literatura, guideline, ou "engineering judgment" quando é assim que o
  próprio arquivo canônico classifica).
- **Professional decision required**: a pergunta específica que um
  nutricionista precisa responder.
- **Status**: `NOT REVIEWED` para todos os itens, até que uma revisão real
  aconteça e seja registrada aqui com nome/CRN/data.

Nenhum item abaixo foi corrigido por este agente com base em preferência
própria. Onde o agente encontrou um bug objetivo (regra documentada ≠ regra
implementada), isso é tratado separadamente na seção "Bugs técnicos
encontrados" do relatório da Fase 32 — não neste checklist.

---

## 1. RMR (taxa metabólica basal)

| Campo | Conteúdo |
|---|---|
| Rule | Mifflin-St Jeor |
| Current value | male: `10×kg + 6.25×cm − 5×idade + 5`; female: `10×kg + 6.25×cm − 5×idade − 161` |
| Source/rationale | Mifflin MD, St Jeor ST, et al. *Am J Clin Nutr.* 1990;51(2):241-247 — fórmula padrão amplamente usada |
| Professional decision required | Confirmar que Mifflin-St Jeor é apropriada para a população-alvo do AJ Fit (adultos 18-100, sem triagem clínica); avaliar se faltam fórmulas alternativas para subgrupos (ex. atletas de alto rendimento, obesidade severa) |
| Status | NOT REVIEWED |

## 2. Fatores de atividade não-treino

| Campo | Conteúdo |
|---|---|
| Rule | Multiplicador de RMR por nível de atividade fora do treino |
| Current value | sedentary 1.2, low_active 1.3, active 1.4, very_active 1.5 |
| Source/rationale | Adaptado da escala PAL convencional (Harris-Benedict/FAO-WHO-UNU: 1.2/1.375/1.55/1.725), deliberadamente reduzido para não contar exercício estruturado duas vezes (já que o treino é somado separadamente). Canonical classifica isso como "engineering judgment calibrated to avoid double counting, not itself a single published number" |
| Professional decision required | Validar se os valores reduzidos (1.3/1.4/1.5 em vez de 1.375/1.55/1.725) refletem corretamente apenas a atividade não-estruturada, ou se introduzem subestimação/sobrestimação sistemática do TDEE |
| Status | NOT REVIEWED |

## 3. Assunção de exercício (MET)

| Campo | Conteúdo |
|---|---|
| Rule | kcal/sessão de treino = MET × 3.5 × peso(kg) / 200 × minutos |
| Current value | MET = 5.0, 50 min/sessão, frequência semanal real do usuário / 7 |
| Source/rationale | Equação ACSM padrão (METs→kcal/min); MET 5.0 = ponto médio de treino de força no Compendium of Physical Activities (Ainsworth et al. 2011, que lista 3.5 MET moderado / 6.0 MET vigoroso); 50 min é "V1 flat assumption", não medição real |
| Professional decision required | Avaliar se um MET fixo de 5.0 e duração fixa de 50 min é aceitável como estimativa populacional, ou se a variabilidade real (treino de força vs. cardio, iniciante vs. avançado) exige uma faixa em vez de valor único |
| Status | NOT REVIEWED |

## 4. Déficit calórico (perda de peso)

| Campo | Conteúdo |
|---|---|
| Rule | % do TDEE subtraído por ritmo |
| Current value | gradual 10%, moderate 15%, accelerated 20% |
| Source/rationale | Garthe et al. 2011 (*Int J Sport Nutr Exerc Metab*); Helms, Aragon, Fitschen 2014 (*J Int Soc Sports Nutr*) — déficit de 20-25% é o limite superior comumente citado para preservar massa magra em atletas |
| Professional decision required | Confirmar que 20% de déficit ("accelerated") é seguro para um usuário generalista não supervisionado (a literatura citada é de atletas, não da população geral do app) |
| Status | NOT REVIEWED |

## 5. Superávit calórico (ganho de massa)

| Campo | Conteúdo |
|---|---|
| Rule | % do TDEE somado por ritmo |
| Current value | gradual 5%, moderate 10%, accelerated 15% |
| Source/rationale | Aragon & Schoenfeld 2013; consenso de "lean bulk" (~200-350 kcal/dia) |
| Professional decision required | Confirmar se 15% de superávit ("accelerated") em TDEEs altos (ex. atleta com TDEE 3500+ kcal) ainda está dentro do range seguro, já que 15% de um TDEE alto pode exceder 350 kcal/dia |
| Status | NOT REVIEWED |

## 6. Recomposição corporal

| Campo | Conteúdo |
|---|---|
| Rule | Déficit fixo, não escalado por ritmo |
| Current value | 10% de déficit, `paceAffectsMagnitude: false` |
| Source/rationale | Longland et al. 2016 (*Am J Clin Nutr*); Barakat et al. 2020 (*Strength Cond J*) — déficit pequeno (~200-500 kcal/dia) com alta proteína preserva massa magra melhor que déficit grande |
| Professional decision required | Confirmar que ignorar `progressionPace` para esta categoria (sempre 10%, mesmo se o usuário escolher "accelerated") é a decisão correta e que a UI comunica isso claramente ao usuário |
| Status | NOT REVIEWED |

## 7. Calorie floors (piso de segurança)

| Campo | Conteúdo |
|---|---|
| Rule | Piso mínimo de kcal/dia, independente de déficit calculado |
| Current value | male: 1500 kcal; female: 1200 kcal |
| Source/rationale | Guardrail populacional amplamente publicado (ex. Mayo Clinic, NHS) contra dietas muito baixas em calorias sem supervisão médica — não é uma citação de RCT única, é um piso de segurança geral |
| Professional decision required | **Item explicitamente marcado no próprio canonical como exigindo revisão profissional antes de qualquer claim de produção.** Confirmar se 1500/1200 kcal é apropriado para TODOS os perfis dentro dos bounds aceitos (incluindo usuários de peso/altura extremos dentro do range permitido) ou se o piso deveria variar por peso/altura/idade |
| Status | NOT REVIEWED — **P0 para qualquer claim de segurança em produção** |

## 8. Comportamento do clamp do piso calórico

| Campo | Conteúdo |
|---|---|
| Rule | O que acontece quando o déficit calculado cairia abaixo do piso |
| Current value | Engine recalcula com o valor do piso como kcal alvo (ver `functions/src/nutrition/shared/nutrition/engine` — a implementação clampa e sinaliza, não bloqueia silenciosamente) |
| Source/rationale | `canonical/nutrition_rules.json` `safety.acceleratedPaceStillSubjectToSafetyLimits: true` |
| Professional decision required | Confirmar que o comportamento correto quando o clamp ativa é gerar no piso (e não bloquear a geração inteira) — e se a UI deveria comunicar explicitamente ao usuário que o déficit solicitado não pôde ser aplicado integralmente |
| Status | NOT REVIEWED |

## 9. Proteína (g/kg de peso atual)

| Campo | Conteúdo |
|---|---|
| Rule | Faixa min/target/max por categoria de objetivo |
| Current value | weight_loss: 1.8/2.0/2.4; muscle_gain: 1.6/1.8/2.2; maintenance: 1.2/1.6/2.0; body_recomposition: 1.8/2.0/2.4 |
| Source/rationale | ISSN Position Stand (Jäger et al. 2017, *J Int Soc Sports Nutr*) |
| Professional decision required | Avaliar extremos de peso (ex. 150kg → 2.4 g/kg = 360g proteína/dia) para plausibilidade prática e ausência de triagem renal (o questionário V1 não pergunta sobre função renal) |
| Status | NOT REVIEWED |

## 10. Gordura

| Campo | Conteúdo |
|---|---|
| Rule | Piso g/kg + target/max % de calorias |
| Current value | piso 0.8 g/kg; target 25% kcal; max 35% kcal |
| Source/rationale | Literatura hormonal (piso); IOM AMDR 20-35% (target/max) |
| Professional decision required | Confirmar a ordem de prioridade (piso g/kg nunca é reduzido para liberar calorias para carboidrato) é a escolha correta |
| Status | NOT REVIEWED |

## 11. Fibra

| Campo | Conteúdo |
|---|---|
| Rule | g por 1000 kcal |
| Current value | 14 g / 1000 kcal |
| Source/rationale | IOM DRI 2002/2005 (AI), equivalente a ~25g/dia mulheres e ~38g/dia homens em ingestões típicas |
| Professional decision required | Confirmar que a conversão para "por 1000 kcal" (em vez de valor absoluto por sexo) não gera fibra insuficiente em dietas de baixa caloria (ex. no piso de 1200 kcal, a meta seria 16.8g — abaixo da AI absoluta de 25g/dia) |
| Status | NOT REVIEWED |

## 12. Distribuição de refeições

| Campo | Conteúdo |
|---|---|
| Rule | Peso por categoria de refeição (main vs. snack) |
| Current value | energyWeight: main 1.5 / snack 1.0; proteinWeight: main 1.2 / snack 1.0 |
| Source/rationale | **Não é derivado de literatura** — o próprio canonical diz "Not literature-derived... an explicit, documented product/engineering choice" |
| Professional decision required | Validar se a distribuição é nutricionalmente razoável (ex. não deixa nenhuma refeição com target implausível em planos de 2 refeições) |
| Status | NOT REVIEWED |

## 13. Tolerâncias do validator

| Campo | Conteúdo |
|---|---|
| Rule | Margem de erro aceita entre target e output da IA |
| Current value | calorias 5%; proteína/carbo/gordura 10%; fibra 20% |
| Source/rationale | **Não é derivado de literatura** — convenção operacional, citada no canonical como "to be revisited once the AI validation pipeline... produces real acceptance-rate data" |
| Professional decision required | Confirmar se as margens são clinicamente aceitáveis, especialmente a de calorias (5% de um piso de 1200 kcal = 60 kcal de margem) |
| Status | NOT REVIEWED |

## 14. Correção de gramas (correction pipeline)

| Campo | Conteúdo |
|---|---|
| Rule | Limites de ajuste automático de gramas antes de rejeitar o output da IA |
| Current value | Ver `functions/src/nutrition/ai/correction.ts` / `06_ai/validation_pipeline.md` |
| Source/rationale | Não revisado neste documento em detalhe — ver código para os limites exatos |
| Professional decision required | Confirmar que a correção determinística de gramas nunca desloca macros fora das faixas de segurança (itens 7, 9, 10) |
| Status | NOT REVIEWED |

## 15. Populações excluídas

| Campo | Conteúdo |
|---|---|
| Rule | Quem é bloqueado da geração automática |
| Current value | Gravidez e amamentação (campo atual, revalidado em toda geração); idade 18-100 (ver achado de código na Fase 32 abaixo) |
| Source/rationale | Decisão de produto documentada em `09_safety/nutrition_safety_rules.md` e `03_nutrition_engine/eligibility_and_gates.md` |
| Professional decision required | **Decisão central deste gate**: confirmar se gravidez/amamentação/idade são as ÚNICAS exclusões necessárias para lançar a V1, ou se diabetes, doença renal, doença hepática, transtornos alimentares, uso de medicamentos, pós-cirúrgico e atletas de alto rendimento também deveriam ser bloqueados (ou pelo menos receber disclosure adicional) antes do beta — ver seção "Populações não cobertas" do relatório principal |
| Status | NOT REVIEWED — **item mais importante deste checklist** |

## 16. Modelo de alérgenos

| Campo | Conteúdo |
|---|---|
| Rule | Fail-closed: alimento com `allergens === null` nunca entra no subset de geração |
| Current value | Implementado (ver seção "Allergens / dietary safety" do relatório principal para evidência de código) |
| Source/rationale | Decisão de produto, não literatura |
| Professional decision required | Confirmar que o modelo de alérgenos estruturados (lista fixa: milk/egg/peanut/tree_nuts/soy/wheat/fish/shellfish/other) cobre os alérgenos clinicamente relevantes para a população brasileira, e que "outros" não é insuficiente para casos graves |
| Status | NOT REVIEWED |

## 17. Copy/claims do produto

| Campo | Conteúdo |
|---|---|
| Rule | Linguagem permitida vs. proibida nas telas de Nutrição |
| Current value | Ver seção "Claims/copy" do relatório principal — nenhuma claim de alto risco encontrada no copy já shipado; disclaimer parcialmente implementado (`plan.disclaimer` só aparece em `NutritionPlanScreen`, não nos 3 pontos que `09_safety/disclaimers_and_legal.md` pede) |
| Source/rationale | `09_safety/disclaimers_and_legal.md` (política interna, não é opinião jurídica) |
| Professional decision required | Nutricionista + jurídico devem validar juntos o texto final do disclaimer antes do beta público |
| Status | NOT REVIEWED |

## 18. Edge cases / extremos

| Campo | Conteúdo |
|---|---|
| Rule | Plausibilidade de output em combinações extremas válidas (peso/altura/idade mínimos e máximos, 2 vs. 6 refeições, sedentário+perda vs. muito ativo+ganho) |
| Current value | Não há um teste dedicado de plausibilidade matemática em todos os extremos — testes existentes cobrem corretude de fórmula, não "isso faz sentido nutricionalmente" |
| Source/rationale | N/A |
| Professional decision required | Rodar os perfis extremos listados na seção "Safety técnico" do relatório principal e avaliar se o output é nutricionalmente plausível, não só matematicamente consistente |
| Status | NOT REVIEWED |

---

## Resumo

Nenhum item acima está `APPROVED`. Todos os 18 itens requerem revisão por
nutricionista qualificado (idealmente com registro CRN ativo) antes de:

- qualquer claim público de "seguro" ou "validado por nutricionista";
- rollout além de um beta interno controlado e devidamente avisado.

Isso NÃO significa que os valores estão errados — o canonical já cita
literatura relevante para a maioria deles. Significa que **citação de
literatura pela equipe de engenharia não é equivalente a validação
profissional para este produto e esta população**, e nenhuma dessas duas
coisas deve ser confundida ao comunicar o status do projeto internamente ou
externamente.
