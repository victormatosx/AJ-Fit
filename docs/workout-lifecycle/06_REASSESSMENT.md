# Reavaliação

## Pós-parto

Status: `FUTURE_DESIGN`.

O questionário futuro deverá coletar `deliveryDate`, a data do parto, além do contexto já
existente, e oferecer uma pergunta explícita de reavaliação/prontidão. A data
permite derivar tempo; não prova recuperação e não remove safety gates.

Pergunta conceitual, ainda sem copy final: “Você considera que já concluiu sua
recuperação pós-parto e voltou à sua rotina normal de exercícios?”. Sua resposta
é entrada do algoritmo, não liberação clínica.

O conteúdo exato da pergunta, o momento de reapresentação e o critério de saída
do contexto pós-parto são `DECISION_REQUIRED` (DR-020/DR-007/DR-008). Autodeclaração
de melhora não substitui restrição profissional, sinais de alerta ou liberação
exigida.

## Reavaliação geral

Uma reavaliação gera nova entrada e pode gerar novo snapshot de prescrição. Ela
não deve sobrescrever questionário, programa ou trace anterior. Agenda e
progressão podem solicitar reavaliação, mas não podem fabricar suas respostas.

Gatilhos futuros podem incluir término de um período de referência, mudança de
saúde, retorno após pausa ou solicitação do usuário. Frequência e critérios
permanecem em DR-014.
