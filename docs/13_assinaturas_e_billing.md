# Assinaturas e Billing

## 1. Objetivo deste documento

Definir as regras de monetização do sistema.

Definir:

* planos
* assinaturas
* período de teste
* renovação
* cancelamento
* reembolso
* restauração de compra

Este documento é a referência oficial para toda lógica de billing do projeto.

---

# 2. Plataforma de billing

O gerenciamento de assinaturas utiliza:

* RevenueCat
* Apple App Store
* Google Play Store

---

## Fonte oficial de verdade

A fonte oficial para assinaturas é:

```txt
RevenueCat
```

---

## Regra obrigatória

Em caso de divergência:

```txt
RevenueCat vence.
```

---

# 3. Produto

Produto inicial:

```txt
AJ Fit Premium
```

---

## Objetivo

Liberar acesso completo ao aplicativo.

---

# 4. Planos disponíveis

Planos iniciais:

* Trimestral
* Semestral
* Anual

---

## Observação

Novos planos exigem atualização deste documento.

---

# 5. Teste gratuito

Todos os planos possuem:

```txt
7 dias de teste gratuito
```

---

## Regras

O usuário deve cadastrar uma forma de pagamento antes de iniciar o teste.

Nenhuma cobrança ocorre durante o período de teste.

A cobrança acontece apenas após o término do período gratuito.

---

# 6. Limite do teste gratuito

O teste gratuito pode ser utilizado:

```txt
apenas uma vez por conta
```

---

## Objetivo

Evitar abuso do período gratuito.

---

# 7. Fluxo de ativação

Fluxo esperado:

1. usuário conclui questionário
2. usuário recebe recomendação de treino
3. usuário cria conta
4. usuário escolhe plano
5. usuário inicia teste gratuito
6. acesso premium é liberado

---

# 8. Acesso durante o teste gratuito

Status:

```txt
TRIAL
```

---

## Permissões

O usuário possui acesso completo ao aplicativo.

---

# 9. Assinatura ativa

Status:

```txt
ACTIVE
```

---

## Permissões

O usuário possui acesso completo ao aplicativo.

---

# 10. Cancelamento durante o teste gratuito

Se o usuário cancelar durante o período de teste:

O acesso permanece ativo até o final dos 7 dias.

---

## Após o término

O acesso é removido.

---

# 11. Cancelamento de assinatura paga

Se o usuário cancelar uma assinatura ativa:

O acesso permanece disponível até o final do período já pago.

---

## Renovação

A renovação automática deixa de ocorrer.

---

# 12. Falha de cobrança

Exemplo:

* cartão recusado
* pagamento não processado

---

## Status

```txt
BILLING_ISSUE
```

---

## Tolerância

O sistema deve conceder:

```txt
7 dias
```

de tolerância.

---

## Objetivo

Permitir regularização do pagamento.

---

# 13. Expiração

Status:

```txt
EXPIRED
```

---

## Permissões

O acesso premium é removido.

---

## Acesso permitido

O usuário pode visualizar:

* histórico resumido

---

## Acesso bloqueado

* treino ativo
* execução de treino
* evolução física
* fotos de evolução
* medidas corporais
* percentual de gordura

---

# 14. Conteúdo bloqueado

Dados bloqueados não devem ser removidos.

Devem permanecer armazenados.

---

## Fotos de evolução

Devem permanecer visíveis porém censuradas.

---

## Medidas corporais

Devem permanecer visíveis porém censuradas.

---

## Percentual de gordura

Deve permanecer visível porém censurado.

---

## Objetivo

Demonstrar valor acumulado e incentivar reativação.

---

# 15. Restauração de compra

O sistema deve permitir:

```txt
Restore Purchase
```

---

## Fluxo

1. usuário realiza restauração
2. RevenueCat valida assinatura
3. acesso é restaurado
4. dados são sincronizados

---

# 16. Troca de plano

O sistema deve permitir:

* trimestral → semestral
* trimestral → anual
* semestral → anual
* anual → semestral
* anual → trimestral

conforme regras da Apple, Google e RevenueCat.

---

# 17. Reembolsos

O sistema não possui processo próprio de reembolso na versão inicial.

---

## Responsabilidade

Os reembolsos seguem os mecanismos oficiais:

* Apple
* Google

---

## Regra

Eventos de reembolso recebidos pelo RevenueCat devem atualizar automaticamente o status da assinatura.

---

# 18. Exclusão de conta

Ao excluir a conta:

* assinatura deve ser cancelada
* acesso deve ser removido
* conta entra em processo de exclusão

---

## Prazo

Dados permanecem armazenados por:

```txt
90 dias
```

Após este período ocorre remoção definitiva.

---

# 19. Cupons promocionais

O sistema permite utilização de cupons.

---

## Objetivos

* rastrear origem do usuário
* identificar influenciador
* aplicar desconto quando configurado

---

## Visibilidade

O cupom é utilizado apenas internamente.

Não precisa permanecer visível ao usuário após o cadastro.

---

# 20. Analytics de billing

O sistema deve armazenar:

* data da primeira assinatura
* data da última renovação
* plano contratado
* status atual
* cupom utilizado
* origem do usuário

---

## Objetivo

Relatórios internos e métricas de negócio.

---

# 21. Eventos mínimos do RevenueCat

Monitorar:

* INITIAL_PURCHASE
* RENEWAL
* CANCELLATION
* EXPIRATION
* BILLING_ISSUE
* REFUND
* PRODUCT_CHANGE

---

# 22. Status oficiais do sistema

Status permitidos:

```txt
TRIAL
ACTIVE
CANCELED
BILLING_ISSUE
EXPIRED
```

---

# 23. Funcionamento offline

Quando não for possível validar a assinatura:

O sistema pode utilizar a última validação positiva por até:

```txt
24 horas
```

---

## Após 24 horas

O aplicativo deve exigir nova validação online.

---

# 24. Evoluções futuras

Possíveis expansões:

* planos alimentares
* produtos complementares
* novos níveis de assinatura

Esses recursos não fazem parte da V1.

---

# 25. Pedido para o Agente Billing

Definir:

* produtos da App Store
* produtos da Google Play
* configuração do RevenueCat
* webhooks
* sincronização com Firestore
* estratégia de restauração

Respeitando todas as regras deste documento.
