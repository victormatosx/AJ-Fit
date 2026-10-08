# AJ Fit Nutrition — Offline e Cache

## 1. Contexto atual

O AJ Fit usa Firebase JS SDK em React Native e atualmente não possui persistência Firestore offline durável completa.

A Nutrição não deve assumir offline-first inexistente.

---

## 2. Objetivo da V1

Manter boa experiência com:

- cache em memória;
- dados recentes mantidos no estado local;
- persistência local seletiva onde necessário.

---

## 3. Dados prioritários para cache local

- plano ativo;
- resumo do dia atual;
- diário do dia atual;
- alimentos recentemente usados;
- receitas próprias;
- favoritos.

---

## 4. Catálogo

Não carregar catálogo inteiro na memória.

Usar:

- busca sob demanda;
- cache de resultados recentes;
- cache de alimentos usados no plano ativo.

---

## 5. Plano ativo

Após carregar, manter snapshot local para renderização rápida.

Se offline temporariamente:

- permitir visualizar último plano disponível;
- deixar claro quando dado pode estar desatualizado.

---

## 6. Diário

Idealmente permitir edição local temporária e sincronizar quando conexão voltar.

Na V1, se não houver camada robusta de fila offline:

- preservar draft local;
- não fingir que salvou;
- sincronizar apenas após confirmação do backend/Firestore.

---

## 7. Geração

Não iniciar geração de dieta sem conexão.

Se a conexão cair durante geração:

- job continua no backend;
- app reconcilia ao voltar.

---

## 8. Busca de alimentos

Sem conexão:

- mostrar recentes/cacheados;
- explicar que busca completa requer conexão.

---

## 9. Evolução futura

Se o AJ Fit migrar para SDK Firebase nativo ou arquitetura offline durável, Nutrição deve reaproveitar a mesma estratégia global do app, sem criar solução paralela.
