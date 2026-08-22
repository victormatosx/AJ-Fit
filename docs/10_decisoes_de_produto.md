# Decisões de Produto

## 1. Objetivo deste documento

Registrar as principais decisões estratégicas do produto.

Este documento responde:

```txt
Por que o produto foi construído desta forma?
```

As decisões aqui registradas orientam:

* produto
* design
* desenvolvimento
* experiência do usuário
* comunicação

---

# 2. Propósito do produto

O AJ Fit existe para:

```txt
Fazer o usuário evoluir de verdade.
```

Toda decisão do produto deve contribuir para esse objetivo.

---

# 3. Problema principal

O principal problema combatido pelo produto não é falta de informação.

O principal problema combatido é:

```txt
Falta de motivação gerada pela ausência de progresso percebido.
```

O sistema deve aumentar a percepção de evolução contínua.

---

# 4. Posicionamento

O AJ Fit não é uma biblioteca de treinos.

O AJ Fit não é um catálogo de exercícios.

O AJ Fit não é uma ferramenta de montagem de treinos.

O AJ Fit é um:

```txt
Treinador Digital
```

---

# 5. Percepção desejada

O usuário deve sentir:

```txt
Tenho um plano para evoluir.
```

e

```txt
Estou evoluindo.
```

---

# 6. Nível de posicionamento

O produto deve ser percebido como:

```txt
Premium
```

Toda experiência deve reforçar essa percepção.

---

# 7. Público prioritário

O produto atende:

* iniciantes
* intermediários

Prioridade ligeiramente maior para intermediários.

---

# 8. Filosofia central

O produto prioriza:

```txt
Direcionamento
```

acima de:

```txt
Liberdade
```

---

## Consequências

O sistema reduz:

* excesso de escolhas
* complexidade
* necessidade de decisão constante

---

# 9. Filosofia dos treinos

O usuário não monta seu próprio treino.

O sistema define o treino.

O objetivo é reduzir dúvidas e aumentar execução.

---

# 10. Percepção do treino

O usuário deve sentir:

```txt
O sistema montou um treino para mim.
```

Não:

```txt
Escolhi um treino pronto.
```

---

# 11. Evolução como mecanismo principal

A evolução é o principal mecanismo de retenção do produto.

O sistema deve reforçar evolução através de:

* histórico de cargas
* evolução física
* fotos de evolução
* novas fases
* novos treinos

---

# 12. Filosofia de progressão

O produto trabalha com:

```txt
Nova Fase
```

e não apenas:

```txt
Novo Treino
```

---

## Objetivo

Gerar sensação contínua de desenvolvimento.

---

# 13. Método principal

O principal diferencial do produto é:

```txt
Método do Arnaldo
+
Evolução contínua
```

---

# 14. Personalização

O produto utiliza personalização controlada.

O sistema seleciona treinos de acordo com o perfil do usuário.

A personalização não significa liberdade total de edição.

---

# 15. Motivação

O produto não depende de motivação momentânea.

O sistema deve criar motivação através de:

* progresso visível
* histórico
* evolução física
* novas fases

---

# 16. Filosofia da experiência

O usuário deve gastar energia:

```txt
Treinando
```

e não:

```txt
Tomando decisões.
```

---

# 17. Filosofia do onboarding

O questionário não existe apenas para coleta de dados.

O questionário faz parte da percepção de personalização.

O usuário deve sentir que o sistema está entendendo seu perfil.

---

# 18. Filosofia da assinatura

O usuário deve visualizar valor antes da compra.

Por isso:

1. responde o questionário
2. recebe recomendação
3. visualiza resumo do treino
4. cria conta
5. inicia assinatura

---

# 19. Filosofia do dashboard

O dashboard é o centro da experiência.

O objetivo principal é incentivar:

```txt
Iniciar Treino
```

---

# 20. Filosofia de simplicidade

Sempre que existir conflito entre:

```txt
Mais recursos
```

e

```txt
Mais simplicidade
```

a preferência inicial deve ser:

```txt
Mais simplicidade.
```

---

# 21. Filosofia de expansão futura

Novas funcionalidades devem reforçar a proposta principal.

Possíveis evoluções futuras:

* dieta
* recomendações inteligentes
* IA coach
* acompanhamento ampliado

Nenhuma evolução futura deve comprometer simplicidade e direcionamento.

---

# 22. Concorrência

Os principais referenciais competitivos atuais são:

* Hevy
* Prime Coaching

---

## Estratégia

Não competir apenas por funcionalidades.

Competir por:

* direcionamento
* evolução
* método
* experiência

---

# 23. Regra de validação

Toda nova funcionalidade deve responder:

```txt
Isso ajuda o usuário a evoluir de verdade?
```

Se a resposta não for clara, a funcionalidade deve ser reavaliada.

---

# 24. Pedido para o Agente PO

Avaliar continuamente:

* aderência ao propósito
* aderência ao posicionamento
* aderência à filosofia de simplicidade
* aderência à proposta de evolução

Toda proposta futura deve respeitar as decisões deste documento.

---

# 25. Autenticação sem MFA

O AJ Fit não oferece MFA, TOTP, autenticação em dois fatores ou códigos de
recuperação. A autenticação suportada é e-mail/senha, Google e Apple, com
verificação de e-mail, recuperação/alteração de senha, account linking e
persistência segura de sessão. Uma eventual reintrodução de MFA exige nova
decisão de produto e nova arquitetura; não deve reutilizar resíduos da POC
removida em agosto de 2026.
