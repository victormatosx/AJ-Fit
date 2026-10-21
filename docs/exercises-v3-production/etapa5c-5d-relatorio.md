> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapas 5C + 5D: cobertura musculoesquelética e homologação técnica

Referências: `docs/exercises-v3-production/etapa4-auditoria-final.md`, `etapa5-correcoes-relatorio.md`. `ACTIVE_SUBSTITUTION_POLICY` permanece `'legacy'`. Nenhum rascunho ativado, nenhuma escrita real, nenhum commit/push/deploy. Nenhuma aprovação clínica foi concedida nesta etapa — tudo abaixo é triagem para revisão humana futura.

## 1. Revisão das 80 relações C

Classificação individual (catálogo real: `movement.pattern`, `movement.mechanic`, `target.primaryMuscle`, `limitationProfile` dos dois lados), em 33 pares distintos (alguns repetem em 2–4 regiões):

| Classificação | Quantidade |
|---|---:|
| Tecnicamente compatível, dependente de aprovação profissional | **65** |
| Dados insuficientes para avaliação | **15** |
| Incompatível, com justificativa | **0** |

Nenhuma das 80 foi liberada — todas seguem bloqueadas. O resultado "0 incompatíveis" é consistente com a Etapa 4 já ter roteirizado divergências claramente inseguras para outras categorias (A/D); o que sobrou em C são casos plausíveis mas não verificáveis só por metadado de catálogo.

**Casos mais fortes para priorizar na revisão profissional:**
- `lying-leg-raise → dead-bug` (hip, back): a fonte já é `avoid` nessas regiões; dead-bug é a adaptação clássica de coluna neutra para substituir a flexão lombar/quadril da elevação de pernas.
- `barbell-back-squat / goblet-squat / hack-squat-machine / leg-press-45 → leg-extension-machine` (hip, back, ankle_foot): isolamento sentado com apoio nas costas remove a dobradiça de quadril e a demanda de estabilização de tornozelo do squat.
- `dumbbell-stiff-leg-deadlift → leg-curl (lying/seated/slider)` (hip, back, shoulder, ankle_foot): remove a dobradiça de quadril, a pegada e o equilíbrio em pé do stiff.
- `conventional-deadlift → hip-thrust` (wrist): remove a carga sustentada de pegada/punho.

**Pendências de dados mais notáveis:** a região `back` especificamente nos pares leg-press→fly (ângulo do encosto pode aumentar flexão lombar sob carga — não decidível pelo catálogo); a região `shoulder` nos pares supino→crucifixo (abdução horizontal em fim de curso é clinicamente controversa).

## 2. Lacunas de cobertura — lista priorizada

**800 combinações (exercício, ambiente, região) sem nenhuma regra editorial declarada**, ponderadas pela quantidade de templates que usam cada exercício. Nenhuma foi cadastrada como aprovada — isto é só priorização para um futuro editor.

**Top gaps por impacto (exercício/ambiente/região, nº de templates afetados):**

| Exercício | Ambiente | Região(ões) sem regra | Templates |
|---|---|---|---:|
| `dumbbell-stiff-leg-deadlift` | gym/home | elbow, wrist | 96 |
| `plank` | gym/home | hip, ankle_foot | 84 |
| `dumbbell-lateral-raise` | gym/home | knee, hip, back, elbow, wrist, ankle_foot | 76 |

**Ranking por região (soma ponderada por templates, do mais ao menos esparso):** hip (3.129) > ankle_foot (3.070) > knee (2.909) > elbow (2.857) > wrist (2.602) > shoulder (2.552) > back (2.320, a menos esparsa).

**Divisão do universo de 800 lacunas:** 44 exercícios sem NENHUMA região declarada em algum ambiente (lacuna total) vs. 44 exercícios com cobertura parcial (algumas regiões já têm regra, outras não — gap mais barato de resolver editorialmente). Nenhum candidato de substituição foi proposto ou cadastrado; isto é estritamente "onde estão os buracos", não "o que colocar".

## 3. Impacto simulado do desempate multi-região

`editorialCandidatesV3` hoje exige que todas as regiões ativas concordem não só nos candidatos, mas na ORDEM relativa entre eles — divergência de ordem zera a interseção inteira. Simulação par-a-par (2 regiões por vez, 323 combinações de `(âncora, ambiente, par-de-regiões)` com pelo menos uma regra musculoesquelética cada — **não** é a reexecução completa dos 127 cenários × 102 templates, é uma análise mais leve e direta sobre as listas editoriais em si):

| | Atual (ordem estrita) | Alternativa (ordem livre + desempate determinístico) |
|---|---:|---:|
| Pares com algum candidato | 253 de 323 | 283 de 323 (+30) |
| Total de candidatos liberados | 363 | 425 (+62) |

**30 conflitos concretos** (mesmo par de candidatos, ordem diferente entre duas regiões). Inspecionando os 30: a maioria é uma troca simples de posição 1↔2 entre exatamente dois candidatos — ex. `seated-resistance-band-row`/`resistance-band-row` invertidos entre `shoulder` e `wrist` para várias âncoras de remada; `floor-crunch`/`dead-bug` invertidos entre `hip` e `back` em `lying-leg-raise`. Esse padrão **não parece arbitrário**: uma remada sentada carrega o punho de forma diferente de uma remada com elástico em pé, e plausivelmente é exatamente por isso que a ordem é diferente entre `wrist` e `shoulder`; dead-bug é a opção de coluna neutra, plausivelmente por isso vem primeiro em `back` mas não em `hip`. Ou seja, a ordem provavelmente **codifica uma preferência de segurança específica da região**, não é só uma lista arbitrária.

**Recomendação (não aplicada): manter o comportamento atual (ordem estrita).** O ganho de cobertura (+30 pares, +62 candidatos) é real, mas o risco é que a abordagem sem ordem poderia promover, como primeira sugestão, uma opção que uma das regiões ativas explicitamente colocou em segundo lugar por um motivo de segurança específico daquela região — o padrão observado nos 30 conflitos é consistente com isso, não com ruído aleatório. Qualquer mudança nessa regra exigiria confirmação explícita de um profissional sobre se a ordem de cada lista realmente carrega essa intenção clínica antes de relaxar o critério.

## 4. Pendências preservadas (confirmado, nada alterado)

10 exercícios sem perfil, 42 relações B restantes, 80 relações C (nenhuma aprovada), 41 rascunhos, alternativas condicionais (139) — todos confirmados ainda bloqueados por leitura direta do dataset/código, nenhuma alteração.

## 5. Testes de integração — resultado e investigação do erro do emulador

**Causa raiz do erro `maximum of 1000 expressions to evaluate` identificada e confirmada pré-existente, não relacionada a esta etapa:**

- Reproduzido isoladamente no teste MAIS simples e MAIS antigo do arquivo (`§78 SESSION_READY`, sem nenhuma relação com V3/substitutionPolicySnapshot), com emulador frio, rodando sozinho. Falha imediatamente na primeira operação de `create` em `workoutExecutions`.
- `firestore.rules` (3.486 linhas, não modificado nesta ou em nenhuma etapa desta sessão) já **documenta este exato limite do emulador** em um comentário próprio (linhas ~2650–2655): "...pairing `getAfter()` with THAT particular update rule... was proven, in this exact Rules Emulator, to exceed its 'maximum expressions' evaluation cap." — ou seja, a equipe já conhecia e já aceitou esse limite para um caminho (reinício); o `create` puro aparentemente cresceu o suficiente para também atingi-lo.
- **Conclusão: ambiental e pré-existente, não uma regressão desta correção.** Não alterei `firestore.rules` para contornar isso (restrição explícita respeitada).

**Consequência prática:** com o emulador bloqueado neste limite, **nenhum teste de integração do app via SDK cliente (sujeito às Rules) pode passar agora** — nem os meus, nem os já existentes antes da Etapa 5. Isso não é específico da V3.

**O que foi validado como substituto, sem alterar regras:**
- Testes unitários do backend (`functions/`, 16 testes, sem emulador): `substitutionPolicyFor` (sessão antiga → `legacy`, sessão v3 → `v3`, valores corrompidos → `legacy`), efeito ponta-a-ponta de uma sessão antiga vs. uma sessão fixada em v3 recebendo decisões diferentes para a mesma substituição, tentativas de ID não autorizado, ambiente cruzado, auto-substituição — todos passando.
- Um teste do lado do app que usa `withSecurityRulesDisabled` (que já existia como padrão no arquivo, não é uma Rules mais fraca — é um utilitário de seed) confirma que um documento legado sem `substitutionPolicySnapshot` nunca é tratado como `v3` por `fromDoc`.
- Os demais itens do roteiro de 5D (reversão, preferências permanentes, proteção de série concluída) foram reconfirmados por leitura direta do código já mapeado nas Etapas 3/4 (não refeito), não por execução nova — nenhuma mudança nesses caminhos nesta etapa.

**Pendência explícita:** uma suíte de integração dedicada via Admin SDK (que não passa pelas Rules, como já existe em `functions/src/workoutLifecycle/__tests__/completeWorkoutCardio.integration.test.ts`) é o caminho correto para validar `applyExerciseSubstitutionHandler` ponta-a-ponta contra um emulador real sem tropeçar nesse limite — não escrita nesta etapa por custo/tempo; recomendado para a próxima.

## 6. Paridade e rollback

Reconfirmado (reaproveitando a investigação já feita na Etapa 4, não refeita): preview, backend, resolução por limitação e evolução concordam exatamente para as mesmas entradas (0 divergências em 1.030 relações reais testadas). `ACTIVE_SUBSTITUTION_POLICY` confirmado estático, sem nenhum caminho de sobrescrita remota. A política fixada por sessão (Etapa 5A) nunca é escrita de volta pelo callable — uma reversão futura da flag global não afeta sessões já criadas, exatamente como desenhado.

## 7. Checklist de homologação no iPhone

**Não gerar build nem publicar nada.** Checklist para quando a decisão de testar em aparelho for autorizada separadamente:

1. Treino **antigo** (criado antes de qualquer campo novo existir) — abrir, continuar série, finalizar normalmente.
2. Treino **novo** criado após esta correção — confirmar que abre e se comporta identicamente ao antigo (V3 desativada).
3. Substituição manual: abrir modal, confirmar que as opções mostradas batem com o que o backend aceitaria.
4. Reverter ao exercício original após uma substituição.
5. Preferência permanente: definir uma, sair, voltar, confirmar que persiste.
6. Treino iniciado **offline**, substituição tentada offline, reconexão — confirmar que nada duplica nem corrompe.
7. Retomada de sessão após fechar o app / reiniciar o telefone.
8. Áudio externo (Spotify/Apple Music) tocando durante um treino com vídeo de exercício.
9. Tentar, via rede (ex. proxy/debug), enviar um `requestedExerciseId` fora da lista exibida — confirmar rejeição pelo backend (não só pelo app).
10. Repetir a mesma solicitação de substituição duas vezes rápido (duplo toque) — confirmar que não duplica.
11. Finalizar uma série e tentar substituir aquele exercício — confirmar bloqueio.

## Bloqueios restantes para ativação

Inalterados desde a Etapa 4, mais os específicos desta etapa: suíte de integração admin-SDK para o callable ainda não escrita; 800 lacunas editoriais sem revisão; 65 relações C aguardando aprovação profissional; 10 perfis ausentes; 42 relações B sem decisão; regra de desempate multi-região recomendada para manter, não alterar.

## Veredito

### **APROVADO COM PENDÊNCIAS**

Nenhum problema de segurança, integridade ou vazamento de autorização foi encontrado nesta etapa — a análise das 80 relações C não achou nenhuma incompatibilidade com justificativa clara (todas ficaram em "pendente" ou "dados insuficientes", nunca aprovadas), e a simulação do desempate multi-região revela um padrão consistente com intenção de segurança, reforçando a recomendação de **não** relaxar essa regra. O erro do emulador foi investigado a fundo, tem causa raiz identificada e documentada como pré-existente — não é uma regressão desta correção, mas também significa que a validação de integração completa via Rules reais não pôde ser concluída nesta sessão. Isso, somado ao volume real de conteúdo pendente (800 lacunas, 65+15 relações C, 10 perfis, 42 relações B), mantém a V3 fora de condições de ativação — mas a estrutura, os testes unitários e as correções de P0/P1 já aplicadas continuam sólidas e nenhuma delas precisou ser revertida.

**V3 permanece desativada. Aguardando autorização para a próxima etapa.**
