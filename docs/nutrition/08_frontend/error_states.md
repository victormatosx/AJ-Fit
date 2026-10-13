# AJ Fit Nutrition — Estados de Erro

## 1. Geração falhou

Mensagem simples.

Ações:

- tentar novamente;
- voltar.

Não mostrar:

- provider;
- modelo;
- JSON;
- erro interno.

---

## 2. Perfil incompleto

Direcionar exatamente para o campo necessário.

Evitar erro genérico.

---

## 3. Safety gate

Para gravidez/lactação na V1:

- bloquear geração;
- explicar de forma respeitosa;
- recomendar acompanhamento profissional.

Não oferecer bypass.

---

## 4. Plano incompatível após mudança

Exemplo:

usuário adiciona alimento atualmente usado à lista de exclusões.

Mostrar:

- que o plano atual contém item incompatível;
- quais refeições foram afetadas;
- CTA para gerar novo plano.

Não alterar silenciosamente.

---

## 5. Catálogo indisponível

Se dados já carregados forem suficientes para exibir histórico, manter leitura.

Bloquear apenas ações que realmente dependem do catálogo atualizado.

---

## 6. Falha ao salvar diário

Mostrar erro próximo da ação.

Preservar edição local até retry quando possível.

---

## 7. Plano não encontrado

Se `planId` histórico não existir:

- voltar para plano ativo;
- mostrar mensagem tratável.

---

## 8. Job expirado/inconsistente

Reconciliar com backend antes de permitir nova geração.

Evitar dois jobs concorrentes.

---

## 9. Receita inválida

Indicar:

- ingrediente ausente;
- quantidade inválida;
- alimento removido.

Não salvar receita inconsistente.
