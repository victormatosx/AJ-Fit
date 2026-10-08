# AJ Fit Nutrition — Launch Checklist

## 1. Produto

- [ ] Escopo V1 confirmado.
- [ ] Plano é apresentado como recomendação.
- [ ] Plano e diário são visualmente distintos.
- [ ] Fluxo de Perfil Nutricional aprovado.
- [ ] Empty states aprovados.
- [ ] Histórico/restauração testados.

---

## 2. Nutrition Engine

- [ ] Fórmula RMR versionada.
- [ ] Regras de TDEE fechadas.
- [ ] Deficit/surplus fechados.
- [ ] Regras por pace fechadas.
- [ ] Safety calorie floors fechados.
- [ ] Protein ranges fechados.
- [ ] Fat minimums fechados.
- [ ] Fiber rule fechada.
- [ ] Tolerâncias fechadas.
- [ ] Meal distribution fechada.
- [ ] Revisão profissional das constantes concluída.
- [ ] Golden tests verdes.

---

## 3. Food Catalog

- [ ] Fontes e provenance documentados.
- [ ] Catálogo Brasil-first carregado.
- [ ] Foods mais comuns revisados.
- [ ] Aliases funcionais.
- [ ] Categories completas.
- [ ] Vegan/vegetarian flags revisadas.
- [ ] Allergens revisados.
- [ ] Industrializados possuem origem identificada.
- [ ] `generationStatus` aplicado.
- [ ] Busca com performance aceitável.

---

## 4. Safety

- [ ] Pregnancy bloqueia geração.
- [ ] Lactation bloqueia geração.
- [ ] Nenhum bypass disponível.
- [ ] Excluded foods são hard exclusions.
- [ ] Allergen validation ativa.
- [ ] Calorie floors ativos.
- [ ] Aggressiveness limits ativos.
- [ ] Safety tests verdes.
- [ ] Disclaimers aprovados.
- [ ] Revisão jurídica/profissional Brasil concluída.

---

## 5. IA

- [ ] API key em Secret Manager.
- [ ] Provider abstraction implementada.
- [ ] Structured Output ativo.
- [ ] Prompt versionado.
- [ ] Schema versionado.
- [ ] Food subset limitado.
- [ ] Validator determinístico obrigatório.
- [ ] Correction-first implementado.
- [ ] Máximo 2 retries.
- [ ] Fallback controlado.
- [ ] Nenhuma resposta bruta persiste sem validação.
- [ ] AI eval suite aprovada.
- [ ] Custos medidos.
- [ ] Latência p95 aceitável.

---

## 6. Backend

- [ ] Firestore schema final.
- [ ] Rules em produção testadas no Emulator.
- [ ] Cross-user access bloqueado.
- [ ] accountActive aplicado.
- [ ] Single active plan garantido.
- [ ] Idempotência de geração.
- [ ] Lock de geração concorrente.
- [ ] Jobs recuperáveis.
- [ ] Account deletion cobre Nutrição.
- [ ] Rate limits ativos.
- [ ] Secrets corretos por ambiente.

---

## 7. Frontend

- [ ] Nutrition tab flaggable.
- [ ] Home funcional.
- [ ] Plano | Diário claros.
- [ ] Generation screen resiliente.
- [ ] Background/restart reconciliam job.
- [ ] Food Search funcional.
- [ ] Custom foods funcionais.
- [ ] Recipes funcionais.
- [ ] Weekly funcional.
- [ ] Erros recuperáveis.
- [ ] Loading/skeletons consistentes com AJ Fit.
- [ ] Dark/light conforme padrão do app.

---

## 8. Diário

- [ ] Registro livre.
- [ ] Plano não é alterado por log.
- [ ] Totais corretos.
- [ ] Edição funciona.
- [ ] Alimentos próprios funcionam.
- [ ] Receitas funcionam.
- [ ] Histórico diário íntegro.

---

## 9. Integrações

- [ ] Peso vem da fonte autoritativa existente.
- [ ] Novo peso não muda plano automaticamente.
- [ ] Frequência de treino integrada sem double counting.
- [ ] Notificações usam infraestrutura existente.
- [ ] Deep links testados.
- [ ] Health integrations continuam fora da V1.

---

## 10. Analytics

- [ ] Funnel events.
- [ ] Logging WAU.
- [ ] Nutrition WAU.
- [ ] AI metrics.
- [ ] Cost dashboards.
- [ ] Failure alerts.
- [ ] Latency alerts.
- [ ] Sem PII/nutrition-sensitive payload indevido.

---

## 11. Testing

- [ ] Unit suite verde.
- [ ] Engine suite verde.
- [ ] AI validator suite verde.
- [ ] Firestore Rules suite verde.
- [ ] Functions integration verde.
- [ ] E2E crítico verde.
- [ ] Double tap testado.
- [ ] Retry testado.
- [ ] Offline temporário testado.
- [ ] Restore plan testado.
- [ ] New exclusion conflict testado.

---

## 12. Performance

- [ ] NutritionHome abre dentro do target do app.
- [ ] Catálogo não é carregado inteiro.
- [ ] Queries revisadas.
- [ ] Índices necessários criados.
- [ ] Nenhuma collection query desnecessária em tela principal.
- [ ] Firestore read volume monitorado.

---

## 13. Rollout

- [ ] Feature flag global OFF inicialmente.
- [ ] Internal QA aprovado.
- [ ] Beta controlado aprovado.
- [ ] 1% sem regressão.
- [ ] 5% sem regressão.
- [ ] 10% sem regressão.
- [ ] 25% sem regressão.
- [ ] 50% sem regressão.
- [ ] 100% aprovado manualmente.

---

## 14. Stop conditions

Pausar rollout imediatamente se houver:

- safety violation;
- cross-user data access;
- plano inválido persistido;
- allergen/exclusion breach;
- geração duplicada relevante;
- custo anormal;
- failure spike;
- crash spike;
- corrupção de diário/plano.

---

## 15. Critério final de lançamento

A V1 está pronta quando um usuário elegível consegue:

1. criar Perfil Nutricional;
2. gerar dieta validada;
3. visualizar recomendações;
4. registrar livremente o que consumiu;
5. acompanhar calorias/macros;
6. ver visão semanal;
7. manter histórico íntegro;

sem violar safety, privacidade ou invariantes de backend.
