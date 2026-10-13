# AJ Fit Nutrition — Migração e Compatibilidade

## 1. Contexto

Nutrição é um módulo novo.

Não existe dieta legada da V1 para migrar.

Mesmo assim, o rollout precisa preservar compatibilidade com usuários e documentos já existentes do AJ Fit.

---

## 2. users/{uid}

Não adicionar blocos grandes diretamente no documento raiz do usuário.

Preferir subcoleções próprias.

Motivos:
- evitar aumento desnecessário do documento;
- reduzir contention;
- manter Rules isoladas;
- preservar contratos atuais.

---

## 3. Dados existentes reutilizados

Nutrição consome fontes já existentes para:

- sexo;
- nascimento/idade;
- altura;
- objetivo;
- peso mais recente;
- treino/frequência.

Não migrar esses dados para cópias nutricionais mutáveis.

---

## 4. Usuários existentes

Na primeira entrada em Nutrição:

- detectar ausência de `nutritionProfile/current`;
- iniciar Perfil Nutricional;
- reaproveitar dados existentes;
- perguntar apenas campos novos.

Não exigir novo onboarding global.

---

## 5. Novos usuários

O módulo pode ser iniciado após onboarding principal.

Não acoplar obrigatoriamente a geração de dieta ao fluxo inicial do app, salvo decisão futura.

---

## 6. Versionamento de questionário

Guardar `questionnaireVersion`.

Quando versão nova adicionar campo obrigatório:

- detectar ausência;
- perguntar somente o necessário;
- não invalidar perfil inteiro sem motivo.

---

## 7. Versionamento do engine

Planos antigos preservam:
- engineVersion;
- rule versions;
- snapshots.

Nova versão do engine só afeta nova geração.

---

## 8. Versionamento do catálogo

Alteração de alimento não modifica plano antigo.

Planos mantêm snapshot dos valores usados.

---

## 9. Versionamento de IA

Guardar:
- provider;
- model;
- promptVersion;
- schemaVersion.

Planos antigos não precisam ser regenerados ao trocar modelo.

---

## 10. Compatibilidade de app

Durante rollout, builds antigas não devem quebrar por presença das novas collections.

Rules novas não devem alterar acesso a módulos existentes.

---

## 11. Campos opcionais

Ao introduzir novos campos em documentos existentes:
- manter leitura tolerante;
- aplicar defaults explícitos;
- migrar apenas quando necessário.

---

## 12. Rollback

Rollback da feature deve poder:
- esconder tab;
- impedir novas gerações;
- manter dados já persistidos;
- permitir recuperação futura.

Não apagar dados automaticamente ao desligar feature flag.
