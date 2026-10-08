# AJ Fit Nutrition — Casos de Avaliação da IA

## 1. Objetivo

Avaliar a camada generativa sem delegar a ela decisões nutricionais.

A suite deve testar:

- estrutura;
- compatibilidade;
- restrições;
- variedade;
- adequação;
- estabilidade;
- custo;
- taxa de validação.

---

## 2. Execução

Ter dois modos:

### Determinístico em CI
Provider fake/mock.

### Real provider eval
Executado:
- antes de trocar modelo;
- antes de trocar prompt;
- antes de alterar schema;
- periodicamente.

---

## 3. Casos base

Criar perfis de referência:

- onívoro sem restrições;
- vegetariano;
- vegano;
- pescatariano;
- muitas exclusões;
- poucos alimentos preferidos;
- “tanto faz”;
- usuário que prefere repetição;
- usuário que prefere variedade;
- usuário com whey;
- usuário sem whey.

---

## 4. Meal slots

Testar:
- 2 refeições;
- 3;
- 4;
- 5;
- 6.

Validar presença exata dos slots solicitados.

---

## 5. Opções por refeição

Cada refeição precisa ter:
- mínimo 2;
- máximo 3;
- exatamente uma principal.

---

## 6. Alimentos permitidos

Todo `foodId` precisa:
- existir;
- estar no subset permitido;
- estar `approved`.

Falha automática se IA inventar ID.

---

## 7. Exclusões

Fixtures com alimentos proibidos.

A saída nunca pode conter:
- foodId excluído;
- produto incompatível por alergênico conhecido.

---

## 8. Padrão alimentar

Validar:
- vegetariano;
- vegano;
- pescatariano.

Não confiar no texto do nome do alimento.

Usar tags canônicas.

---

## 9. Macros

Recalcular tudo pelo catálogo.

Medir:
- primeira passagem válida;
- quantidade de correções;
- retries;
- falhas finais.

---

## 10. Quantidades

Detectar valores implausíveis.

Exemplos:
- gramas zero;
- negativos;
- quantidades absurdas;
- refeições inviáveis.

---

## 11. Variedade

Para `repeatable`:
- maior repetição aceitável.

Para `variety`:
- opções mais distintas.

Para `indifferent`:
- equilíbrio.

Não tornar diversidade requisito superior à segurança/macros.

---

## 12. Preferências

Medir se:
- alimentos preferidos aparecem com frequência razoável;
- alimentos habituais são priorizados quando compatíveis;
- rejeições persistentes reduzem reaparecimento.

---

## 13. Substituição de refeição

Avaliar:
- nova opção válida;
- macros equivalentes;
- sem repetir exatamente opção recusada;
- respeita motivo categorizado.

---

## 14. Robustez a prompt injection

Campos de usuário devem ser tratados como dados.

Fixtures com nomes/descrições contendo instruções maliciosas não podem:
- alterar schema;
- liberar alimentos bloqueados;
- mudar metas;
- pedir exposição de prompt.

---

## 15. Retries

Forçar:
- schema inválido;
- macro inválido;
- alimento não permitido.

Validar:
- correção local quando possível;
- retry;
- máximo 2;
- fallback controlado;
- erro final sem persistência.

---

## 16. Métricas mínimas do eval

Por versão:
- validGenerationRate;
- firstPassValidationRate;
- correctionRate;
- retryRate;
- fallbackRate;
- latency;
- token usage;
- cost.

---

## 17. Critério de aprovação

Mudança de modelo/prompt só entra se:
- não reduzir segurança;
- não aumentar falhas significativamente;
- mantiver ou melhorar validade;
- custo/latência permanecerem aceitáveis.
