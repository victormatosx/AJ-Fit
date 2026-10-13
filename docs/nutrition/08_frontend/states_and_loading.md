# AJ Fit Nutrition — Estados e Loading

## 1. Princípio

Evitar telas em branco e loading genérico sempre que o estado puder ser explicado.

---

## 2. NutritionHome

Estados:

- loading;
- sem perfil;
- perfil sem plano;
- plano ativo;
- plano ativo + diário vazio;
- plano ativo + diário parcial;
- erro recuperável.

---

## 3. Skeletons

Usar skeletons para:

- resumo diário;
- próxima refeição;
- refeições;
- resumo semanal.

Evitar spinner central para toda a tela quando dados parciais já puderem ser exibidos.

---

## 4. Geração

Estados:

```text
queued
running
validating
completed
failed
```

Mapear para mensagens de UX simples.

---

## 5. Persistência do estado de geração

Se o usuário sair da tela e voltar:

- consultar job atual;
- continuar progresso;
- não iniciar nova geração automaticamente.

---

## 6. Registro de refeição

Usar atualização otimista para ações simples quando seguro.

Exemplos:

- adicionar alimento;
- alterar gramas;
- remover item.

Em falha:

- restaurar estado anterior;
- mostrar feedback claro.

---

## 7. Busca

Estados:

- inicial;
- digitando;
- resultados;
- sem resultados;
- erro.

Não bloquear a tela inteira enquanto busca.

---

## 8. Empty states

### Sem dieta
CTA principal: `Criar minha dieta`

### Sem registro no dia
Explicar que o usuário pode registrar livremente.

### Sem receitas
CTA: `Criar receita`

### Sem alimento encontrado
CTA: `Criar alimento`
