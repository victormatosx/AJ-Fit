Quero que você MATERIALIZE no projeto AJ Fit as decisões fechadas do arquivo:

AJ_Fit_limitation_clinical_decisions_v1.json

IMPORTANTE:
Esse arquivo é a fonte de verdade das decisões de política de produto.
NÃO faça nova revisão clínica.
NÃO troque exercícios por conta própria.
NÃO "melhore" as decisões.
NÃO transforme isso numa nova auditoria.
Sua função agora é aplicar exatamente as decisões e provar que o resolver real aceita todas.

==================================================
CONTEXTO
==================================================

Já foi comprovado no projeto:

- limitationResolver V1 é não recursivo;
- `adapt` precisa apontar diretamente para target `compatible` ou `not_applicable`;
- `avoid` sem candidato é válido, mas gera NO_SAFE_SUBSTITUTION;
- o baseline atual tem 176 combinações alcançáveis inválidas;
- quality gate, audit script, remediation matrix e baseline já existem;
- o working tree estava limpo após os commits anteriores.

O novo arquivo contém:

- decisão fechada para cada uma das 176 linhas;
- 3 mudanças auxiliares de nós terminais;
- status final desejado;
- target exato quando status = adapt;
- rationaleGroup;
- confidence.

==================================================
FASE 0 — VERIFICAÇÃO
==================================================

Antes de editar:

1. Confirme branch/HEAD/status.
2. Localize:
   - docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json
   - src/data/exercisesSeedData.ts
   - src/workoutPrescription/limitationResolver.ts
   - scripts/auditLimitationDataset.ts
   - scripts/generateLimitationDatasetBaseline.ts
   - quality gate do dataset.
3. Leia AJ_Fit_limitation_clinical_decisions_v1.json.
4. Valide que existem exatamente:
   - 176 rows;
   - 151 decision units informativas;
   - 3 supportingChanges.
5. Confirme que cada exerciseId citado existe no catálogo.

Se houver divergência de versão/arquivo, PARE e reporte.

==================================================
FASE 1 — APLICAR AS 3 SUPPORTING CHANGES
==================================================

Aplique primeiro `supportingChanges` exatamente como declaradas.

Elas existem para tornar targets aprovados terminais no resolver V1.

Não crie target alternativo.

==================================================
FASE 2 — APLICAR AS 176 DECISÕES
==================================================

Para cada row:

- se proposedDecision.status = compatible:
  torne aquele `exerciseId × region` terminal `compatible`;
  remova adaptation/substitute fields incompatíveis com esse status conforme o schema real.

- se = not_applicable:
  torne terminal `not_applicable`;
  remova adaptation/substitute fields incompatíveis.

- se = adapt:
  configure exatamente:
    status: "adapt"
    adaptation.kind: "exercise_variant"
    adaptation.exerciseId: TARGET_EXATO_DO_JSON

Não siga cadeia recursiva.
O target precisa resolver diretamente.

Não altere outras regiões do mesmo exercício sem necessidade.

==================================================
FASE 3 — COMPATIBILIDADE TÉCNICA DOS TARGETS
==================================================

Algumas decisões aprovadas podem esbarrar na elegibilidade técnica do catálogo.

Regra:

A decisão clínica NÃO muda para satisfazer o código.

Se o resolver rejeitar um target aprovado por:
- purpose;
- substitution relation;
- availability;
- equipment metadata;
- ou outra relação estrutural,

investigue a causa.

Se a correção for uma relação/metadata pontual e coerente para ESSE par:
- faça a menor alteração possível em exercisesSeedData.ts ou na metadata canônica equivalente;
- adicione teste específico;
- não altere o target clínico.

PROIBIDO:
- relaxar globalmente limitationResolver;
- remover validações;
- tornar qualquer exerciseId elegível para qualquer outro;
- habilitar substituição recursiva;
- aumentar genericamente a superfície de candidatos só para zerar testes.

Se uma decisão só puder ser materializada enfraquecendo uma invariável global de segurança, PARE e reporte o par exato.

==================================================
FASE 4 — REEXECUTAR O RESOLVER REAL
==================================================

Rode o mesmo audit real usado para produzir os 176 blockers.

Objetivo:

176 → 0 blockers alcançáveis nos T001–T090.

Não aceite:
- 1 blocker restante;
- erro convertido em outra classe;
- baseline que simplesmente absorveu nova falha.

Para cada decisão `adapt`, prove que:
targetStatus final ∈ {compatible, not_applicable}
e que o resolver retorna resultado válido.

==================================================
FASE 5 — BASELINE / QUALITY GATE
==================================================

Somente depois de o audit real retornar 0:

1. regenere limitation-dataset-baseline.json;
2. o baseline deve cair de 176 para 0 para o escopo alcançável;
3. atualize limitation-dataset-audit.json;
4. regenere remediation matrix/queue, se os scripts atuais determinarem isso;
5. nenhum `NEEDS_CLINICAL_REVIEW` deve permanecer para essas 176 linhas.

O quality gate deve continuar impedindo:
- target inexistente;
- self-reference proibida;
- exercício alcançável sem profile;
- nova combinação inválida.

Não remova o quality gate agora que o baseline chegou a zero.

==================================================
FASE 6 — TESTES DE REGRESSÃO
==================================================

Preserve e atualize o teste real que originou o problema:

plank × knee

Ele não deve mais esperar dívida conhecida/fail-closed.
Ele deve verificar a decisão aprovada no JSON e resolver com sucesso.

Adicione testes representativos de cada classe original:

- CLASS_1 dataset contradictory;
- CLASS_2 adaptation not terminal;
- CLASS_3 avoid without executable strategy;
- CLASS_4 technically incompatible.

Também teste pelo menos:
- knee;
- hip;
- back;
- shoulder;
- elbow;
- wrist;
- ankle_foot.

==================================================
FASE 7 — NÃO MEXER
==================================================

Não altere:

- motor de seleção dos T001–T090;
- Schedule Engine;
- questionário;
- auth;
- RevenueCat;
- UI do onboarding;
- regras Firestore;
- prescription composition além do necessário para consumir o dataset já existente.

O objetivo é DATASET + metadata pontual de substituição quando estritamente necessária.

==================================================
VALIDAÇÃO FINAL
==================================================

Rode:

npx tsx scripts/auditLimitationDataset.ts
npx tsc --noEmit -p .
npx vitest run

Se houver script específico de quality gate, rode também.

Não faça commit ainda.

==================================================
ENTREGA
==================================================

Reporte:

1. Quantas das 176 decisões foram aplicadas.
2. Quantas supportingChanges foram aplicadas.
3. Quantos profiles foram modificados.
4. Quais pares exigiram mudança técnica de substitution metadata.
5. Para cada mudança técnica, explique por que não enfraqueceu o resolver.
6. Blockers antes/depois.
7. Contagem final por região.
8. Cycles antes/depois.
9. Baseline antes/depois.
10. Resultado do plank × knee.
11. Resultado do audit.
12. Resultado do typecheck.
13. Resultado da suíte.
14. Arquivos modificados.
15. Qualquer decisão que não pôde ser materializada sem enfraquecer uma invariável global.

NÃO faça commit sem minha autorização.
