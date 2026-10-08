# AJ Fit Nutrition — Futuras Integrações de Saúde

## 1. Escopo da V1

Fora da V1:

- Apple Health;
- Health Connect;
- Google Fit;
- outras plataformas de saúde.

Nutrição deve funcionar integralmente sem essas integrações.

---

## 2. Preparação arquitetural

Contratos internos devem evitar acoplamento direto com qualquer fornecedor.

Exemplo conceitual:

```ts
interface ExternalHealthDataSource {
  getBodyWeight(): Promise<ExternalMeasurement[]>;
  getActivityData(): Promise<ExternalActivityData[]>;
}
```

Esse contrato é apenas preparação futura, não requisito de implementação da V1.

---

## 3. Dados potencialmente úteis no futuro

Poderão ser avaliados:

- peso;
- passos;
- gasto energético;
- frequência cardíaca;
- sono;
- atividade física.

Nenhum desses dados externos entra nas regras atuais da V1.

---

## 4. Política de autoridade

**PENDENTE.**

Ainda não foi decidido se uma futura integração externa:

A) poderá atualizar/substituir automaticamente a fonte de verdade do AJ Fit;

ou

B) será apenas uma fonte sincronizada/auxiliar, mantendo o AJ Fit como autoridade.

Essa decisão deve ser registrada em ADR próprio antes de qualquer integração de saúde.

---

## 5. Regra até a decisão

Enquanto a política estiver pendente:

- não implementar sincronização automática;
- não sobrescrever peso;
- não usar dados externos no Nutrition Engine;
- não criar dependência de provider externo.

---

## 6. Requisitos futuros

Antes de habilitar integração:

1. definir source of truth;
2. resolver conflitos de dados;
3. definir consentimento;
4. definir revogação;
5. definir retenção;
6. revisar privacidade;
7. revisar impacto no Nutrition Engine;
8. criar testes de sincronização.

---

## 7. Segurança

Dados externos de saúde devem ser tratados com maior cuidado de privacidade.

A integração futura não deve enviar dados adicionais para IA sem justificativa e contrato explícito.
