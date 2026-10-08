# AJ Fit Nutrition — Peso e Evolução

## 1. Fonte de peso

Nutrição reutiliza automaticamente o **peso mais recente** registrado em `users/{uid}/assessments/{id}` (serviço real `src/services/assessments.ts`), ordenado por `measuredAt` desc. Na UI do AJ Fit esse domínio é apresentado como "Evolução", mas não existe um módulo/serviço com esse nome — `assessments.ts` é a fonte real.

Não manter peso nutricional separado.

---

## 2. Fonte autoritativa

`users/{uid}/assessments/{id}` (`src/services/assessments.ts`) continua sendo a fonte de verdade para peso corporal.

Nutrição consome o valor.

Não duplicar o mesmo dado em múltiplas fontes mutáveis.

---

## 3. Geração de dieta

No momento da geração, salvar no snapshot:

- peso utilizado;
- data do registro;
- origem do dado;
- demais dados físicos relevantes.

Isso permite reproduzir a decisão histórica.

---

## 4. Novo peso após plano ativo

Se o usuário registrar novo peso:

- não recalcular plano automaticamente;
- não alterar macros do plano ativo;
- não modificar quantidades silenciosamente.

O plano continua válido como snapshot histórico.

---

## 5. Recomendação de nova geração

Mudança relevante de peso pode gerar recomendação para criar novo plano.

A recomendação não deve:

- forçar;
- bloquear uso do plano atual;
- regenerar silenciosamente.

---

## 6. Visão semanal

A visão semanal de Nutrição pode mostrar junto:

- média de calorias;
- macros;
- registro alimentar;
- tendência de peso já existente no AJ Fit.

Não criar segunda implementação de gráfico de peso se o app já possui uma autoridade visual reutilizável.

---

## 7. Integração com progresso

Nutrição consome dados de `users/{uid}/assessments/{id}` (`src/services/assessments.ts`), exibido na UI como "Evolução".

Não deve alterar esse histórico de assessments diretamente.

---

## 8. Independência histórica

Mudanças posteriores de peso não alteram:

- dietas antigas;
- snapshots;
- diário alimentar já registrado.
