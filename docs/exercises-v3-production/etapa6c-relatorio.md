> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapa 6C: ativação e homologação final da V3

**`ACTIVE_SUBSTITUTION_POLICY` permanece `'legacy'`.** Preparei e validei integralmente a ativação, mas **não efetivei a troca do literal** — a instrução final do pedido ("aguarde minha autorização para efetivar a ativação") reserva esse passo especificamente para sua confirmação explícita, separada de "preparar". Cheguei a aplicar a troca momentaneamente durante o trabalho, percebi a leitura errada antes de prosseguir, revertida imediatamente — relato isso por transparência, não porque tenha ficado aplicada.

Nenhum deploy, build, commit ou push foi executado. Nenhum dado real alterado. Nenhuma decisão editorial da planilha alterada. Nenhum perfil inventado. Nenhum dos 41 rascunhos ativado.

## 1. Alterações realizadas

### Achado crítico e correção (não estava nos relatórios anteriores)

Ao verificar a compatibilidade entre o campo `substitutionPolicySnapshot` (introduzido na Etapa 5A) e as Firestore Security Rules reais, descobri que **`firestore.rules` nunca foi atualizado para permitir esse campo**. O validador `workoutExecutionCommonValid` (usado tanto no `create` quanto em todo `update` de `workoutExecutions`) e `workoutExecutionTerminalUpdateValid` (transição para `COMPLETED`/`PARTIALLY_COMPLETED`) usam `keys().hasOnly([...])` — uma lista fechada de campos permitidos que **não incluía** `substitutionPolicySnapshot`.

**Consequência real, se não corrigido:** como `src/services/workoutExecutions.ts` já escreve esse campo incondicionalmente em toda nova sessão desde a Etapa 5A (independente do valor da flag), um build publicado com esse código e as Rules antigas faria **toda criação de treino falhar** sob as Rules reais do Firestore — não é um problema específico da V3, afeta qualquer sessão, legada ou não. Isso nunca foi detectado porque a suíte de integração via SDK cliente (sujeita às Rules) estava bloqueada pelo limite de 1.000 expressões desde a Etapa 5D.

**Correção aplicada em `firestore.rules`:**
- `substitutionPolicySnapshot` adicionado às listas `hasOnly(...)` de criação/atualização geral e de transição terminal, com checagem de tipo (`in ['legacy', 'v3']`).
- Imutabilidade explícita: o campo não pode mudar em nenhuma atualização normal (registrar série, pular, finalizar, abandonar) — só pode ser re-escrito na transição `ABANDONED → IN_PROGRESS` (reinício após abandono), mesmo padrão já usado para `startedAt`/`cardio`.

Esta é uma correção de compatibilidade aditiva (permite um campo que já deveria ter sido permitido), nunca um enfraquecimento de segurança — a imutabilidade é tão ou mais estrita que a dos campos já existentes.

### Outras alterações
- `src/workoutPrescription/substitutionPolicyV3.ts`: `V3_ACTIVATION_BLOCKERS` atualizado — `SESSION_AUTHORIZATION_SNAPSHOTS_NOT_MIGRATED` removido (genuinamente resolvido e verificado nesta etapa, ver seção 3) e documentado por quê. Os outros 3 bloqueadores permanecem, sem alteração de comportamento. `ACTIVE_SUBSTITUTION_POLICY` **permanece `'legacy'`** — só o comentário foi atualizado para deixar claro que a ativação é um passo separado e consciente.

## 2. Estado final da política V3

`ACTIVE_SUBSTITUTION_POLICY = 'legacy'`. A troca para `'v3'` está isolada em **uma única linha** (já identificada e documentada no próprio arquivo), totalmente preparada e validada, aguardando sua autorização explícita em uma mensagem separada.

## 3. Resultado dos testes

| Suíte | Resultado |
|---|---|
| `npx tsc --noEmit` (app e functions) | Limpo |
| `npx eslint` nos arquivos tocados | 0 erros |
| Suíte completa do app | **44 falhas — os mesmos 16 arquivos pré-existentes**, 7.906 passaram, 232 ignorados. Nenhuma falha nova. |
| Suíte completa do backend | **0 falhas**, 2.026 passaram, 401 ignorados. |
| **Integração via SDK cliente, Rules reais aplicadas** (`workoutExecutions.integration.test.ts`, Firestore Emulator, `npm run test:integration:workoutExecution`) | **87/87 passou** — confirmado em 3 execuções independentes, incluindo os testes de política por sessão da Etapa 5A/6A e todos os cenários pré-existentes (mutex, cardio, agenda flexível, reinício após abandono). |
| **Integração via Admin SDK** (`exerciseSubstitution.integration.test.ts`, callable completo) | **10/10 passou** — autenticação, autorização, sessão legada vs. fixada em v3, candidato não autorizado, proteção de série concluída, idempotência, reversão, preferência permanente, rollback-safety. Confirmado em 2 execuções. |

## 4. Confirmação de compatibilidade app/backend

Todos os pontos pedidos verificados e passando:
1. Novas sessões registram `substitutionPolicySnapshot` igual ao valor de `ACTIVE_SUBSTITUTION_POLICY` no momento da criação — confirmado por teste de integração real.
2. Sessões antigas com `substitutionPolicySnapshot: 'legacy'` continuam no legado — confirmado.
3. Sessões antigas **sem** o campo continuam no legado (fallback hardcoded, nunca a constante global) — confirmado, inclusive via Rules reais.
4. O backend decide pela política gravada na sessão, nunca pela constante global, para o fluxo de substituição — confirmado via `substitutionPolicyFor`.
5. Tentativa de enviar um `requestedExerciseId` não autorizado é rejeitada pelo backend mesmo com a sessão fixada em `v3` — confirmado (teste 5 da suíte Admin SDK).
6. Preview e backend concordam exatamente para toda relação do dataset (teste de paridade já existente, 16/16, reconfirmado nesta etapa).
7. A alteração da constante global não reescreve nem afeta sessões já criadas — garantido por construção (o callable nunca escreve esse campo de volta) e confirmado por teste.

**Ressalva importante, não corrigida nesta etapa (não é uma regressão, é um limite de escopo já conhecido desde a Etapa 5A):** o pin por sessão cobre o fluxo de **substituição manual**. A **geração inicial de programa** e a **evolução de ciclo** (`engineV127.ts`/`authorizeMutation.ts`) não têm um pin equivalente a nível de instância de programa — ambas leem a constante global diretamente, sem política fixada no momento da criação do programa. Na prática, para um programa **novo**, criado depois da ativação, isso é o comportamento correto (deve usar as regras vigentes no momento). Como o AJ Fit não tem usuários reais, não há programa em andamento hoje que isso possa afetar — mas é uma lacuna real que deveria ser endereçada antes de haver usuários reais com programas de longa duração em evolução.

## 5. Dependências de build e deploy

- **Rebuild nativo: não é necessário.** Toda a mudança (flag, resolvedores, Rules) é lógica JavaScript/TypeScript pura e configuração de Firestore — nenhum módulo nativo, permissão ou configuração de app foi tocada.
- **`firestore.rules`: deploy obrigatório e com prioridade — independente da ativação da V3.** Como explicado na seção 1, o campo `substitutionPolicySnapshot` já é escrito incondicionalmente desde a Etapa 5A; as Rules em produção hoje **não o permitem**. Isso precisa ser corrigido **antes** de qualquer build que inclua código da Etapa 5A em diante chegar a um usuário real, mesmo que a V3 nunca seja ativada.
- **Cloud Functions: deploy necessário para a geração/evolução de programas usarem o novo padrão** (a decisão de substituição manual já funciona independente disso, por ser fixada na sessão). Antes do deploy, `scripts/syncPrescriptionEngineToFunctions.cjs` precisa ter rodado (já roda automaticamente no `pretypecheck`/build do workspace `functions`).
- **Dataset V3** (`docs/substitutions-v3/dataset.json`, 16.747 linhas) já está no bundle normal — é um import estático de `substitutionPolicyV3.ts`, igual a qualquer outro JSON do projeto, sem passo adicional.
- **Ambiente Firebase:** nenhuma configuração nova. Mesmo projeto (`ajfit-2f321`) e mesmas credenciais já usadas por todo o resto do app — nenhum ambiente paralelo foi criado.

## 6. Procedimento exato de ativação (quando autorizado)

1. `firebase deploy --only firestore:rules` — publica a correção de compatibilidade (seção 1). Pode e deve ser feito **antes** de qualquer outra coisa, inclusive antes de decidir sobre a V3; é retrocompatível (só adiciona um campo opcional).
2. `firebase deploy --only functions` — publica o backend com o motor V3 já integrado (necessário para geração/evolução; a substituição manual já funciona independente deste passo).
3. Alterar a linha única em `src/workoutPrescription/substitutionPolicyV3.ts`: `ACTIVE_SUBSTITUTION_POLICY: SubstitutionPolicyVersion = 'v3'`.
4. Publicar o novo JavaScript para o app — build normal (EAS) ou atualização OTA, o que for a prática já usada no projeto; nenhuma mudança de processo de build é exigida.
5. A partir desse ponto, toda sessão **nova** é criada com `substitutionPolicySnapshot: 'v3'`. Nenhuma sessão existente é afetada.

## 7. Procedimento de rollback

1. Reverter o literal único para `'legacy'` em `substitutionPolicyV3.ts` e publicar o novo JavaScript (mesmo passo 4 da ativação, invertido).
2. Nenhuma ação necessária no Firestore nem nas Rules — a correção da seção 1 é permanente e segura independente da política ativa.
3. Sessões criadas enquanto a V3 estava ativa continuam fixadas em `'v3'` (pin por sessão, nunca recalculado) — **são o comportamento esperado, não um efeito colateral do rollback**. Novas sessões, a partir do rollback, voltam a `'legacy'`.
4. Nenhum dado histórico, carga ou série é afetado em nenhum dos dois sentidos.

## 8. Checklist de testes físicos no iPhone

Você realizará estes testes pessoalmente; nenhum foi executado por mim no aparelho.

| # | Teste | Resultado esperado |
|---|---|---|
| 1 | Gerar um treino novo com a V3 ativa | Treino compõe normalmente; exercícios batem com o template esperado. |
| 2 | Substituição manual (sem limitação ativa) | Lista de opções reflete exatamente as relações aprovadas na planilha para aquele exercício/ambiente, na ordem de prioridade 1/2/3. |
| 3 | Substituição por limitação física (uma região) | Alternativa oferecida é segura para a região; se não houver alternativa aprovada, mensagem clara de indisponibilidade, nunca uma opção não autorizada. |
| 4 | Múltiplas limitações simultâneas | Alternativa oferecida (se houver) é segura para **todas** as regiões ativas ao mesmo tempo. |
| 5 | Substituição permanente | Persiste entre treinos; aplicada automaticamente na próxima sessão do mesmo exercício. |
| 6 | Reversão ao exercício original | Volta exatamente ao exercício prescrito original; marcador de substituição desaparece. |
| 7 | Exercício sem alternativa disponível | Estado de indisponibilidade claro na tela, sem travar a navegação, sem oferecer um exercício não aprovado. |
| 8 | Equipamentos de academia e de casa | Opções de substituição respeitam o ambiente — nunca uma opção só de casa aparecendo na academia ou vice-versa. |
| 9 | Fechar e reabrir o app durante um treino | Sessão retomada exatamente onde parou, com a mesma política de substituição da criação (não muda para legado nem trava). |
| 10 | Concluir o treino e checar histórico/cargas | Séries, cargas e exercício final gravados corretamente no histórico; nada do fluxo de substituição deixa rastro incorreto. |
| 11 | Confirmar que nenhum dos 41 rascunhos aparece | Em nenhuma tela — geração, substituição manual ou automática — qualquer um dos 41 exercícios em rascunho deve aparecer como opção. |

Não considero a homologação física concluída até sua confirmação.

## 9. Problemas críticos restantes

- **Nenhum problema crítico bloqueando a ativação técnica em si** — o único encontrado (Rules incompatíveis) foi corrigido e verificado com evidência real (87+10 testes contra Firestore Emulator real, Rules aplicadas).
- Pendência não-bloqueante, já conhecida: geração/evolução de programas sem pin a nível de instância (seção 4) — baixo risco hoje por não haver usuários reais, mas deve ser endereçada antes de haver programas reais de longa duração.
- Pendências de conteúdo já documentadas nas Etapas 5C/6B (10 exercícios sem perfil, 800 lacunas editoriais, 41 rascunhos sem vídeo/perfil, 80 relações sob aprovação `product_policy` sem revisão clínica individual) — nenhuma delas impede a ativação técnica; são, como já definido na 6B, pendências de conteúdo externas ao código.

## Veredito

### **PRONTO PARA ATIVAÇÃO NO BUILD NORMAL**

Toda a integração técnica está completa e verificada com evidência real — incluindo um problema crítico genuíno que foi encontrado e corrigido nesta etapa (incompatibilidade das Firestore Rules), não apenas assumido como resolvido. Typecheck, lint e as suítes completas (app e backend) permanecem na mesma baseline de sempre. A troca de ativação em si está isolada em uma única linha, documentada, e **deliberadamente não aplicada** — aguardando sua autorização explícita e separada, exatamente como pedido.
