# Checklist manual — Fase 3 da assinatura

## 1. Objetivo

Validar em dev build iOS e Android os comportamentos que dependem do SDK
nativo, das lojas sandbox, do lifecycle real e da rede. Testes unitários não
substituem este roteiro.

Executar com contas sandbox dedicadas, sem alterar usuários reais. Conta A
deve começar Premium e conta B sem Premium, exceto quando o caso disser o
contrário.

## 2. Evidências a registrar

Para cada teste, registrar:

* plataforma e versão do sistema;
* build usado;
* conta lógica A ou B, sem e-mail/UID completo;
* resultado visual;
* logs sanitizados relevantes;
* aprovado ou reprovado.

Logs esperados podem incluir:

```txt
subscription_identity_sync_started
subscription_identity_sync_completed
customer_info_refresh_started
customer_info_refresh_completed
customer_info_refresh_failed
customer_info_listener_update
subscription_snapshot_discarded_stale_identity
subscription_foreground_revalidation
```

Não anexar API key, receipt, token Firebase, e-mail ou UID completo.

## 3. Testes obrigatórios

### Teste 1 — Premium → matar app → abrir

1. Entrar com A Premium e confirmar AppShell.
2. Encerrar completamente o aplicativo.
3. Abrir novamente.

Esperado: estado neutro durante Auth/RevenueCat, depois AppShell. O Paywall não
deve piscar durante a resolução.

### Teste 2 — Não Premium → matar app → abrir

1. Entrar com B sem Premium e confirmar Paywall.
2. Encerrar completamente o aplicativo.
3. Abrir novamente.

Esperado: estado neutro durante resolução, depois Paywall. AppShell nunca
aparece.

### Teste 3 — A Premium → logout → B não Premium

1. Entrar com A e confirmar AppShell.
2. Fazer logout.
3. Entrar imediatamente com B.

Esperado: logout retorna ao fluxo Auth; B passa por estado neutro e termina no
Paywall. Nenhum frame do AppShell de A pode aparecer para B.

### Teste 4 — B → logout → A Premium

1. Partir de B no Paywall.
2. Fazer logout.
3. Entrar com A.

Esperado: A passa por sincronização neutra e termina no AppShell.

### Teste 5 — AppShell → background → foreground

1. Com A Premium no AppShell, enviar o app ao background.
2. Aguardar e retornar ao app.

Esperado: log `subscription_foreground_revalidation`; o AppShell permanece se
o `CustomerInfo` atualizado continuar Premium. Repetir ida/volta rapidamente e
confirmar ausência de loop ou múltiplas chamadas concorrentes.

### Teste 6 — Paywall → background → foreground

1. Com B sem Premium no Paywall, enviar o app ao background.
2. Ativar Premium externamente por um mecanismo sandbox suportado.
3. Retornar ao app.

Esperado: depois que o RevenueCat atualizar `CustomerInfo`, o Gate troca para
AppShell sem navegação manual do Paywall.

### Teste 7 — Restore real sandbox

1. Usar uma conta AJ Fit ligada a uma compra sandbox restaurável.
2. No Paywall, tocar em Restore Purchases.

Esperado: restore com entitlement `premium` abre AppShell via Gate; restore sem
entitlement permanece Paywall e informa que não há assinatura ativa.

### Teste 8 — Compra real sandbox

1. Com B no Paywall, selecionar um package real.
2. Concluir a compra sandbox.

Esperado: preço/package vêm da loja; `CustomerInfo` retornado ativa o Gate e
abre AppShell. Cancelar uma segunda tentativa deve permanecer no Paywall sem
erro técnico nem concessão de acesso.

### Teste 9 — Abrir offline

Executar dois subcasos:

1. A Premium já confirmado nesse dispositivo: matar o app, retirar a conexão e
   abrir.
2. Trocar para uma identidade que nunca teve `CustomerInfo` confirmado nesse
   estado offline.

Esperado: no primeiro caso, o resultado segue o cache oficial retornado pelo
RevenueCat SDK para A. No segundo, AppShell nunca abre; o app mostra estado
neutro de erro/conexão com retry. Nunca usar Firestore como fallback.

### Teste 10 — Perder conexão durante revalidação

1. Com A Premium no AppShell, ir ao background.
2. Cortar a conexão antes de retornar.
3. Voltar ao foreground.

Esperado: não crashar e não entrar em loop. Se o refresh falhar, o snapshot já
confirmado de A permanece; não vira automaticamente não Premium. Ao restaurar
a conexão e repetir background → foreground, a revalidação se recupera.

### Teste 11 — Trocar contas rapidamente

1. Alternar A Premium → logout → B sem Premium e repetir.
2. Durante a janela, provocar foreground e, se possível, iniciar restore antes
   do logout.

Esperado: operações terminam sem crash; resultados antigos são descartados; B
nunca recebe Premium de A; listener não duplica.

### Teste 12 — TRANSFER A → B

1. Confirmar A no AppShell e B no Paywall.
2. Executar TRANSFER real pelo fluxo já suportado no sandbox/backend.
3. Revalidar A por foreground e por logout/login.
4. Revalidar B por foreground e por logout/login.
5. Inspecionar o espelho Firestore somente para auditoria.

Esperado: A termina no Paywall e B no AppShell conforme seus respectivos
`CustomerInfo`. O Firestore pode acompanhar o resultado, mas nenhuma diferença
temporária nele altera o Gate.

## 4. Critério de encerramento

A Fase 3 só pode ser encerrada após os 12 testes passarem em iOS e Android, com
compra/restore/TRANSFER executados no ambiente sandbox aplicável. Falha em
isolamento de conta, flash de AppShell/Paywall incorreto ou uso de Firestore
como autorização é bloqueadora.

## 5. Estado da validação pós-Fase 3 em 2026-08-11

Evidências manuais informadas antes da otimização de cold start:

* teste 1 aprovado funcionalmente, sem flash de Paywall;
* teste 2 aprovado funcionalmente, mas com demora e dois loadings visuais;
* testes 3 e 4 aprovados no ciclo A Premium → B sem Premium → A;
* revalidação background → foreground aprovada;
* teste 12 (TRANSFER A → B) aprovado: A perdeu Premium, B recebeu Premium e o
  Gate permaneceu coerente com RevenueCat;
* testes offline 9 e 10 continuam **pendentes** e não contam como aprovados.

Após a otimização, repetir no dispositivo os testes 1 e 2, verificando tempo e
continuidade visual; executar uma regressão curta dos testes 3–6. O teste 2
deve exibir uma única superfície neutra contínua até os planos reais ficarem
disponíveis. Os testes offline 9 e 10 permanecem obrigatórios para encerrar a
Fase 3.
