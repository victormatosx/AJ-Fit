# Checklist de Staging — Avaliação Física

## 1. Objetivo deste documento

Roteiro manual de validação da funcionalidade de Avaliação Física
(onboarding com data de nascimento, autenticação, questionário, cálculo de
idade, avaliação guiada/importada, Firestore) antes do release.

Execução obrigatória em Android e iOS, em dispositivo real (não apenas
simulador/emulador quando possível).

Este documento não substitui `07_plano_de_testes.md` — é específico desta
funcionalidade, no mesmo espírito.

---

# 2. Ambiente de execução

## Risco identificado — sem ambiente de staging separado

Este repositório possui um único projeto Firebase configurado
(`ajfit-2f321`, via `.env` → `EXPO_PUBLIC_FIREBASE_PROJECT_ID`). Não existe
`.firebaserc` nem um segundo projeto documentado em nenhum lugar do
repositório ou da pasta `docs/`.

**Isso significa que hoje não existe uma forma de rodar este checklist
"em staging" sem usar o mesmo projeto Firebase que presumivelmente é
produção.**

Antes de executar este checklist, o humano coordenador precisa decidir uma
das opções abaixo — este documento não escolhe por conta própria:

* criar um segundo projeto Firebase dedicado a staging e um `.env.staging`
  apontando para ele (recomendado);
* ou aceitar conscientemente que a validação abaixo roda contra o único
  projeto existente, com uma conta de teste dedicada e ciência de que
  qualquer dado gravado é real.

Enquanto essa decisão não for tomada, trate qualquer execução deste
checklist como acontecendo em produção.

---

# 3. Pré-requisitos

* Build de desenvolvimento (`npx expo run:android` / `npx expo run:ios`) —
  o app usa `expo-secure-store`/`expo-apple-authentication`, que exigem dev
  client, não funcionam no Expo Go.
* `firestore.rules` e `firestore.indexes.json` publicados no projeto usado
  para o teste (ver `08_log_de_evolucao.md` e seção 5 deste documento —
  sem o índice composto, `getAssessments` falha em runtime).
* Uma conta de teste nova (e-mail descartável) para os cenários de
  "usuário novo".
* Um documento de questionário legado pré-existente no Firestore do
  projeto de teste, criado manualmente com `age` e sem `birthDate` (ver
  §6.1), para os cenários de "usuário legado" — não é possível chegar a
  esse estado pela UI atual, que só grava `birthDate`.

---

# 4. Persona e dados de teste

Uma única persona cobre todos os cenários abaixo. Sempre que o passo pedir
"troque o sexo no modal", isso é uma seleção pontual dentro da Avaliação
Guiada — não altera o cadastro da persona.

## 4.1 Cadastro (onboarding)

| Campo | Valor |
|---|---|
| Sexo | Feminino |
| Data de nascimento | mesmo dia/mês de hoje, **ano atual − 27** (ex.: hoje 30/07/2026 → 30/07/1999) — resulta em 27 anos exatos no dia do teste |
| Altura | 165 cm |
| Peso | 60 kg |

Data de nascimento inválida para o teste negativo (§5, item 2): dia **31**,
mês **02** (fevereiro), ano atual − 27 — data que não existe em nenhum ano.

## 4.2 Avaliação guiada — JP7 Feminino (sexo do cadastro)

Dobras (mm): peitoral 14 · axilar média 15 · tricipital 16 · subescapular 12
· abdominal 15 · supra-ilíaca 14 · coxa 14. Peso 60,0 kg · altura 165 cm.

**Resultado esperado** (idade automática 27, fórmula JP7 fem. — docs/15 §7):
BF% **20,5** · IMC **22,0** · massa magra **47,7 kg** · massa gorda **12,3 kg**.

## 4.3 Avaliação guiada — JP3 Feminino

Dobras (mm): tricipital 20 · supra-ilíaca 20 · coxa 20. Peso 60,0 kg ·
altura 165 cm.

**Resultado esperado** (idade automática 27, fórmula JP3 fem. — docs/15 §6):
BF% **23,9** · IMC **22,0** · massa magra **45,7 kg** · massa gorda **14,3 kg**.

## 4.4 Avaliação guiada — JP7 Masculino (trocar sexo no modal)

Dobras (mm): peitoral 10 · axilar média 12 · tricipital 8 · subescapular 14
· abdominal 18 · supra-ilíaca 10 · coxa 15. Peso 82,0 kg · altura 178 cm.

**Resultado esperado** (idade automática 27, fórmula JP7 masc.):
BF% **12,4** · IMC **25,9** · massa magra **71,8 kg** · massa gorda **10,2 kg**.

## 4.5 Avaliação guiada — JP3 Masculino (trocar sexo no modal)

Dobras (mm): peitoral 15 · abdominal 15 · coxa 15. Peso 82,0 kg · altura 178 cm.

**Resultado esperado** (idade automática 27, fórmula JP3 masc.):
BF% **13,3** · IMC **25,9** · massa magra **71,1 kg** · massa gorda **10,9 kg**.

> Os quatro conjuntos de dobras acima são os MESMOS usados em
> `src/lib/__tests__/skinfoldCalculator.test.ts` — os valores de BF% ali
> foram calculados para idade 25/28/30/32; aqui foram recalculados para
> idade 27 (a que a persona de teste terá automaticamente). Para conferir a
> fórmula em si (não o resultado final), basta olhar o teste unitário
> correspondente.

## 4.6 Avaliação importada — com percentual

Peso 61,5 kg · altura 165 cm · BF 22,0% · água corporal 55% · metabolismo
basal 1400 kcal · gordura visceral 7. `measuredAt` = hoje.

## 4.7 Avaliação importada — sem percentual

Peso 59,8 kg · altura 165 cm · demais campos em branco. `measuredAt` = hoje
− 60 dias.

## 4.8 Datas para os testes de ordenação/retroatividade

| Cenário | `measuredAt` |
|---|---|
| Avaliação "hoje" | hoje |
| Avaliação retroativa (guiada) | hoje − 400 dias (idade automática nessa data = **26**, um ano a menos que a idade atual — confirma que o cálculo usa a data da avaliação, não a de hoje) |
| Duas avaliações mesmo dia | hoje − 10 dias, cadastradas em dois momentos diferentes (a segunda gravada deve aparecer primeiro, pelo desempate por `createdAt`) |
| Data futura (teste negativo) | qualquer data depois de hoje — deve ser bloqueada |

---

# 5. Usuário novo

| # | Passo | Resultado esperado | Status |
|---|---|---|---|
| 1 | Completar onboarding com a data de nascimento de §4.1 | Avança normalmente; idade não é mais perguntada como número | ☐ OK ☐ Falhou |
| 2 | Na pergunta de nascimento, tentar avançar com a data inválida (31/02) | Botão "Continuar" permanece desabilitado ou mensagem de erro; não avança | ☐ OK ☐ Falhou |
| 3 | Tentar informar uma data no futuro | Bloqueado ("DATA NO FUTURO") | ☐ OK ☐ Falhou |
| 4 | Criar a conta (e-mail/senha) | Conta criada, sem erro | ☐ OK ☐ Falhou |
| 5 | Abrir Avaliação Física pela primeira vez (Perfil → Avaliação Física) | Um único card de resumo com placeholders; ações de avaliação logo após Evolução e Histórico imediatamente depois, sem seção visual de Dobras cutâneas | ☐ OK ☐ Falhou |
| 6 | Abrir Avaliação Guiada pela primeira vez | Peso 60,0 kg aparece preenchido; altura, sexo e idade não são solicitados e continuam vindo internamente do cadastro | ☐ OK ☐ Falhou |
| 7 | Avaliação Guiada JP7 (dados §4.2) | Resultados batem com §4.2; toast "Avaliação salva com sucesso" | ☐ OK ☐ Falhou |
| 8 | Voltar para a tela e abrir Avaliação Guiada, protocolo JP3, com cadastro Feminino (dados §4.3) | Resultados batem com §4.3 sem solicitar sexo, idade ou altura | ☐ OK ☐ Falhou |
| 9 | Em uma conta de staging com cadastro Masculino, abrir Avaliação Guiada JP7 (dados §4.4) | Dobras exigidas usam automaticamente o conjunto masculino; resultados batem com §4.4 | ☐ OK ☐ Falhou |
| 10 | Na conta com cadastro Masculino, usar protocolo JP3 (dados §4.5) | Resultados batem com §4.5 sem solicitar sexo, idade ou altura | ☐ OK ☐ Falhou |
| 11 | Importar avaliação com percentual (dados §4.6) | Salva; card resumo mostra BF 22,0% | ☐ OK ☐ Falhou |
| 12 | Importar avaliação sem percentual (dados §4.7) | Salva; no histórico, BF/massa magra/massa gorda aparecem como "—", nunca "0" | ☐ OK ☐ Falhou |
| 13 | Fechar o app completamente e reabrir | Sessão mantida, sem voltar para onboarding, dados carregam | ☐ OK ☐ Falhou |
| 14 | Reabrir Avaliação Física | As 6 avaliações salvas aparecem no histórico | ☐ OK ☐ Falhou |
| 15 | Logout | Volta para tela de login | ☐ OK ☐ Falhou |
| 16 | Login novamente com a mesma conta | Todas as avaliações e o cadastro (idade correta) voltam a aparecer | ☐ OK ☐ Falhou |

---

# 6. Usuário legado

## 6.1 Preparação (não é possível pela UI)

No Firestore do projeto de teste, criar manualmente um documento em
`users/{uid}/questionnaires/{id}` com `answers` contendo `age: 30` (sem
`birthDate`) e os demais campos do questionário preenchidos, `version: 1`,
`createdAt` = uma data de alguns anos atrás.

| # | Passo | Resultado esperado | Status |
|---|---|---|---|
| 1 | Login com a conta legada preparada em §6.1 | Sem crash, app carrega normalmente | ☐ OK ☐ Falhou |
| 2 | Abrir Avaliação Física | Peso/altura do questionário aparecem em "DADOS DO CADASTRO INICIAL" | ☐ OK ☐ Falhou |
| 3 | Abrir Avaliação Guiada | Idade automática aparece (aproximada, ancorada no `createdAt` do questionário — não trava em 30 para sempre) — conferir que é plausível, não `NaN`/negativa | ☐ OK ☐ Falhou |
| 4 | Salvar uma avaliação guiada com `measuredAt` = hoje | Salva normalmente, idade automática coerente com a aproximação | ☐ OK ☐ Falhou |
| 5 | Salvar uma avaliação guiada retroativa (`measuredAt` = hoje − 1 ano) | Idade automática nessa data é ~1 ano menor que a de hoje | ☐ OK ☐ Falhou |
| 6 | Login na mesma conta em um segundo dispositivo (ou reinstalar) | Mesmos dados, mesma idade aproximada, nenhuma avaliação duplicada | ☐ OK ☐ Falhou |

---

# 7. Ordenação e evolução

| # | Passo | Resultado esperado | Status |
|---|---|---|---|
| 1 | Registrar avaliação com `measuredAt` = hoje, depois outra com `measuredAt` = hoje − 400 dias (§4.8) | Histórico mostra a de hoje primeiro (ordenado por `measuredAt` desc, não por ordem de criação) | ☐ OK ☐ Falhou |
| 2 | Card "ÚLTIMA AVALIAÇÃO" | Mostra a de `measuredAt` mais recente, não a criada por último | ☐ OK ☐ Falhou |
| 3 | Registrar duas avaliações com o mesmo `measuredAt` (hoje − 10 dias, §4.8) | Ambas aparecem; a criada por último aparece primeiro entre as duas (desempate por `createdAt`) | ☐ OK ☐ Falhou |
| 4 | Card "EVOLUÇÃO" após pelo menos 2 avaliações | Mostra deltas de peso/BF%/massa magra em relação à avaliação anterior (não à primeira) | ☐ OK ☐ Falhou |
| 5 | Card "EVOLUÇÃO" logo após a §4.7 (avaliação sem BF%) ser a mais recente | Delta de BF%/massa magra/massa gorda aparece como "—", nunca "0" ou uma variação inventada | ☐ OK ☐ Falhou |
| 6 | Histórico completo ("VER HISTÓRICO COMPLETO") com 7+ avaliações | Lista completa, ordenada, sem duplicatas, sem travar | ☐ OK ☐ Falhou |

---

# 8. Erros e rede

| # | Passo | Resultado esperado | Status |
|---|---|---|---|
| 1 | Ativar modo avião antes de abrir Avaliação Física | Estado de erro claro ("Não foi possível carregar suas avaliações") com botão "TENTAR NOVAMENTE" — não fica carregando para sempre nem quebra | ☐ OK ☐ Falhou |
| 2 | Com internet de volta, tocar "TENTAR NOVAMENTE" | Carrega normalmente | ☐ OK ☐ Falhou |
| 3 | Ativar modo avião, preencher uma avaliação guiada válida e tocar Salvar | Mensagem **"Falha ao salvar"** + sugestão de checar a conexão — sem termos técnicos (sem "Firestore", código de erro, stack) | ☐ OK ☐ Falhou |
| 4 | Reconectar e tentar salvar a mesma avaliação novamente | Salva normalmente, sem duplicata da tentativa anterior (a tentativa offline não deve ter gravado nada) | ☐ OK ☐ Falhou |
| 5 | Simular escrita OK + recarregamento da tela falhando (ex.: cortar a rede logo após tocar Salvar, antes da lista atualizar) | Mensagem **"Avaliação salva, mas não foi possível atualizar os dados agora"** (ou equivalente) — nunca a mesma mensagem de "Falha ao salvar" | ☐ OK ☐ Falhou |
| 6 | Após o cenário 5, fechar e reabrir a tela de Avaliação Física | A avaliação salva aparece no histórico — confirma que não houve perda de dado, só atraso na atualização da tela | ☐ OK ☐ Falhou |
| 7 | Tocar "Salvar Avaliação" duas vezes rapidamente (duplo toque) | Apenas uma avaliação é criada; botão fica desabilitado/"Salvando…" no segundo toque | ☐ OK ☐ Falhou |
| 8 | Sessão expirada / regra de permissão negada (ex.: revogar acesso manualmente no console, se aplicável ao ambiente de teste) | Erro tratado na tela, sem crash; usuário não vê dados de outra conta | ☐ OK ☐ Falhou |

---

# 9. UI

| # | Passo | Resultado esperado | Status |
|---|---|---|---|
| 1 | Abrir teclado nos campos de peso/altura/dobras | Campo permanece visível, sem ficar coberto pelo teclado | ☐ OK ☐ Falhou |
| 2 | Rolar os modais (Guiada e Importada) do topo ao fim | Rolagem suave, nenhum elemento cortado e ação de salvar sempre fixa no rodapé | ☐ OK ☐ Falhou |
| 3 | Abrir o seletor de data do Novo Registro em iOS e Android, inclusive em tela pequena | Picker nativo abre com a data atual, permite escolher datas anteriores, bloqueia datas futuras e atualiza o campo compacto | ☐ OK ☐ Falhou |
| 3a | Testar os campos DIA/MÊS/ANO da Avaliação Importada em tela pequena e grande | Campos legíveis, não sobrepostos | ☐ OK ☐ Falhou |
| 4 | Alternar modo claro/escuro do sistema, se o app já suportar | Layout permanece legível (ou confirmar que o app é fixo em modo escuro, sem quebra) | ☐ OK ☐ Falhou |
| 5 | Preencher "Observações" da avaliação importada com um texto longo (200+ caracteres) | Campo aceita e não quebra o layout | ☐ OK ☐ Falhou |
| 6 | Testar valor extremo válido de dobra (ex.: 60mm) e valor inválido (0 ou negativo) | Extremo válido aceito e calcula; inválido bloqueado com destaque visual (shake/borda vermelha) | ☐ OK ☐ Falhou |
| 7 | Observar estado de carregamento inicial da tela | `ActivityIndicator` visível brevemente, sem "flash" de tela vazia incorreta | ☐ OK ☐ Falhou |
| 8 | Observar toasts de sucesso/aviso/erro (verde/laranja/vermelho) | Cores e ícones diferentes para cada caso, texto legível, desaparece sozinho | ☐ OK ☐ Falhou |

---

# 10. Critérios de aprovação

## Bloqueadores de release

* `firestore.rules` e/ou `firestore.indexes.json` não publicados no
  projeto usado em produção.
* Qualquer crash em qualquer passo acima (Android ou iOS).
* Avaliação duplicada em qualquer cenário (duplo toque, retry após
  refresh falho, retry após escrita offline).
* Usuário acessando avaliações/questionário de outra conta.
* Qualquer resultado de cálculo (BF%, IMC, massa magra, massa gorda)
  divergente do valor documentado em §4 ou dos testes unitários.
* Tela de Avaliação Física inutilizável (não abre, trava, ou não permite
  salvar) em Android ou iOS.
* Mensagem de "Falha ao salvar" exibida quando a avaliação na verdade foi
  salva (ou vice-versa).

## Problemas não bloqueadores

* Pequeno desalinhamento visual (espaçamento, alinhamento de texto).
* Ausência de paginação no histórico (irrelevante com poucos registros;
  reavaliar se algum usuário acumular centenas de avaliações).
* Ausência de teste E2E automatizado (cobertura atual é só unitária, ver
  §12 do relatório final).
* Idade aproximada (não exata) para usuários legados sem `birthDate` —
  comportamento documentado e esperado (`docs/08_log_de_evolucao.md`).

---

# 11. Registro de execução

| Campo | Valor |
|---|---|
| Data da execução | |
| Executor | |
| Build (commit/versão) | |
| Projeto Firebase usado | |
| Dispositivo Android | |
| Versão Android | |
| Dispositivo iOS | |
| Versão iOS | |
| Resultado geral | ☐ Aprovado ☐ Aprovado com ressalvas ☐ Reprovado |
| Observações | |
