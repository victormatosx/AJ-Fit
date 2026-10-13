# AJ Fit Nutrition — Fluxos de Usuário

## 1. Objetivo

Este documento descreve os fluxos funcionais de alto nível da Nutrição V1. Ele define a experiência esperada sem prescrever arquitetura de backend, modelo de dados ou implementação de UI.

## 2. Fluxo principal — primeiro acesso

```text
Usuário acessa Nutrição
        ↓
Validação de assinatura/acesso
        ↓
Validação de elegibilidade
        ↓
Coleta de dados já existentes no AJ Fit
        ↓
Questionário nutricional complementar
        ↓
Revisão das respostas
        ↓
Geração do plano
        ↓
Validação do plano
        ↓
Plano ativo
        ↓
Home de Nutrição
```

### Regras

- Dados já presentes no perfil do AJ Fit devem ser reutilizados.
- O usuário só responde perguntas adicionais necessárias à Nutrição.
- Se o usuário for inelegível para geração automática, o fluxo deve ser interrompido antes da geração.
- Ao concluir a geração, o plano passa a ser o plano nutricional ativo.

## 3. Fluxo — Home de Nutrição

A Home de Nutrição deve concentrar a visão do dia.

Prioridades:

1. calorias e macros consumidos vs. metas;
2. refeições do dia;
3. próxima refeição;
4. progresso/aderência semanal.

```text
Home Nutrição
 ├── resumo calórico/macros
 ├── próxima refeição
 ├── refeições do dia
 └── progresso semanal
```

Cada refeição deve mostrar de forma clara:

- o que estava planejado;
- o que já foi registrado como consumido;
- estado de aderência daquela refeição.

## 4. Fluxo — visualizar refeição planejada

```text
Home
 ↓
Seleciona refeição
 ↓
Detalhes da refeição
 ├── opção principal
 ├── opções equivalentes
 ├── calorias/macros/fibras
 ├── trocar alimento
 ├── trocar refeição
 └── registrar consumo
```

O plano terá aproximadamente 2–3 opções equivalentes por refeição.

## 5. Fluxo — registrar o que realmente foi consumido

Este é um dos fluxos centrais da V1.

```text
Seleciona refeição
       ↓
Registrar consumo
       ↓
Adicionar alimentos consumidos
       ↓
Definir quantidade/porção
       ↓
Salvar
       ↓
AJ Fit recalcula nutrientes
       ↓
Comparação planejado x consumido
       ↓
Atualização das métricas do dia
```

### Regras

- O usuário pode registrar exatamente o que estava previsto.
- O usuário pode registrar apenas parte da refeição prevista.
- O usuário pode registrar alimentos completamente diferentes.
- O produto não deve impedir um registro por ele não corresponder ao plano.
- A divergência deve ser representada como informação de aderência, e não como erro.

## 6. Fluxo — seguir exatamente uma refeição planejada

Deve existir um caminho rápido para o caso mais comum.

```text
Refeição planejada
       ↓
Usuário consumiu conforme o plano
       ↓
Ação rápida para registrar a refeição planejada
       ↓
Consumo real preenchido com os mesmos itens/quantidades
       ↓
Usuário pode ajustar antes ou depois de salvar
```

O objetivo é não obrigar o usuário a recadastrar manualmente todos os alimentos quando seguiu a recomendação.

## 7. Fluxo — trocar um alimento

```text
Refeição planejada
       ↓
Seleciona alimento
       ↓
Trocar alimento
       ↓
AJ Fit mostra alternativas adequadas
       ↓
Usuário escolhe alternativa
       ↓
Plano é atualizado
       ↓
Metas e refeição são revalidadas
```

A substituição deve manter coerência nutricional conforme regras definidas em documentos posteriores.

## 8. Fluxo — trocar refeição inteira

```text
Refeição planejada
       ↓
Trocar refeição
       ↓
Perguntar motivo/feedback
       ↓
Gerar ou selecionar alternativas
       ↓
Mostrar opções antes de confirmar
       ↓
Usuário escolhe
       ↓
Plano é atualizado
```

Motivos poderão incluir, por exemplo:

- não gostei;
- não quero esses alimentos;
- quero algo diferente;
- incompatível com minha rotina.

A taxonomia final de feedback será definida posteriormente.

## 9. Fluxo — feedback de preferência

```text
Usuário rejeita alimento/refeição
        ↓
AJ Fit solicita motivo
        ↓
Usuário informa preferência
        ↓
Preferência é persistida
        ↓
Sugestões futuras consideram o feedback
```

O sistema deve aprender preferências persistentes, mas o usuário deverá conseguir revisar essas preferências em fluxo próprio a ser detalhado no frontend.

## 10. Fluxo — favoritar refeição

```text
Refeição
  ↓
Favoritar
  ↓
Refeição entra nos favoritos do usuário
  ↓
Favoritos podem ser priorizados em sugestões futuras
```

Favoritar não significa obrigatoriedade de repetição.

## 11. Fluxo — editar quantidade

```text
Refeição/plano
      ↓
Seleciona alimento
      ↓
Editar quantidade
      ↓
AJ Fit recalcula impacto nutricional
      ↓
Usuário confirma
      ↓
Plano atualizado
```

As regras sobre até onde o usuário pode alterar uma quantidade sem invalidar o plano serão definidas no domínio nutricional.

## 12. Fluxo — histórico de planos

```text
Plano ativo
   ↓
Histórico
   ↓
Lista de versões anteriores
   ↓
Abrir versão
   ↓
Comparar / restaurar
   ↓
Confirmação
   ↓
Versão escolhida torna-se ativa
```

Toda restauração deve preservar histórico e versionamento; não deve apagar versões anteriores.

## 13. Fluxo — métricas diárias

```text
Registros alimentares
       ↓
Cálculo dos nutrientes consumidos
       ↓
Comparação com metas do dia
       ↓
Atualização do resumo
```

Métricas mínimas:

- calorias;
- proteína;
- carboidratos;
- gorduras;
- fibras.

## 14. Fluxo — aderência semanal

```text
Consumo de cada dia
      ↓
Comparação com plano/metas
      ↓
Cálculo de aderência
      ↓
Resumo semanal
```

A fórmula exata de aderência não pertence ao `01_product`; será definida em documentação posterior.

## 15. Fluxo — evolução corporal

A Nutrição deve reutilizar dados corporais e de evolução já existentes no AJ Fit.

```text
Dados de progresso AJ Fit
          ↓
Nutrição consome a mesma fonte
          ↓
Exibe métricas relevantes
```

Não deve existir cadastro paralelo de peso/medidas exclusivo da Nutrição quando a informação já estiver disponível no sistema principal.

## 16. Fluxo — usuário inelegível

```text
Usuário inicia configuração
        ↓
Safety gate detecta condição/público bloqueado
        ↓
Geração é interrompida
        ↓
Mensagem simples e humana
        ↓
Orientação para acompanhamento profissional
```

O produto não deve tentar gerar uma versão "mais conservadora" do plano em casos bloqueados.

## 17. Fluxo — erro de geração

```text
Solicitação de geração
       ↓
Falha técnica ou validação rejeitada
       ↓
Usuário recebe estado de erro recuperável
       ↓
Retry controlado
```

Detalhes de retries, idempotência e fallback serão definidos em `06_ai/` e `07_backend/`.

## 18. Fluxos explicitamente inexistentes na V1

Não existirão na primeira versão:

- chat com IA;
- foto para reconhecer alimentos;
- scanner de código de barras;
- lista de compras;
- receitas completas;
- ajuste automático do plano com base no progresso;
- dieta diferente para treino e descanso;
- regeneração completa e irrestrita do plano como ação comum do usuário.
