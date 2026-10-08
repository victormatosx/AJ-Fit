# AJ Fit Nutrition — Casos End-to-End

## 1. Objetivo

Validar os fluxos críticos da V1 do ponto de vista do usuário.

---

## 2. Primeiro uso completo

Fluxo:

1. abrir aba Nutrição;
2. ver empty state;
3. iniciar Perfil Nutricional;
4. concluir respostas;
5. revisar;
6. tocar `Criar minha dieta`;
7. ver tela de geração;
8. job completar;
9. abrir plano;
10. visualizar refeições.

Esperado:
- exatamente um plano ativo;
- snapshots persistidos;
- UI consistente.

---

## 3. Geração com background

1. iniciar geração;
2. mandar app para background;
3. job continuar;
4. voltar;
5. app reconciliar status;
6. abrir plano concluído.

Não criar nova geração.

---

## 4. Double tap

Tocar CTA de geração repetidamente.

Esperado:
- uma operação efetiva;
- nenhuma duplicidade;
- no máximo um plano novo.

---

## 5. Falha de IA

Simular falha após retries.

Esperado:
- nenhum plano inválido persistido;
- job failed;
- mensagem tratável;
- botão tentar novamente.

---

## 6. Safety — gravidez

Usuária marcada como grávida.

Esperado:
- geração bloqueada;
- nenhuma chamada à IA;
- mensagem profissional;
- sem bypass.

---

## 7. Safety — lactação

Mesmo comportamento de gravidez.

---

## 8. Exclusão alimentar

Adicionar alimento excluído.

Gerar plano.

Esperado:
- nenhuma refeição usa alimento proibido;
- nenhum produto incompatível conhecido.

---

## 9. Plano recomendado vs diário

1. abrir almoço recomendado;
2. registrar alimentos totalmente diferentes;
3. salvar.

Esperado:
- plano continua intacto;
- diário contém consumo real;
- macros do dia refletem diário.

---

## 10. Seguir opção recomendada

1. escolher opção recomendada;
2. pré-preencher log;
3. editar quantidade;
4. salvar.

Esperado:
- diário guarda quantidade real;
- plano não é alterado.

---

## 11. Criar alimento próprio

1. busca sem resultado;
2. criar alimento;
3. usar no diário.

Esperado:
- disponível só para usuário;
- não entra em geração automática.

---

## 12. Criar receita

1. criar receita;
2. adicionar ingredientes simples;
3. quantidades;
4. salvar;
5. usar no diário.

Esperado:
- macros derivados corretamente;
- receita privada.

---

## 13. Trocar refeição

1. pedir alternativa;
2. IA gerar;
3. validar;
4. confirmar.

Esperado:
- nova opção compatível;
- histórico/auditabilidade;
- diário passado inalterado.

---

## 14. Novo peso

1. plano ativo;
2. registrar novo peso em Evolução.

Esperado:
- plano não muda;
- pode aparecer recomendação de nova geração;
- snapshots continuam iguais.

---

## 15. Nova exclusão conflitante

1. plano possui alimento X;
2. usuário adiciona X às exclusões.

Esperado:
- conflito identificado;
- refeições afetadas informadas;
- recomendação de regeneração;
- nenhuma mudança silenciosa.

---

## 16. Gerar novo plano

Esperado:
- plano anterior archived;
- novo active;
- só um active;
- diário histórico intacto.

---

## 17. Restaurar plano antigo

Esperado:
- atual archived;
- escolhido active;
- diário intacto.

---

## 18. Resumo semanal

Após vários dias registrados:

validar:
- médias;
- número de dias;
- macros;
- integração visual com peso;
- ausência de score diário de aderência.

---

## 19. Offline temporário

Com plano já carregado:

- perder conexão;
- visualizar plano cacheado;
- tentar geração -> bloquear com feedback;
- preservar draft do diário quando aplicável.

---

## 20. Cross-user isolation

Sessão A nunca deve:
- ler plano B;
- ler log B;
- ler receita B;
- alterar perfil B.

Validar no E2E/emulator.
