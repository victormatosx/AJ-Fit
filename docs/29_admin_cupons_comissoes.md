# Admin de cupons, atribuição e futura comissão

## Arquitetura auditada

O catálogo vive em `promoCodes/{CODE}`. `validatePromoCode` normaliza e valida o código no backend e grava, em uma única transação, `couponRedemptions/{uid}` (fonte de verdade) e `users/{uid}.attribution` (espelho de leitura). Enquanto `lockedAt` é nulo o código pode ser trocado; uma compra/trial só bloqueia a atribuição quando o webhook prova a oferta Google (`basePlanId + offer_code`) ou o purchase intent iOS.

O Firebase UID é o App User ID configurado no RevenueCat. O webhook também resolve aliases/original IDs pela API V2 quando o ID direto não basta. `CustomerInfo`/entitlement `premium` é a autoridade de acesso no app; `users/{uid}.subscription` é apenas o espelho administrativo atual.

## Collections relacionadas

- `promoCodes`: catálogo backend-only, com código, ativação, janela de validade, influencer/campanha e configuração de ofertas Android/iOS.
- `couponRedemptions`: uma atribuição comercial por UID; contém snapshots da oferta, intent iOS, confirmação de trial/conversão e, para novos eventos, a identidade imutável `subscriptionOrigin`.
- `users`: espelhos `attribution` e `subscription`; o Admin nunca os altera para conceder Premium.
- `subscriptionTransactions`: ledger backend-only e imutável de cobranças atribuídas capturadas após seu deploy.

Não foi criada uma collection `influencers`: o modelo existente já usa `influencerId` como dimensão em catálogo, redemption e ledger. Uma entidade separada só deve nascer quando houver dados próprios/contrato do influenciador.

## Lifecycle e atribuição

- `TRIAL`: `INITIAL_PURCHASE` com `period_type=TRIAL`, oferta correlacionada e entitlement ativo.
- conversão paga: `INITIAL_PURCHASE` pago correlacionado, ou `RENEWAL` com `is_trial_conversion=true` após trial confirmado.
- mensal/anual: allowlist dos product IDs reais em `adminUsers/presentation.ts`; produto desconhecido permanece `unknown`.
- ativo pago: conversão confirmada + `status=ACTIVE` + entitlement ativo.
- cancelamento programado: `status=CANCELED` + entitlement ainda ativo.
- expirado: `EXPIRATION`, ou cancelado sem entitlement.
- billing issue: `BILLING_ISSUE`; a expiração efetiva usa grace period quando presente, mas o fim de grace não é armazenado separadamente.
- renovação: cada novo `RENEWAL` atribuído entra no ledger; `lastRenewedAt` continua como resumo do estado atual.

Eventos comerciais processados: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE` e `PRODUCT_CHANGE`. `TRANSFER` usa reconciliação V2 separada. `UNCANCELLATION` e eventos futuros desconhecidos são reconhecidos como não suportados e ignorados; `SUBSCRIPTION_PAUSED` não está na allowlist atual.

## Receita e comissão

O ledger usa `price_in_purchased_currency` e `currency` do evento real, além de `price` (USD, quando presente), percentuais estimados de imposto/comissão da loja e proceeds estimados. Preço atual/hardcoded nunca é usado para história.

O documento é deduplicado pelo hash de `store + transaction_id`. A origem é localizada por `store + original_transaction_id`, preservada na redemption confirmada. Assim, retry/restore não duplica receita e uma transferência de ownership não move a origem comercial.

`commissionEligible`, `commissionRuleId` e `commissionAmount` ficam nulos. Isso separa fatos de receita da futura decisão de comissão e permite ligar uma regra versionada depois, sem reescrever o evento financeiro. Nenhum payout foi implementado.

## Segurança e performance

As Rules negam todo acesso cliente a `promoCodes`, `couponRedemptions` e `subscriptionTransactions`. O Admin usa callables que revalidam `users/{adminUid}.metadata.role == admin` e Admin SDK. CRUD de cupom continua na allowlist estrita existente. Novos cupons são criados exclusivamente pela callable administrativa e sempre começam inativos. A ativação é uma operação transacional separada e falha enquanto `appleConfigurationConfirmedAt` não existir.

## Criação e configuração externa

O fluxo escolhido é Admin como rascunho/inativo → configuração externa → confirmação administrativa → ativação. O formulário possui revisão final e envia uma allowlist para `adminCreatePromoCode`; o backend repete normalização, datas, pares Android, trio iOS, tipos, limites de tamanho, confirmação e duplicidade. O ID do documento é o código normalizado por `normalizePromoCode`, portanto diferenças de casing/espaço não criam identidades alternativas. O próprio código permanece imutável.

Campos obrigatórios: código, `influencerId`, `campaignId`, booleanos de status/confirmação e os grupos de loja quando configurados. `internalName`, janela de validade e `notes` são opcionais. Não há limite de usos no contrato real, portanto ele não foi inventado na UI. Como não existe cadastro autoritativo de influenciadores, a validação segura disponível é do identificador escalar (não vazio e limitado); a UI sugere IDs já presentes no catálogo, sem fingir que há uma entidade externa verificada.

No iOS, o mecanismo ativo não é Apple Offer Code. O operador precisa criar/configurar manualmente os SKUs promocionais mensal e anual e seus Introductory Offers no App Store Connect, além de disponibilizá-los na Offering promocional indicada no RevenueCat. O Admin apenas registra os identificadores e a declaração `appleConfigurationConfirmedAt/By`; não chama uma API da Apple e nunca apresenta esse estado como “verificado pela Apple”. No Android, cada plano usa o par exato `basePlanId + offerId`.

Criação, edição, ativação e desativação emitem eventos estruturados no Cloud Logging (`coupon.created`, `coupon.updated`, `coupon.activated`, `coupon.deactivated`) com administrador, cupom e dimensões relevantes. Nenhum token ou secret é registrado. Nenhuma Firestore Rule foi aberta: navegador e mobile continuam sem leitura/escrita direta no catálogo.

Editar ou desativar o catálogo não altera `couponRedemptions` nem `subscriptionTransactions`. Influenciador, campanha e configurações de loja já capturados permanecem nos snapshots históricos, e a origem financeira continua vinculada à identidade transacional original.

As páginas administrativas fazem leituras em lote (`getAll`/`getUsers`) e não chamam RevenueCat por usuário. A página de detalhe é paginada no contrato. A visão geral ainda faz scans backend de redemptions/ledger para montar agregados reais; é adequada ao catálogo atual, mas deve migrar para agregados materializados quando volume/custo justificar.

Não foi necessário índice composto: as novas consultas usam igualdade em um único campo (`couponCode` ou `subscriptionOrigin.transactionKey`).

## Limites e riscos conhecidos

- Não há backfill automático: cobranças anteriores ao deploy de `subscriptionTransactions` não aparecem como receita capturada.
- Auto-renew e fim do grace period não existem como campos separados no espelho atual.
- Product IDs desconhecidos não são classificados por heurística.
- Cupons não possuem duração promocional configurável nem limite de usos; `notes` é a descrição administrativa e o benefício deriva apenas da configuração real das lojas.
- O catálogo não possui audit log Firestore com before/after; as Functions emitem eventos estruturados no Cloud Logging, inclusive mudanças relevantes e o estado anterior disponível.
- `UNCANCELLATION` e `SUBSCRIPTION_PAUSED` ainda não atualizam o espelho.
- `subscriptionTransactions` retém UIDs para conciliação, alinhado à retenção já aplicada a `couponRedemptions`; a política legal de retenção deve ser revista explicitamente antes de mudar esse comportamento.
- A inspeção visual automatizada do browser local não esteve disponível nesta execução; lint, testes e builds foram executados.
