# AJ Fit --- Safety Rules

## 1. Objetivo

Este documento define as regras transversais de segurança do motor de
personalização de treinos.

Ele não diagnostica condições clínicas e não substitui avaliação médica,
fisioterapêutica ou de outro profissional habilitado. Seu papel é
impedir que o motor aplique modificadores comuns quando os dados
disponíveis indicarem que a decisão exige restrição, revisão ou
bloqueio.

Regra fundamental:

``` text
SAFETY > ALL
```

Nenhum objetivo, preferência, nível de experiência, disponibilidade,
equipamento ou regra de volume pode sobrescrever uma constraint de
segurança.

------------------------------------------------------------------------

## 2. Estados de segurança

O motor deve trabalhar com estados explícitos:

``` text
CLEAR
CLEAR_WITH_CONSTRAINTS
NEEDS_REVIEW
BLOCKED
INSUFFICIENT_DATA
```

### `CLEAR`

Nenhum gate ou constraint especial foi ativado.

### `CLEAR_WITH_CONSTRAINTS`

O treino pode ser gerado, mas existem restrições protegidas.

### `NEEDS_REVIEW`

A automação não possui regra suficiente para produzir uma adaptação
confiável.

### `BLOCKED`

Uma regra P0 impede geração ou continuidade automática.

### `INSUFFICIENT_DATA`

Faltam dados necessários para avaliar um gate obrigatório.

------------------------------------------------------------------------

## 3. Ordem dos Safety Gates

``` text
1. restrições profissionais explícitas
2. red flags / sintomas de alerta
3. população especial
4. limitações declaradas relevantes
5. capacidade funcional / risco de queda
6. impacto
7. demais modificadores
```

Uma regra posterior nunca pode remover uma constraint criada
anteriormente.

------------------------------------------------------------------------

## 4. Restrições profissionais

Quando o usuário declarar orientação/restrição de profissional:

``` text
professional_restriction = P0
```

Exemplos conceituais:

-   não executar determinado movimento;
-   não realizar impacto;
-   limitar carga;
-   evitar determinada posição;
-   não treinar até nova liberação.

O AJ Fit não deve interpretar uma restrição explícita de maneira mais
permissiva.

Se a restrição não puder ser traduzida com segurança para as regras
existentes:

``` text
NEEDS_REVIEW
```

------------------------------------------------------------------------

## 5. Dor e sintomas durante exercício

O motor não deve assumir que toda dor possui a mesma origem.

Quando houver relato de dor ou sintoma problemático:

1.  identificar exercício/movimento associado;
2.  impedir progressão automática daquele estímulo até existir regra
    válida;
3.  tentar alternativa somente quando houver candidatos compatíveis;
4.  não diagnosticar a causa;
5.  retornar `NEEDS_REVIEW` quando a adaptação exigir interpretação
    clínica.

Não usar:

``` text
dor no joelho → exercício universal X
```

------------------------------------------------------------------------

## 6. Gestação --- `PREGNANCY_SAFETY_GATE`

Aplicável a T073--T078.

Dados mínimos conceituais:

-   acompanhamento pré-natal;
-   restrições profissionais;
-   complicações relevantes declaradas;
-   semana/estágio gestacional;
-   sintomas de alerta;
-   experiência prévia.

Red flags já previstas na biblioteca:

``` text
sangramento vaginal
tontura/desmaio
dor no peito
falta de ar incomum
contrações dolorosas regulares
perda de líquido
dor/inchaço importante em panturrilha
```

Na presença de red flag durante seleção/execução:

``` text
BLOCKED
```

e o produto deve orientar avaliação profissional apropriada em vez de
continuar adaptando o treino.

Experiência avançada nunca vence esse gate.

------------------------------------------------------------------------

## 7. Pós-parto --- `POSTPARTUM_SAFETY_GATE`

Aplicável a T079--T084.

Dados previstos:

-   tempo desde o parto;
-   tipo de parto;
-   complicações;
-   restrições profissionais;
-   dor;
-   cicatrização;
-   perda urinária/fecal;
-   peso/pressão vaginal;
-   sangramento anormal;
-   tontura/fraqueza incomum.

Princípios:

-   tempo desde o parto isolado não equivale a recuperação;
-   sintomas e restrições podem limitar progressão;
-   o motor não diagnostica diástase ou disfunção do assoalho pélvico;
-   quando o estado não puder ser classificado pelas regras existentes,
    usar `NEEDS_REVIEW`.

------------------------------------------------------------------------

## 8. Fragilidade --- `FRAILTY_SAFETY_GATE`

Aplicável a T085--T090.

Dados previstos:

-   dificuldade para caminhar;
-   necessidade de apoio;
-   quedas recentes/recorrentes;
-   instabilidade;
-   capacidade de subir degraus;
-   dificuldade nas atividades diárias;
-   restrições médicas;
-   sintomas cardiovasculares, respiratórios ou neurológicos declarados.

Regras:

-   idade cronológica isolada não ativa fragilidade;
-   necessidade de apoio gera constraint protegida;
-   risco de queda elevado impede progressões que removam estabilidade
    sem regra explícita;
-   preferência por exercícios em pé/unilaterais não vence necessidade
    de apoio.

------------------------------------------------------------------------

## 9. Pós-cirúrgico

É um **Safety Gate restritivo** e também uma futura fonte de modificação. A
entrada mínima é: estado da recuperação, região operada e liberação de retorno.

- `IN_PROGRESS`, `NOT_YET`, `UNSURE` ou liberação com restrições não podem ser
  neutralizados por objetivo, experiência, preferência ou duração;
- ausência de qualquer campo obrigatório produz `INSUFFICIENT_DATA`;
- cirurgia concluída e liberação sem restrições apenas satisfazem o gate de
  entrada; não criam uma prescrição clínica nem garantem compatibilidade;
- não inferir tipo de cirurgia, tecido, amplitude ou prazo pela região.

Como ainda não há família pós-cirúrgica T001--T090 nem regras aprovadas, a
implementação futura deverá retornar `NEEDS_REVIEW` quando não puder provar a
composição segura. Esta fase apenas coleta o contrato.

------------------------------------------------------------------------

## 10. Tontura/vertigem

O questionário coleta frequência e efeito declarado no equilíbrio. Sintoma
`CURRENT_OR_RECENT` ou equilíbrio `YES/UNKNOWN` entra na avaliação P0; histórico
ou ocorrência ocasional sem efeito de equilíbrio pode alimentar um futuro
modificador P2.

Não diagnosticar labirintite, não inferir causa e não assumir que "sentado =
seguro". Sem regra validada para resolver o estado, usar `NEEDS_REVIEW`; com
dado obrigatório ausente, `INSUFFICIENT_DATA`.

------------------------------------------------------------------------

## 11. Lipedema

Lipedema é MODIFIER + entrada de SAFETY. A coleta separa impacto nos exercícios
e existência de orientação profissional.

- diagnóstico/suspeita isolado não ativa `NO_IMPACT`, redução de volume ou
  incapacidade;
- impacto que interfere ou orientação profissional devem ser preservados no
  decision trace e nunca vencidos por preferência;
- `UNKNOWN/UNSURE` não é tratado como ausência de risco;
- sem regra específica aprovada, não produzir prescrição clínica automática.

------------------------------------------------------------------------

## 12. Limitações articulares

Para:

``` text
KNEE
HIP
SHOULDER
SPINE
WRIST
ELBOW
ANKLE
```

o sistema pode adaptar somente quando conhece:

-   movimentos que agravam;
-   restrições profissionais, se houver;
-   tolerância;
-   alternativas permitidas pelas regras.

Se apenas o nome da região estiver disponível, evitar inferência
excessiva.

------------------------------------------------------------------------

## 13. Coluna

`SPINE_LIMITATION` merece cautela especial.

Não tratar todas as condições de coluna como iguais e não criar regras
universais como:

``` text
coluna → sem agachamento
coluna → sem levantamento terra
coluna → somente máquinas
```

A decisão depende do problema declarado, movimento sintomático e
restrições existentes.

------------------------------------------------------------------------

## 14. Impacto

Quando `NO_HIGH_IMPACT` estiver ativo, registrar:

``` yaml
protected_constraints:
  - no_high_impact
```

Essa constraint deve sobreviver a:

-   preferência por corrida;
-   objetivo de emagrecimento;
-   condicionamento avançado;
-   sessão curta.

O estímulo cardiovascular pode ser preservado por outra modalidade.

------------------------------------------------------------------------

## 15. Equilíbrio e apoio

Quando:

``` text
BALANCE_SUPPORT_NEED = REQUIRED
```

registrar constraint protegida.

O sistema deve favorecer exercícios compatíveis com apoio/estabilidade e
impedir que modificadores de experiência ou preferência removam essa
proteção.

------------------------------------------------------------------------

## 16. Red flags em runtime

O motor de seleção e o treino em execução são momentos diferentes.

Se o produto permitir registrar sintomas durante a sessão, uma red flag
de runtime deve:

1.  interromper progressão automática;
2.  registrar o motivo;
3.  não sugerir simplesmente "trocar o exercício";
4.  acionar o fluxo de segurança apropriado.

------------------------------------------------------------------------

## 17. Reintrodução proibida

Exemplo:

``` text
MOD-SAF → remove exercício X
MOD-PREF → usuário gosta de X
```

Resultado obrigatório:

``` text
X continua removido
```

O mesmo vale para:

-   equipamento inexistente;
-   impacto bloqueado;
-   apoio obrigatório;
-   restrição profissional.

------------------------------------------------------------------------

## 18. Falha segura

Quando o motor não souber:

``` text
DO NOT IMPROVISE
```

Estados preferidos:

``` text
NEEDS_REVIEW
NO_SAFE_SUBSTITUTION
SAFETY_GATE_BLOCKED
INSUFFICIENT_DATA
```

------------------------------------------------------------------------

## 19. Logging

Toda decisão P0/P1 deve registrar no decision trace:

``` yaml
safety:
  gate: null
  state: CLEAR
  protected_constraints: []
  blocked_rules: []
  reason_codes: []
```

Evitar registrar texto clínico sensível desnecessário quando um reason
code for suficiente para o funcionamento.

------------------------------------------------------------------------

## 20. Testes mínimos

-   preferência tenta reintroduzir exercício bloqueado;
-   equipamento tenta forçar substituição incompatível;
-   gestação + avançado;
-   pós-parto + preferência estética;
-   fragilidade + exercício unilateral sem apoio;
-   no-high-impact + corrida preferida;
-   duas limitações simultâneas;
-   restrição profissional não mapeável;
-   falta de dados de gate obrigatório;
-   nenhum substituto válido.
