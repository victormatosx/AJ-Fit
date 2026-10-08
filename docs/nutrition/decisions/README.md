# AJ Fit Nutrition — Architecture Decision Records

## 1. Objetivo

A pasta `decisions/` registra decisões arquiteturais importantes da Nutrição.

Use ADR quando uma decisão:

- afeta múltiplos módulos;
- é difícil/caro de reverter;
- define autoridade de dados;
- define fronteiras entre backend, IA e cliente;
- altera segurança;
- altera contratos persistidos;
- define integração com sistemas externos.

---

## 2. Convenção

Formato:

```text
ADR-XXX-titulo-curto.md
```

Status permitidos:

- `PROPOSED`
- `ACCEPTED`
- `SUPERSEDED`
- `DEPRECATED`

---

## 3. ADRs atuais

### ADR-001 — Nutrition Architecture

Status: `ACCEPTED`

Define:

- Nutrition Engine determinístico;
- IA como camada não autoritativa;
- Food Catalog canônico;
- validação determinística pós-IA;
- separação entre plano recomendado e diário real;
- arquitetura Firestore/backend;
- safety gates;
- versionamento;
- rollout.

Arquivo:

`ADR-001-nutrition-architecture.md`

---

## 4. ADRs futuros recomendados

Criar apenas quando a decisão realmente existir.

Possíveis candidatos:

- ADR-002 — Política de source of truth para integrações de saúde;
- ADR-003 — Estratégia de busca do Food Catalog em escala;
- ADR-004 — Política de internacionalização do catálogo;
- ADR-005 — Suporte a condições clínicas;
- ADR-006 — Estratégia avançada de dietas por treino/descanso.

---

## 5. Regra

Documentação descritiva vive nas pastas `01_...` a `13_...`.

ADRs existem para registrar **por que uma decisão arquitetural foi tomada** e quais alternativas foram descartadas.
