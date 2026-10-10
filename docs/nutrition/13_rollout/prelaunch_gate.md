# Nutrition — Prelaunch Release Gate (Fase 32, atualizado na Fase 33)

Data da avaliação original: 2026-10-08 (Fase 32). Atualizado em 2026-10-08
(Fase 33, segunda rodada — catálogo real TACO importado e curado em
`ajfit-2f321`, rollout 100%, Rules/indexes deployados; bloqueado em
Functions pela ausência do secret OPENAI_API_KEY). Esta é uma auditoria de
release gate, não uma aprovação de rollout público. `ajfit-2f321` foi
usado nesta rodada como ambiente de teste explicitamente autorizado (sem
usuários públicos reais) — isso não é, e não substitui, uma aprovação de
rollout em produção pública. Nenhuma aprovação jurídica/profissional foi
presumida.

Estados possíveis por categoria: `PASS`, `CONDITIONAL`, `BLOCKED`,
`NOT REVIEWED`.

| Categoria | Status | Resumo |
|---|---|---|
| Technical | **PASS** | Safety gates (gravidez/amamentação/idade/alérgenos/dietary pattern) implementados e revalidados ponta a ponta; feature flags fail-safe; sem auto-adjust; validator bloqueia persistência de plano inválido; rate limits presentes |
| Nutrition professional | **NOT REVIEWED** | Nenhum valor do Engine (RMR, TDEE, déficit/superávit, calorie floors, macros, tolerâncias) foi validado por nutricionista qualificado. Ver `09_safety/professional_review_checklist.md` |
| Privacy/LGPD | **CONDITIONAL** | Minimização de dados enviados à IA é real e forte; mas não há política de retenção documentada, e Terms/Privacy reais não existem no app (placeholder) |
| Legal/claims | **BLOCKED** (para rollout além de beta interno fechado) | Risco real e documentado de enquadramento como exercício ilegal da profissão de nutricionista (Lei 8.234/1991), já usado pelo Sistema CFN/CRN contra produto similar. Ver `09_safety/legal_prelaunch_checklist.md` |
| Operations | **PASS** (ambiente de teste) | Catálogo real IMPORTADO em `ajfit-2f321` (519 alimentos, 58 `approved`). Rollout 100%, Rules, indexes e as 7 Functions de Nutrição deployadas. Secret configurado. O full-plan real pós-fix completou na primeira tentativa, passou pelo validator e persistiu exatamente um plano ativo. |
| Catalog | **PASS** (dentro do que foi curado) | 58 alimentos reais aprovados com curadoria alimento-a-alimento documentada (`scripts/nutrition/sources/taco-v1-enrichment.json`), incluindo um `protein_source` TACO com fibra medida; coverage estrutural e preflight de densidade proteica confirmados para o caso onívoro testado. |
| AI | **PASS** (dentro do escopo técnico) | Pipeline provider→schema→validator→correção→retry→fallback é real; nenhum caminho persiste output não validado; payload à OpenAI é minimizado (`store:false`, sem uid/email/nome/peso bruto) |
| Notifications | **PASS** | Copy de notificação não expõe kcal/peso/diagnóstico; payload de dados só carrega IDs opacos |
| Beta readiness | **CONDITIONAL** | Tecnicamente pronto para um beta MUITO pequeno e controlado (equipe interna, cientes, com catálogo mínimo de teste) — não pronto para qualquer usuário externo real até o catálogo e os Terms/Privacy reais existirem |

---

## Detalhe por categoria

### Technical — PASS

- Gravidez/amamentação: campo atual, revalidado em toda chamada (request,
  worker, retry) — `functions/src/nutrition/generation/context.ts:75-76`.
- Idade: 18-100 no Engine, consistente com o piso de 18 do produto geral
  (`PROFILE_MIN_AGE`); teto do Engine (100) é mais permissivo que o teto do
  produto geral (75) — inconsistência de baixo risco, nunca alcançável na
  prática hoje (ver relatório principal, "Bugs técnicos").
- Alérgenos: fail-closed (`allergens === null` exclui), aplicado na seleção
  de candidatos E na validação pós-IA.
- Dietary pattern: filtragem determinística, nunca decidida pela IA.
- Auto-adjust: não existe em nenhuma camada (confirmado por busca ampla).
- Validator: nenhum plano é persistido sem passar por
  `validateAndBuildPlan`; Rules negam escrita direta do cliente em
  `nutritionPlans`.
- Feature flags: fail-safe confirmado em 3 camadas (shared core, client
  hook, backend rollout guard).
- Rate limits: full_plan 15 min; meal_alternative 20s/12-por-hora.

### Nutrition professional — NOT REVIEWED

Ver `09_safety/professional_review_checklist.md` (18 itens, todos
`NOT REVIEWED`). O canonical já cita literatura para a maioria dos valores,
mas isso é decisão da equipe de engenharia, não validação profissional para
esta população específica.

### Privacy/LGPD — CONDITIONAL

Pontos fortes (verificados em código): payload à OpenAI não inclui
identificadores diretos nem valores biométricos brutos; `store:false`;
logs limpos; analytics com firewall de regex contra propriedades
sensíveis; account deletion cobre todas as coleções Firestore de Nutrição.

Pontos pendentes: retenção não documentada; Terms/Privacy reais ausentes
(placeholder); subprocessador OpenAI não confirmado nos termos (porque não
há termos reais ainda); RIPD não avaliado.

### Legal/claims — BLOCKED (para além de beta interno fechado)

Achado mais importante desta fase: há precedente público e documentado
(CRN-5, 2020) de denúncia formal contra um app estrangeiro de "IA gera
dieta" por possível exercício ilegal da profissão de nutricionista, sob a
Lei 8.234/1991. O módulo de Nutrição do AJ Fit tem a mesma forma estrutural
(plano alimentar gerado por IA, sem nutricionista humano por usuário). Isto
não é uma conclusão de ilegalidade — é um risco real que exige revisão
jurídica formal antes de qualquer exposição a usuários reais fora da
própria equipe.

### Operations / Catalog — atualizado na segunda rodada da Fase 33

A TACO 4ª edição revisada e ampliada (NEPA/UNICAMP, 2011) foi extraída
oficial diretamente do PDF publicado, 519 alimentos com macros reais
(kcal/proteína/carboidrato/gordura/fibra) parseados e validados. Uma
primeira tentativa de classificar `allergens`/`dietaryFlags` com
heurística automática por palavra-chave foi feita e **revertida** por
violar a instrução de não inventar essa classificação.

Nesta rodada, com autorização explícita do usuário para usar `ajfit-2f321`
como ambiente de teste, 58 alimentos foram revisados
manualmente, item a item, com `rationale` documentado por alimento
(`scripts/nutrition/sources/taco-v1-enrichment.json`). Isso é
qualitativamente diferente da heurística revertida: cada decisão é uma
linha auditável, não uma função de classificação aplicada em massa.
`npm run nutrition:catalog:audit` confirma cobertura real
(`hasCandidateCoverage`) para os 4 padrões alimentares em todos os 6 meal
slots e contagens de 2-6 refeições.

**Importado de verdade em `ajfit-2f321`**: `created: 519, updated: 0,
unchanged: 0` — nenhum dado pré-existente foi tocado. `nutritionCatalogMeta/current`
e `nutritionRolloutConfig/active` (100%) confirmados por leitura direta do
Firestore. Rules e indexes de Nutrição deployados.

**Bloqueador atual**: `OPENAI_API_KEY` não está configurada neste projeto.
O Firebase CLI resolve os secrets de todo o codebase de Functions antes de
filtrar por `--only`, então isso bloqueia o deploy de QUALQUER função
(não só as de Nutrição) até o secret existir. Nenhuma função de Nutrição
está deployada em `ajfit-2f321` ainda — a geração real não pode ser
testada no app até esse passo (comando exato em
`test_environment_checklist.md`, nunca o valor da chave).

**Limitação de catálogo remanescente**: a maior parte de carne/peixe/ovo/leite puro não
foram aprovados — a TACO marca fibra como "NA" para esses itens (não
"0,0"), e `foodAllowed()` exige `fiberG != null`. Preencher com 0 seria
inventar o dado que a fonte deixou em branco. O subconjunto curado agora
inclui `Frango, filé, à milanesa` (TACO 401), que possui fibra medida e
alergênicos conservadores documentados; ele não resolve a expansão geral
do catálogo, mas tornou o caso onívoro real testado matematicamente viável.

### AI — PASS (dentro do que o código controla)

Pipeline completo: candidatos determinísticos → prompt com instrução
explícita de dados-não-confiáveis → Responses API com JSON Schema estrito
→ validação determinística (shape, alérgenos, dietary pattern, bounds de
macro) → correção de gramas → retry → fallback para modelo mais forte,
limitado a 2 tentativas antes do fallback e falha explícita no limite.
Nenhum caminho alternativo de persistência existe.

### Notifications — PASS

Copy fixa, allowlist-enforced, sem números sensíveis em título/corpo.

### Beta readiness — CONDITIONAL

O código está pronto para um beta tecnicamente seguro. O produto, como um
todo (não só Nutrição), não tem Terms/Privacy reais, e o catálogo de
alimentos real não existe. Um beta interno restrito a funcionários/equipe,
avisados fora do app sobre a natureza experimental e com um catálogo de
teste minimamente maior que 1 item, é viável. Qualquer coisa alem disso
não é.

---

## Dependências entre categorias

```text
Catalog PASS (dentro do subset curado)
  -> Operations BLOCKED (OPENAI_API_KEY ausente em ajfit-2f321)
    -> Beta readiness CONDITIONAL (app ainda não gera dieta de verdade)

Legal/claims BLOCKED (rollout público)
  -> não bloqueia Technical/AI/Notifications
  -> bloqueia qualquer usuário externo real

Nutrition professional NOT REVIEWED
  -> não bloqueia beta técnico interno
  -> bloqueia qualquer claim de "seguro"/"validado" em produção
```
