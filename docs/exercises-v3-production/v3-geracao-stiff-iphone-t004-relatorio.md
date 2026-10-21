# Questionário confirmado do iPhone — T004 / joelho

**A geração continua bloqueada. As correções locais que recuperaram 66 configurações não resolvem este questionário. Nenhum deploy, build, OTA, commit ou push foi executado.**

## 1. Respostas e fluxo real

Reproduzidas exatamente as dimensões confirmadas: masculino (`m`), hipertrofia (`gain_muscle`), intermediário (`intermediate` → `INTERMEDIATE`), cinco dias, academia (`gym`), condição musculoesquelética ativa e região `knee`.

`AnalyzingScreen.tsx` chama `prepareWorkoutProgramLocally(quiz)` antes da autenticação. Esse serviço deriva o nível inicial, usa o roteador ativo v1.27, o seletor e o compositor reais. O teste novo chama esse serviço, com V3 global **sem override**, e também compara seu resultado ao roteador real. Firebase está protegido no teste por um getter que falha caso esse caminho local tente acessá-lo.

Não se usou T093 como premissa. O seletor retornou:

```text
population_route:conventional
beginner_route:false
goal_family:hypertrophy_body_composition
sex:male
environment:gym
effective_days:5
template_id:T004
```

Os demais campos usados para completar a fixture (como duração 60, inventário e dias da semana vazios, sem prioridade muscular) não são informações confirmadas do aparelho e não mudam essa seleção ou a impossibilidade descrita abaixo. O contrato v1.27 não usa o inventário respondido na geração e a academia considera o equipamento executável.

## 2. Terceira sessão: Legs

O `2` do reason code é o índice da sessão começando em zero.

| Ordem | Exercício original | Dose do template |
|---|---|---|
| 1 | Agachamento Livre — `barbell-back-squat` | 3 × 6–10 |
| 2 | Leg Press 45 — `leg-press-45` | 3 × 10–15 |
| 3 | Mesa Flexora — `lying-leg-curl-machine` | 3 × 10–15 |
| 4 | Cadeira Extensora — `leg-extension-machine` | 3 × 12–15 |
| 5 | Stiff com Halteres — `dumbbell-stiff-leg-deadlift` | 3 × 8–12 |
| 6 | Panturrilha em Pé — `standing-calf-raise-machine` | 6 × 12–15 |
| 7 | Prancha — `plank` | 3 × até a falha técnica |

## 3. Causa exata e todas as rejeições relevantes

O perfil aprovado do **Stiff com Halteres** marca joelho como **`adapt`**. Portanto, o original não é terminal seguro e não pode ser mantido para contornar a ausência de alternativa.

Na planilha original, aba **Limitações - academia**, linha **55**, a única relação primária de Stiff com Halteres para joelho é:

| Prioridade | Substituto aprovado editorialmente | Resultado operacional |
|---|---|---|
| 1 | Stiff Máquina — `stiff-leg-deadlift-machine` | Rejeitado: **`LIMITATION_PROFILE_MISSING`** |

A mesma relação está no dataset V3 com `approval: editorial`, `conditions: []`, `state: listed`. O exercício está no catálogo operacional; a rejeição **não** é causada por equipamento, família, padrão de movimento, mecânica, prioridade ou ausência de aprovação da relação.

O candidato **não possui o objeto `limitationProfile`** no catálogo local efetivamente usado pela geração. O artefato técnico também contém **zero entradas em `profiles`** para esse ID. Menções em listas auxiliares não constituem perfil clínico executável.

A decisão necessária é uma revisão responsável do exercício, com perfil válido e estados nas sete regiões (`knee`, `hip`, `back`, `shoulder`, `elbow`, `wrist`, `ankle_foot`), protocolo/versão e metadados de aprovação. A decisão específica para joelho precisa ser tomada por quem está autorizado a aprovar esse conteúdo; não foi presumida como `compatible` nem copiada de outro exercício. Se a revisão concluir que o candidato não é seguro para joelho, ele deve continuar indisponível.

A aba **Alternativas Condicionais**, linhas **32–33**, contém Dobradiça de Quadril e Ponte de Glúteos, com condições de público adaptado/regra futura. Não são aprovações automáticas para este intermediário. As opções da aba de substituições comuns também não autorizam uma relação para joelho. Nenhuma delas foi promovida a fallback.

### Além do perfil ausente: três slots disputam dois destinos

A mesma terceira sessão exige substituir estes três originais, todos com joelho `adapt`:

| Origem | Lista primária aprovada para joelho/academia |
|---|---|
| Agachamento Livre | Leg Press 90; Stiff Máquina — linhas 124–125 |
| Leg Press 45 | Leg Press 90; Stiff Máquina — linhas 169–170 |
| Stiff com Halteres | Stiff Máquina — linha 55 |

A união dessas listas contém **apenas dois exercícios distintos para três slots obrigatórios**. Não existe alocação completa sem duplicidade, mesmo antes de aplicar os bloqueios de perfil. Esse limite foi adicionado à regressão usando as listas reais do dataset, sem inventar um perfil hipotético.

No trace atual, o Agachamento consome Leg Press 90; o Leg Press 45 rejeita Leg Press 90 com `LIMITATION_CANDIDATE_VISITED` e Stiff Máquina com `LIMITATION_PROFILE_MISSING`; o Stiff rejeita Stiff Máquina por perfil ausente. A busca completa local confirma que trocar a ordem das escolhas não resolve a insuficiência.

**Logo, aprovar somente um perfil de Stiff Máquina não é promessa de liberação do T004.** Também é necessária uma decisão editorial sobre a falta de uma configuração completa autorizada para esses slots. Não foram inventadas alternativas, repetidos exercícios, ignorada a limitação, omitidos slots ou alterada a frequência para escolher outro template.

## 4. Resultado da reprodução e efeito das correções anteriores

O artefato compilado preservado da publicação anterior, ainda sem as correções locais de alocação/diagnóstico, retorna `INVALID_CONFIGURATION`. O código local corrigido retorna `NO_SAFE_CONFIGURATION`. Ambos devolvem estes mesmos três reason codes:

```text
MUSCULOSKELETAL_NO_SUBSTITUTE:2:dumbbell-stiff-leg-deadlift
MUSCULOSKELETAL_NO_SUBSTITUTE:2:leg-press-45
MUSCULOSKELETAL_NO_SUBSTITUTE:4:dumbbell-stiff-leg-deadlift
```

O onboarding registra apenas `result.reasonCodes[0]`; isso explica por que o erro informado no iPhone mostrava apenas o Stiff na terceira sessão, embora existam outros bloqueios, inclusive na quinta sessão.

Nenhum resultado contém `plan`. A correção local das 66 configurações continua válida para seus outros cenários, mas **T004/joelho não integra essas recuperações**. Ela não fabrica uma terceira alternativa. O status controlado melhora o diagnóstico e evita retries técnicos; não é considerado sucesso de geração.

Nenhuma correção adicional de lógica de produção foi aplicada nesta rodada, porque a investigação exata não encontrou uma relação aprovada e segura sendo indevidamente rejeitada para o Stiff. Foram adicionadas regressões do caso confirmado e atualizado o diagnóstico/documentação. O perfil e a planilha não foram alterados.

## 5. Testes desta rodada

- Serviço real do onboarding: **5/5 testes do arquivo**, incluindo o novo caso confirmado; T004 selecionado, sete exercícios da terceira sessão conferidos, três bloqueios preservados e ausência de plano.
- Dispatcher real do backend: **17/17 testes do arquivo**, incluindo o novo caso T004 com o mesmo diagnóstico.
- Callable **`initializeWorkoutProgramV127Handler` no Firestore Emulator**: **1/1 caso direcionado aprovado**, 98 demais casos do arquivo ignorados nessa execução direcionada. Questionário exato persistido apenas no emulador; callable rejeita com os três reason codes e não cria nenhum programa, instância, ciclo, estado de lifecycle ou ponteiro de programa ativo.
- TypeScript do app: limpo.
- TypeScript das Functions, usando o compilador já instalado no workspace `functions`: limpo (`--noEmit`).
- ESLint dos três arquivos de teste alterados: zero erros; 13 avisos de estilo já existentes no arquivo extenso de integração.
- Planilha: SHA-256 continua idêntico ao registrado no dataset.

Não se reexecutou a suíte inteira porque nenhuma lógica de produção mudou nesta rodada. A rodada anterior havia concluído 7.919 testes aprovados no app com as mesmas 44 falhas antigas, 2.028 aprovados no backend sem falhas, e matriz de 13.056 cenários. Os resultados direcionados acima são os novos testes com as respostas confirmadas.

Evidência estruturada: [v3-geracao-stiff-iphone-t004-validacao.json](v3-geracao-stiff-iphone-t004-validacao.json).

## 6. Publicação e veredito

As correções anteriores continuam **somente locais**. Quando autorizada sua publicação, as Functions dependentes são:

1. `initializeWorkoutProgramV127` — composição e diagnóstico da geração inicial.
2. `authorizeWorkoutLifecycleMutation` — geração autoritativa compartilhada.
3. `installActiveWorkoutProgram` — instalação/fallback compartilhando o gerador.

Não é necessário publicar Rules ou `applyExerciseSubstitution` por essas correções. **Publicar essas três Functions não resolve a falta de conteúdo/perfil do T004/joelho.** Nesta rodada não houve deploy, build de qualquer tipo, OTA, commit, push ou escrita em dados reais.

**CONTINUA BLOQUEADO — T004/joelho não gera um programa completo e seguro com o conteúdo aprovado atual.** Causas comprovadas: perfil ausente de Stiff Máquina e insuficiência de destinos distintos para três substituições obrigatórias. O caso do proprietário está identificado; T093 permanece apenas como reprodução histórica diferente.
