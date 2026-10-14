# Prompt — Redesign visual da tela Nutrição / Dieta (AJ Fit)

## Objetivo

Aplique **somente o novo visual** à tela **Nutrição** (aba de dieta) e a todas as telas/sheets abertas a partir dela: Diário, Resumo semanal, Registrar refeição, Detalhe da refeição (com trocar opção), Plano alimentar, Plano arquivado, Histórico de planos, Favoritos, Refeições salvas, Criar alimento, Criar receita e os estados da aba (carregando, sem perfil, sem plano, bloqueado, gerando, erro). **Toda a lógica do projeto deve continuar exatamente como está.**

## Regras obrigatórias — NÃO mexer na lógica

1. **Não altere** hooks, stores, serviços, chamadas ao Firestore/backend, Cloud Functions, regras de segurança, tipos, validações, cálculos nutricionais ou navegação.
2. **Não altere** a geração do plano alimentar, o cálculo de metas (TMB, gasto diário, ajuste do objetivo, macros), a busca de alimentos (base própria / Open Food Facts / código de barras), a lógica de registro no diário, a marcação “seguiu a recomendação”, os limites de favoritos/refeições salvas/ingredientes, o histórico/restauração de planos nem o bloqueio de segurança (gestação/amamentação).
3. **Não crie** estado, dados ou regras novas. Tudo que aparece na tela já deve vir dos dados que o app tem hoje. Se algum elemento do novo design depender de um dado que não existe (ex.: fibra, média semanal, % de aderência ao plano, última pesagem, rendimento de receita), **não invente**: deixe o elemento de fora ou use o campo equivalente que já existe, e **me avise no final** listando o que ficou pendente.
4. **Mantenha** todos os handlers (`onPress`, callbacks, props) ligados às mesmas funções de hoje. Mude só onde e como o botão aparece.
5. **Mude apenas** a camada de apresentação: JSX/estrutura de `View`/`Text`/`Pressable`, estilos (`StyleSheet`), cores, fontes, espaçamentos, ícones, ordem visual dos blocos e animações puramente visuais.
6. O **código de referência da seção 6** é um protótipo web com dados falsos (`useNu()`, `NU_PLAN`, `NU_FOODS`, `NU_WEEK`, `NU_DIARY0`, `NU_ALTS`, `nuCalc`, `nuDayTotal`, pilha `push/back` etc.). **Use-o só para copiar o visual** (medidas, cores, textos, estados visuais). **Não copie a lógica dele** nem substitua funções do projeto pelas do protótipo.
7. Antes de editar, **leia os arquivos atuais** da tela de dieta e mapeie qual componente do projeto corresponde a cada bloco do novo design. Faça a troca visual bloco a bloco, tela por tela.
8. Se precisar de uma lib só de visual (ex.: `react-native-svg` para os anéis, `expo-linear-gradient`, fontes Anton / Archivo / JetBrains Mono), pode instalar. Não instale nada que mude a lógica.
9. **Não altere** Home, Treino, Evolução nem nenhuma outra tela. Se já existir um componente compartilhado parecido (faixa rolante, anel, header), **não mexa nele** — crie/estilize a versão da tela Nutrição sem afetar as outras.
10. Ao final, rode o type-check/lint e me entregue um resumo: arquivos alterados, o que mudou visualmente em cada um e o que não deu para aplicar sem mexer na lógica.

## Mapeamento esperado (design → o que já existe no app)

- **Cabeçalho “NUTRIÇÃO.”** → título atual da tela, no mesmo formato do Treino.
- **Faixa rolante** → só valores que o app já calcula (meta kcal, consumido, proteína, refeições registradas/planejadas, refeições que seguiram o plano, dias com registro na semana, média semanal). Item sem dado disponível → omita.
- **Anel “Faltam X kcal”** → meta diária e total consumido do dia que o app já calcula.
- **4 anéis de macros** → totais e metas atuais (proteína, carbo, gordura, fibra). Rótulo de status (“OK”, “BAIXO”, “ACIMA” etc.) só se o app já tiver essa classificação.
- **Próxima refeição** → a refeição do plano que o app já considera a próxima (primeira sem registro, ou a regra atual). **Registrar refeição** abre o registro já pré‑preenchido com a opção recomendada (mesmo fluxo de hoje). **Ver detalhes e alternativas** abre o detalhe da refeição.
- **Refeições de hoje** → mesma lista e ordem das refeições do plano; toque abre o detalhe. Link **Diário** abre o diário.
- **Semana (7 anéis)** → dados semanais que o app já tem; link **Resumo** abre o resumo semanal.
- **Atalhos** → só os destinos que já existem no app (plano completo, favoritos, refeições salvas, histórico, criar alimento, criar receita). Atalho sem tela correspondente → omita e me avise.
- **Botão flutuante “+”** → mesma ação de registrar refeição de hoje.
- **Todas as sheets/telas internas** → mesmos dados, validações, limites e ações; troque só o visual.

---

## 1. Tokens de design

**Cores**
- Fundo da tela e das telas internas: `#020010`
- Painel inferior (bottom sheet): `#0b0922`
- Azul primário (botões principais): `#0b70f9` · azul destaque (anel kcal, hoje): `#4da3ff` · azul brilho: `#1f82ff`
- Alerta / acima da meta (>110%): `#ffb454`
- Destrutivo (remover): `#ff8a80`
- Texto: `#ffffff` · forte‑suave `rgba(255,255,255,0.88)` (anéis de macro, barras) · secundário `rgba(255,255,255,0.65)` · fraco `rgba(255,255,255,0.45)` · legenda `rgba(255,255,255,0.38)` · muito fraco `rgba(255,255,255,0.3)`
- Linha fina (hairline): `1px rgba(255,255,255,0.07)`
- Superfície sutil (inputs, avisos, atalhos): `rgba(255,255,255,0.03–0.06)`
- Trilho dos anéis: `rgba(255,255,255,0.07)`

**Tipografia**
- Display: **Anton**, MAIÚSCULAS, line-height ~1 — usada **só para números** (kcal, gramas) e para o título “NUTRIÇÃO.” (este com `skewX(-8deg)`).
- UI: **Archivo** — títulos de linha 14.5–16px peso 600/700, corpo 13–14.5px.
- Mono: **JetBrains Mono** — legendas de seção (`cap`): 10px, letter-spacing 1.6, MAIÚSCULAS, cor `rgba(255,255,255,0.38)`.

**Espaçamento**
- Padding horizontal: **24px** (header da aba usa 22px, igual ao Treino).
- Entre seções da aba: **36–40px**. Legenda de seção → conteúdo: **16px**.
- Linhas de lista: padding vertical **13–14px**, separadas por hairline. **Sem cards/caixas** em volta das listas.

**Princípios do visual “clean”**
- Uma ação principal por tela (botão azul sólido). Ações secundárias = botão fantasma ou link de texto.
- Nenhum gradiente em cards, nenhuma tipografia inclinada fora do título, nenhum ícone decorativo.
- Edição de item sempre em **painel inferior** (bottom sheet), nunca modal centralizado. Nunca dois painéis ao mesmo tempo.
- Telas internas abrem em **tela cheia** (fundo `#020010`) com barra superior simples: voltar ← à esquerda, título centralizado 16px/600.

---

## 2. Componentes base

- **Anel (`NuRing`)** — SVG, trilho `rgba(255,255,255,0.07)`, progresso com `strokeLinecap: round`, começa no topo (rotate −90°), anima de 0 ao valor em 1.3s `cubic-bezier(.2,.8,.2,1)`. Cor padrão `#4da3ff`; acima de 110% fica `#ffb454`. Variações: `dashed` (trilho tracejado 1.2px `rgba(255,255,255,0.22)`, dasharray 2 4 — dia sem registro), `faint` (opacidade 0.4 — dia futuro). Conteúdo centralizado dentro.
- **Botão principal (`NcBtn`)** — largura 100%, padding 17, raio 12, 16px/600, fundo `#0b70f9`, texto branco. Desabilitado: opacidade 0.4. **Fantasma**: fundo `rgba(255,255,255,0.06)`, borda 1px `rgba(255,255,255,0.08)`, 14.5px.
- **Pílula (`NcPill`)** — padding `9 15`, raio 999, 13px/600. Ativa: fundo branco, texto `#020010`. Inativa: transparente, borda `rgba(255,255,255,0.14)`, texto `rgba(255,255,255,0.6)`. Em linha com rolagem horizontal, gap 6.
- **Painel inferior (`NcPanel`)** — overlay `rgba(2,0,16,0.65)` (fade 0.2s) + painel `#0b0922`, borda superior `rgba(255,255,255,0.08)`, raio `22 22 0 0`, padding `10 24 34`, sobe em 0.3s. Alça 36×4 `rgba(255,255,255,0.2)` centralizada, 20px acima do conteúdo. Toque fora fecha.
- **Tela interna (`NcSheet`)** — header `padding 58 14 6`: botão voltar 42×42 (chevron 22), título central 16px/600, espaçador 42. Conteúdo rolável `padding 0 24 40`. Rodapé opcional fixo: `padding 14 24 30`, hairline em cima.
- **Navegador (`NcNav`)** — dois botões circulares 40×40 com hairline e chevrons 17px (desabilitado = opacidade 0.2); centro: rótulo 17px/700 + sub 12px fraco.
- **Barra fina (`NcThin`)** — altura 4, raio 2, trilho `rgba(255,255,255,0.07)`, preenchimento cresce da esquerda (0.6s). Opcional: marcador vertical da meta (1.5×10, `rgba(255,255,255,0.5)`).
- **Stepper (`NcStepper`)** — botões circulares 48×48 (borda `rgba(255,255,255,0.14)`) com − e +; centro: valor 24px/700 + sub 12px fraco.
- **Linha (`C2Row`)** — rótulo 14.5px/600 + sub 12.5px fraco à esquerda; valor 14px `rgba(255,255,255,0.8)` à direita; chevron 15px `rgba(255,255,255,0.3)` se tocável; hairline embaixo.
- **Toast** — topo (top 58), centralizado, some em ~1.9s.

---

## 3. Aba Nutrição (de cima para baixo)

Container rolável, sem padding lateral no header/faixa (eles têm o próprio).

### 3.1 Cabeçalho (idêntico ao Treino)
`padding 62 22 24`, `space-between`, `alignItems flex-end`.
- Esquerda: rótulo mono 10px, letter-spacing 2, cor `rgba(255,255,255,0.32)`: `SEG · 13 OUT · SEMANA 07` (data local + semana do programa). Abaixo (marginTop 8) **`NUTRIÇÃO.`** em Anton 34px com skew −8°.
- Direita: quadrado 46×46, raio 12, gradiente 135° `#1f82ff → #0b70f9`, sombra `0 0 18 rgba(11,112,249,0.45)`, iniciais **AJ** Anton 16px.

### 3.2 Faixa rolante
Só no estado “com plano”. Bordas sup./inf. 1px `rgba(255,255,255,0.06)`, padding vertical 8, marginBottom 4. Texto mono 10px, letter-spacing 2, cor `rgba(255,255,255,0.32)`, loop infinito direita→esquerda em **22s**, conteúdo duplicado, gap 36. Valores em `#4da3ff`:
`META **2.150 KCAL** · CONSUMIDO **1.240 KCAL** · PROTEÍNA **92/150G** · REFEIÇÕES **3/5** · SEGUIU O PLANO **2/3** · SEMANA **5/6 DIAS** · MÉDIA **2.030 KCAL**`

### 3.3 Anel principal
Wrapper `padding 0 24 110`. Anel 210px, traço 12, centralizado, marginTop 28, progresso = consumido/meta. Dentro:
- legenda `FALTAM` (ou `ACIMA` se passou) · número Anton 52px (branco; `#ffb454` se acima) · legenda `KCAL` · `1.240 de 2.150` 12px fraco.

### 3.4 Macros
Linha centralizada, gap 18, marginTop 30. 4 colunas de 64px: anel 60px, traço 4.5, cor `rgba(255,255,255,0.88)`; dentro número Anton 17px + `/150g` 9.5px. Abaixo: legenda mono 8.5px (`PROTEÍNA`, `CARBO`, `GORDURA`, `FIBRA`) e status mono 8px (`#ffb454` se fora da faixa).

### 3.5 Próxima refeição
marginTop 36, paddingTop 24, hairline em cima. Some quando todas as refeições estão registradas.
- Linha: legenda `PRÓXIMA REFEIÇÃO` à esquerda · nome do horário (`Almoço`) 12.5px fraco à direita.
- Nome da opção 22px/700 (marginTop 12).
- Ingredientes em texto corrido 13.5px fraco: `Frango grelhado (150 g), Arroz integral (120 g), …`.
- Grade de 4 colunas (kcal · Proteína · Carbo · Gordura) com hairline em cima/embaixo e divisórias verticais: número Anton 20px + unidade 12px fraca; rótulo 11.5px fraco.
- Botão principal **+ Registrar refeição** (marginTop 20).
- Link centralizado 13.5px/600 `rgba(255,255,255,0.65)`: **Ver detalhes e alternativas**.

### 3.6 Refeições de hoje
marginTop 40. Cabeçalho: legenda `REFEIÇÕES DE HOJE` + link `Diário ›` (12px/600, `rgba(255,255,255,0.7)`).
Cada refeição do plano é uma linha (padding 14, hairline entre linhas):
- Ponto 8px: branco cheio se registrada; vazado (borda `rgba(255,255,255,0.3)`) se não.
- Nome 14.5px/600 + sub 12px: `2 itens · seguiu a recomendação` / `Próxima refeição` / `Sem registro`.
- Direita: kcal Anton 17px (ou `—` em `rgba(255,255,255,0.3)`) + ` / 650` 11.5px (meta da refeição) · chevron.

### 3.7 Semana
marginTop 40. Cabeçalho: legenda `SEMANA` + link `Resumo ›`.
Grade de 7 colunas, gap 6: anel 38px, traço 3.5 (hoje em `#4da3ff`, demais `rgba(255,255,255,0.88)`; sem registro = tracejado; futuro = faint) + dia mono 8.5px (hoje branco).
Rodapé 12.5px fraco: `Média de 2.030 kcal · 5 de 6 dias com registro`.

### 3.8 Atalhos
marginTop 40. Legenda `ATALHOS`. Grade 2 colunas, gap 8. Cada atalho: padding 16, raio 16, fundo `rgba(255,255,255,0.03)`, hairline, minHeight 88, ícone 18px `rgba(255,255,255,0.6)` em cima e rótulo 13.5px/600 embaixo.
Itens: Plano completo · Favoritos · Refeições salvas · Histórico de planos · Criar alimento · Criar receita.

### 3.9 Botão flutuante
56×56, raio 18, `right 22`, `bottom 14`, gradiente vertical `#1f82ff → #0b70f9`, ícone + 22px, sombra `0 8 22 rgba(0,0,0,0.45)`. Visível com plano e no estado bloqueado.

### 3.10 Estados da aba (padding `34 22 40`)
- **Carregando**: skeleton com blocos `rgba(255,255,255,0.06)` pulsando (1.4s).
- **Sem perfil**: `// PERFIL NUTRICIONAL` · título 22px/700 · texto 14px · lista “JÁ TEMOS” (chave/valor com hairline) · CTA **Criar perfil nutricional**.
- **Sem plano**: `// PERFIL PRONTO` · `Gere seu plano alimentar` · lista “SEU PERFIL” · CTA **Gerar meu plano**.
- **Bloqueado**: ícone escudo em quadrado 44px (borda/fundo azul translúcido) · `Geração de plano indisponível` · CTA fantasma **Abrir diário alimentar**.
- **Gerando**: `// GERANDO PLANO` · `Estamos montando sua dieta` · 4 passos com bolinha 22px (feito = azul com check; atual = ponto azul piscando; futuro = opacidade 0.35) · nota fraca `Pode sair desta tela. Avisamos quando o plano estiver pronto.` Os passos devem refletir o progresso real, se o app expõe; senão, mostre só o título e um indicador.
- **Erro**: ícone alerta · `Não foi possível gerar seu plano` · CTA **Tentar novamente**.

---

## 4. Telas internas (todas em `NcSheet`)

### 4.1 Diário
- `NcNav`: `Hoje` / dia da semana, sub com a data. Volta até 6 dias; avançar desabilitado em hoje.
- Vazio: `Nada registrado neste dia` + `Dias sem registro não entram na média da semana.` + (só hoje) botão **+ Registrar refeição**.
- Total: número Anton 40px + ` kcal` · à direita `meta 2.150` · barra fina azul · linha 13px fraca `Proteína **92g** · Carbo **140g** · Gordura **38g**` (valores brancos 600).
- Por refeição (marginTop 30): nome 16px/700 + kcal à direita, hairline embaixo; nota opcional com check `Seguiu a recomendação do plano`; itens (nome 14.5px + porção 12.5px fraca + kcal à direita); link **+ Adicionar alimento** (só hoje).
- Rodapé: `Toque em um alimento para editar, mover ou remover.`
- **Painel de edição do item**: nome 18px/700 + refeição · stepper (porção ou gramas, sub com g e kcal) · `MOVER PARA` + pílulas das refeições · **Salvar** · link vermelho **Remover do diário**.

### 4.2 Resumo semanal
- `NcNav`: `Esta semana` / `Semana passada` + intervalo de datas.
- Anel 170px, traço 11: `MÉDIA POR DIA` · Anton 42px · `de 2.150 kcal`. Abaixo: frase 15px/600 (`Em média, você ficou dentro da meta.` / `…X% abaixo/acima da meta.`) + `Considerando N dias com registro.`
- `DIA A DIA`: 7 linhas — dia (34px) · barra fina com marcador da meta · kcal ou `Sem registro`/`—`. Legenda do marcador: `meta diária`.
- `CONSISTÊNCIA`: Dias com registro · Refeições registradas · Seguiu a recomendação (% das refeições).
- `MACROS · MÉDIA POR DIA`: Proteína / Carboidrato / Gordura `110 / 150 g`.
- `PESO`: Última pesagem `77,0 kg · −0,3 kg` + botão fantasma **Ver evolução do peso** (abre a tela que já existe).

### 4.3 Registrar refeição
- `REFEIÇÃO` + pílulas das refeições (pré‑seleciona a primeira sem registro, ou a recebida).
- Se veio de uma opção do plano: aviso `rgba(255,255,255,0.04)` raio 12: `Baseado em **Nome**. Confira as quantidades antes de registrar.`
- Busca: altura 50, raio 12, fundo `rgba(255,255,255,0.05)`, ícone lupa, placeholder `Buscar alimento`, à direita ícone de código de barras (ou X para limpar).
- `ADICIONADOS` (itens na cesta, com check branco em círculo 22px), `N RESULTADOS`, `FAVORITOS`, `RECENTES`. Linha de alimento: nome + `165 kcal em 100 g · origem` + botão + circular 30px.
- Sem resultado: `Não encontramos “x”` + fantasma **Criar este alimento**.
- Links no fim: **Criar alimento · Criar receita**.
- Rodapé (com itens): `640 kcal` 15px/700 + `3 alimentos em Almoço` · botão **Registrar** (largura automática).
- **Painel do alimento**: nome + estrela (favoritar) · pílulas de unidade (Gramas, porções do alimento) · stepper · kcal Anton 34px + macros 13px · **Adicionar/Atualizar** · link vermelho **Remover** (se editando).
- **Painel do código de barras**: área 220px raio 16 com linha branca de varredura animada + `Aponte a câmera para o código do produto`. Use a câmera/scanner real do app.

### 4.4 Detalhe da refeição
- Centro: `META DA REFEIÇÃO` · `550–650` Anton 40px + ` kcal` · (se registrou) `Você registrou 480 kcal hoje`.
- `OPÇÃO RECOMENDADA`: nome 21px/700 · `kcal · P · C · G` 13px fraco · ingredientes em linhas (nome, nota, quantidade à direita) · botão **Registrar no diário** + botão quadrado 54px com estrela (salvar refeição).
- Fantasma **⇄ Trocar por outra opção** → painel `Por que você quer trocar?` com rádios (Não gosto de um alimento · Não tenho os ingredientes · Quero algo mais rápido · Quero algo que sacie mais · Quero variar); se “não gosto”, pílulas com os ingredientes; **Ver alternativas** (desabilitado sem escolha).
- Carregando alternativas: spinner 30px (borda `rgba(255,255,255,0.12)`, topo branco) + `Buscando alternativas…`.
- `ALTERNATIVAS` + motivo · cada opção no mesmo formato (botões fantasma) · link **Voltar para a recomendada**.
- Nota final 12px: `Quantidades e nutrientes são estimativas. Ao registrar, você confirma o que realmente comeu.`

### 4.5 Plano alimentar / Plano arquivado
- Arquivado: aviso com cadeado `Só para consulta. Restaure para voltar a usar.` + rodapé **Restaurar este plano**.
- Anel 170px cheio: `META DIÁRIA` · Anton 44px · `kcal`. Linha de macros (P, Carbo, Gordura, Fibra) Anton 22px + rótulo 12px, gap 26.
- `REFEIÇÕES`: linhas com nome, opção (sub) e faixa `550–650`.
- `COMO CALCULAMOS`: Metabolismo basal · Gasto diário estimado · Ajuste para o objetivo · Gerado em.
- Fantasma **✦ Gerar novo plano** + `O plano atual vai para o histórico.` + link **Ver histórico de planos**.
- Aviso final 12px: `Este plano é uma orientação geral e não substitui o acompanhamento de um nutricionista.`

### 4.6 Histórico de planos
Texto `Restaurar reativa um plano antigo exatamente como ele era, sem gerar um novo.` + linhas (data, `kcal · ajuste`) com selo à direita: **Ativo** (pílula branca) ou **Restaurar** (pílula com borda).

### 4.7 Favoritos
Pílulas **Alimentos / Receitas** + contador `5 de 20` à direita. Linhas com estrela cheia para remover. Item indisponível: sub `Não está mais disponível` + X. Vazio: `Nenhum alimento favorito` + `Toque na estrela ao registrar para salvar aqui.`

### 4.8 Refeições salvas
`Opções completas que você salvou` + `2 de 10`. Cada uma (padding 22, hairline): legenda do horário · nome 17px/700 · ingredientes · macros · **Registrar no diário** (fantasma) + botão lixeira 54px.

### 4.9 Criar alimento
`NOME` + input (altura 52, raio 12, fundo `rgba(255,255,255,0.05)`) · `VALORES EM 100 G`: linhas Calorias/Proteína/Carboidrato/Gordura/Fibra (opcional) com input numérico 84×40 alinhado à direita + unidade. Nota `Só você vê este alimento. Ele aparece na busca do diário.` Rodapé **Salvar alimento**.

### 4.10 Criar receita
`NOME` · `INGREDIENTES` + `2 de 6` · linhas com −/+ circulares 30px, gramas, X · **+ Adicionar ingrediente** (painel de busca) · `RENDIMENTO · OPCIONAL` (Peso final, Porções) · bloco central `POR PORÇÃO`/`RECEITA INTEIRA` com kcal Anton 38px e macros. Rodapé **Salvar receita**.

---

## 5. Notas de tradução para React Native

`div` → `View`, texto → `Text`, `button` → `Pressable`, `input` → `TextInput`. Anéis → `react-native-svg` (`Circle` com `strokeDasharray/strokeDashoffset`, animados com Reanimated). Gradientes → `expo-linear-gradient`. `box-shadow` → `shadow*`/`elevation`. Faixa rolante → `Animated`/Reanimated em loop. Painel inferior → o bottom sheet que o projeto já usa (só reestilize) ou `Modal` transparente com animação de subida. Alvos de toque ≥ 44px (use `hitSlop` nos links e botões pequenos). Sem emojis na UI final. Ícones usados: chevron-left/right, plus, minus, check, x, search, barcode, star, star-fill, bookmark, list, history, pot, swap, sparkles, lock, trash, shield, alert — use os equivalentes da biblioteca de ícones do projeto.

---

## 6. Código de referência (protótipo web)

O código abaixo é o protótipo React (web) que gerou este layout. **Use apenas como referência visual** (medidas, cores, estados e textos). **Ignore toda a lógica e os dados dele** — a lógica do projeto é a que vale. Onde o protótipo usa `useNu()`, constantes `NU_*` ou funções `nu*`, use os hooks, props e serviços que o projeto já tem, sem alterá-los. Na aba principal, a versão válida é a **clean** (`sheetStyle = 'clean'`, componentes com sufixo `2`).

### 6.1 CSS global (tokens, tipografia, CTA, keyframes)

```css
/* AJ FIT v2 — athletic poster identity */
:root {
  --bg: #020010;
  --bg-2: #060220;
  --accent: #0b70f9;
  --accent-hi: #4da3ff;
  --text: #ffffff;
  --mute: rgba(255,255,255,0.55);
  --faint: rgba(255,255,255,0.32);
  --hair: rgba(255,255,255,0.08);
  --f-display: 'Anton', 'Arial Narrow', sans-serif;
  --f-ui: 'Archivo', system-ui, sans-serif;
  --f-mono: 'JetBrains Mono', ui-monospace, monospace;
}

html, body {
  margin: 0; padding: 0;
  background:
    radial-gradient(1100px 700px at 25% 0%, #0a0530 0%, transparent 55%),
    radial-gradient(900px 600px at 85% 100%, #051236 0%, transparent 55%),
    #030118;
  min-height: 100vh;
  font-family: var(--f-ui);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
button { font-family: inherit; cursor: pointer; border: 0; background: none; color: inherit; padding: 0; }

/* ── Display type ─────────────────────────────── */
.aj2-display {
  font-family: var(--f-display);
  text-transform: uppercase;
  font-weight: 400;
  letter-spacing: 0.5px;
  line-height: 0.95;
}
.aj2-it { display: inline-block; transform: skewX(-8deg); }

.aj2-label {
  font-family: var(--f-mono);
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--faint);
}
.aj2-label b { color: var(--accent-hi); font-weight: 500; }

/* Outline number */
.aj2-outline {
  font-family: var(--f-display);
  color: transparent;
  -webkit-text-stroke: 1.5px rgba(255,255,255,0.22);
  line-height: 0.9;
}

/* ── Segmented power bar ─────────────────────────────── */
.aj2-seg { display: flex; gap: 3px; }
.aj2-seg i {
  flex: 1; height: 7px; display: block;
  background: rgba(255,255,255,0.09);
  transform: skewX(-22deg);
  border-radius: 1px;
  transition: background 0.3s, box-shadow 0.3s;
}
.aj2-seg i.on {
  background: linear-gradient(90deg, #0b70f9, #4da3ff);
  box-shadow: 0 0 8px rgba(11,112,249,0.7);
}
.aj2-seg i.hot {
  background: #fff;
  box-shadow: 0 0 12px rgba(255,255,255,0.8);
}

/* ── HUD corner frame ─────────────────────────────── */
.aj2-frame { position: relative; }
.aj2-frame::before, .aj2-frame::after {
  content: ''; position: absolute; width: 14px; height: 14px;
  border-color: rgba(77,163,255,0.65); border-style: solid; z-index: 3;
  pointer-events: none;
}
.aj2-frame::before { top: 8px; left: 8px; border-width: 1.5px 0 0 1.5px; }
.aj2-frame::after { bottom: 8px; right: 8px; border-width: 0 1.5px 1.5px 0; }

/* ── Cards ─────────────────────────────── */
.aj2-card {
  background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015));
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px;
}
.aj2-cut {
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%);
  border-radius: 16px 16px 0 16px;
}

/* ── CTA ─────────────────────────────── */
.aj2-cta {
  width: 100%; height: 58px;
  background: linear-gradient(180deg, #1f82ff, #0b70f9);
  color: #fff;
  font-family: var(--f-display);
  font-size: 17px; letter-spacing: 1.5px; text-transform: uppercase;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
  border-radius: 12px 12px 0 12px;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  box-shadow: 0 10px 30px rgba(11,112,249,0.45), inset 0 1px 0 rgba(255,255,255,0.35);
  transition: transform 0.15s, filter 0.15s;
}
.aj2-cta:hover { transform: translateY(-1px); filter: brightness(1.08); }
.aj2-cta:active { transform: translateY(0); }
.aj2-cta.ghost {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: none;
  font-family: var(--f-ui); font-weight: 600; font-size: 14px;
  letter-spacing: 0.2px; text-transform: none;
  clip-path: none; border-radius: 14px;
}

/* ── Slash divider label ─────────────────────────────── */
.aj2-slash {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--f-mono); font-size: 10px; letter-spacing: 2.5px;
  color: var(--faint); text-transform: uppercase;
}
.aj2-slash::before { content: '//'; color: var(--accent-hi); font-weight: 700; }

/* ── Scan stripe texture (used sparsely) ───────────── */
.aj2-stripes {
  background-image: repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 10px);
}

/* ── Keyframes ─────────────────────────────── */
@keyframes aj2-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes aj2-sweep {
  0% { transform: translateX(-130%) skewX(-20deg); }
  60%, 100% { transform: translateX(230%) skewX(-20deg); }
}
@keyframes aj2-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
@keyframes aj2-glow {
  0%,100% { filter: drop-shadow(0 0 24px rgba(11,112,249,0.5)); }
  50% { filter: drop-shadow(0 0 54px rgba(11,112,249,0.9)); }
}
@keyframes aj2-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }

/* Progress photos: blur ONLY filled slots (privacy). Empty placeholders stay clear. */
image-slot.aj2-private[data-filled]::part(image) {
  filter: blur(15px);
  transform: scale(1.08);
}
@keyframes aj2-scan {
  0% { top: 14%; opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { top: 86%; opacity: 0; }
}
@keyframes aj2-spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes aj2-pop {
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes aj2-ring-out {
  0% { transform: scale(0.7); opacity: 0.8; }
  100% { transform: scale(1.5); opacity: 0; }
}
@keyframes aj2-confetti {
  0% { transform: translate(0,0) rotate(0deg); opacity: 1; }
  100% { transform: translate(var(--tx,0), var(--ty,0)) rotate(var(--rot,180deg)); opacity: 0; }
}
@keyframes aj2-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes aj2-spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes aj2-shake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60% { transform: translateX(4px); }
}

.aj2-noscroll::-webkit-scrollbar { display: none; }
.aj2-noscroll { scrollbar-width: none; }

/* image-slot inside device */
image-slot {
  --is-bg: rgba(255,255,255,0.03);
  --is-border: rgba(255,255,255,0.1);
}

@keyframes aj2-flicker { 0%,100% { transform: scale(1,1); } 35% { transform: scale(0.97,1.05); } 65% { transform: scale(1.02,0.98); } }
@keyframes aj2-nudge { 0%,100% { box-shadow: 0 0 0 rgba(11,112,249,0); } 50% { box-shadow: 0 0 26px rgba(11,112,249,0.35); } }
@keyframes aj2-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }

```

### 6.2 Formatadores e constantes visuais

```jsx
// AJ FIT v2 — Nutrição · dados, átomos, aba principal e estados
const NP = 22;
const NU_HI = '#4da3ff';
const NU_WARN = '#ffb454';
const nuInt = n => Math.round(n).toLocaleString('pt-BR');
const nuDec = n => (Math.round(n * 10) / 10).toLocaleString('pt-BR');
const nuNorm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const nuCount = n => n === 0.5 ? '½' : nuDec(n);

```

### 6.3 Aba Nutrição — shell, faixa, anel, home com plano e estados

```jsx
function NutritionScreen({ portal, initial = 'plan', onOpenProgress, sheetStyle = 'clean' }) {
  const [st, setSt] = React.useState(initial);
  React.useEffect(() => setSt(initial), [initial]);
  React.useEffect(() => { if (st !== 'loading') return; const id = setTimeout(() => setSt('plan'), 1600); return () => clearTimeout(id); }, [st]);
  const [diary, setDiary] = React.useState(NU_DIARY0);
  const [favFoods, setFavFoods] = React.useState(['banana', 'aveia', 'whey', 'panqueca', 'gone']);
  const [favMeals, setFavMeals] = React.useState([
    { id: 'fm1', slot: 'breakfast', opt: { name: 'Panqueca de banana com whey', foods: [['Panqueca de banana e aveia', '1 porção'], ['Whey protein', '1 scoop']], t: { kcal: 316, p: 33, c: 31, g: 6.6 } } },
    { id: 'fm2', slot: 'dinner', opt: { name: 'Omelete de legumes com arroz', foods: [['Omelete', '3 ovos'], ['Arroz integral', '120 g'], ['Legumes refogados', '100 g']], t: { kcal: 548, p: 30, c: 52, g: 22 } } },
  ]);
  const [activePlan, setActivePlan] = React.useState(NU_PLAN.id);
  const [stack, setStack] = React.useState([]);
  const [toast, setToast] = React.useState(null);
  const tRef = React.useRef();

  const ctx = React.useMemo(() => {
    const show = msg => { clearTimeout(tRef.current); setToast({ msg, k: Date.now() }); tRef.current = setTimeout(() => setToast(null), 1900); };
    return {
      diary, setDiary, favFoods, favMeals, activePlan, setActivePlan, toast: show, onOpenProgress, setSt,
      push: (kind, props = {}) => setStack(s => [...s, { kind, props, k: Date.now() }]),
      replace: (kind, props = {}) => setStack(s => [...s.slice(0, -1), { kind, props, k: Date.now() }]),
      back: () => setStack(s => s.slice(0, -1)),
      closeAll: () => setStack([]),
      toggleFood: id => setFavFoods(f => f.includes(id) ? f.filter(x => x !== id) : f.length >= 20 ? f : [...f, id]),
      isFavMeal: name => favMeals.some(m => m.opt.name === name),
      toggleFavMeal: (opt, slot) => setFavMeals(f => {
        if (f.some(m => m.opt.name === opt.name)) { show('Removida das refeições salvas'); return f.filter(m => m.opt.name !== opt.name); }
        show('Salva em refeições salvas');
        return [{ id: 'fm' + Date.now(), slot, opt }, ...f].slice(0, 10);
      }),
      removeFavMeal: id => setFavMeals(f => f.filter(m => m.id !== id)),
      addItems: (slot, items, followed = null) => setDiary(d => ({ ...d, [slot]: { followed: d[slot]?.items.length ? null : followed, items: [...(d[slot]?.items || []), ...items.map((i, n) => ({ ...i, id: 'n' + Date.now() + n }))] } })),
    };
  }, [diary, favFoods, favMeals, activePlan, onOpenProgress]);

  // só o topo da pilha fica visível (nunca dois modais ao mesmo tempo); os de baixo seguem montados
  const layer = (
    <NuCtx.Provider value={ctx}>
      {stack.map((s, i) => {
        const C = (sheetStyle === 'clean' && window[NU_SHEETS[s.kind] + '2']) || window[NU_SHEETS[s.kind]];
        return C ? <div key={s.k} style={{ position: 'absolute', inset: 0, display: i === stack.length - 1 ? 'block' : 'none' }}><C {...s.props}/></div> : null;
      })}
      {toast && <NuToast key={toast.k} msg={toast.msg}/>}
    </NuCtx.Provider>
  );

  return (
    <NuCtx.Provider value={ctx}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'auto' }} className="aj2-noscroll">
          <div style={{ padding: '62px 22px 24px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div className="aj2-label">{NU_TODAY} · SEMANA 07</div>
              <Display size={34} style={{ marginTop: 8 }}>NUTRIÇÃO.</Display>
            </div>
            <div style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg, #1f82ff, #0b70f9)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px rgba(11,112,249,0.45)' }}>
              <span className="aj2-display" style={{ fontSize: 16 }}>AJ</span>
            </div>
          </div>
          {st === 'plan' && <NuTicker/>}
          <div key={st} style={{ animation: 'aj2-rise 0.3s both' }}>
            {st === 'loading' && <NuSkeleton/>}
            {st === 'plan' && <NuHomePlan/>}
            {st === 'noProfile' && <NuNoProfile/>}
            {st === 'noPlan' && <NuNoPlan/>}
            {st === 'blocked' && <NuBlocked/>}
            {st === 'generating' && <NuGenerating/>}
            {st === 'genError' && <NuGenError/>}
          </div>
        </div>
        {(st === 'plan' || st === 'blocked') && (
          <button onClick={() => ctx.push('register')} aria-label="Registrar refeição" style={{
            position: 'absolute', right: NP, bottom: 14, width: 56, height: 56, borderRadius: 18,
            background: 'linear-gradient(180deg,#1f82ff,#0b70f9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 22px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}><Icon name="plus" size={22} color="#fff" stroke={2.2}/></button>
        )}
      </div>
      {portal && ReactDOM.createPortal(layer, portal)}
    </NuCtx.Provider>
  );
}

const NU_SHEETS = {
  meal: 'NuMealDetail', register: 'NuRegister', diary: 'NuDiary', plan: 'NuPlanFull', history: 'NuHistory',
  weekly: 'NuWeekly', favFoods: 'NuFavFoods', favMeals: 'NuFavMeals', createFood: 'NuCreateFood', createRecipe: 'NuCreateRecipe',
};

// faixa no mesmo formato da aba Treino, com dados da dieta
function NuTicker() {
  const nu = useNu();
  const tot = nuDayTotal(nu.diary);
  const meals = NU_PLAN.meals.filter(m => nu.diary[m.slot]?.items.length);
  const fol = meals.filter(m => nu.diary[m.slot].followed).length;
  const week = NU_WEEK.map(d => d.today ? { ...d, kcal: tot.kcal } : d);
  const logged = week.filter(d => d.kcal != null), elapsed = week.filter(d => !d.future).length;
  const avg = logged.reduce((a, d) => a + d.kcal, 0) / (logged.length || 1);
  const b = { color: '#4da3ff' };
  return (
    <div style={{ overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '8px 0', marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 36, whiteSpace: 'nowrap', width: 'max-content', animation: 'aj2-ticker 22s linear infinite', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: 2, color: 'var(--faint)' }}>
        {[0, 1].map(k => (
          <React.Fragment key={k}>
            <span>META <b style={b}>{nuInt(NU_PLAN.kcal)} KCAL</b></span>
            <span>CONSUMIDO <b style={b}>{nuInt(tot.kcal)} KCAL</b></span>
            <span>PROTEÍNA <b style={b}>{nuInt(tot.p)}/{NU_PLAN.p}G</b></span>
            <span>REFEIÇÕES <b style={b}>{meals.length}/{NU_PLAN.meals.length}</b></span>
            <span>SEGUIU O PLANO <b style={b}>{fol}/{meals.length || 0}</b></span>
            <span>SEMANA <b style={b}>{logged.length}/{elapsed} DIAS</b></span>
            <span>MÉDIA <b style={b}>{nuInt(avg)} KCAL</b></span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── home com plano · mesma linguagem da Home (anel + linhas) ──
const nuCap = { fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: 1.6, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase' };
const nuHair = '1px solid rgba(255,255,255,0.07)';
const NU_SHORT = { breakfast: 'CAFÉ', morning_snack: 'LANCHE', lunch: 'ALMOÇO', afternoon_snack: 'LANCHE', dinner: 'JANTAR', supper: 'CEIA' };

function NuRing({ size = 150, stroke = 11, pct = 0, color = NU_HI, dashed, faint, glow, children }) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => { const id = setTimeout(() => setShown(pct), 60); return () => clearTimeout(id); }, [pct]);
  const col = pct > 110 ? NU_WARN : color;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0, opacity: faint ? 0.4 : 1, borderRadius: '50%', boxShadow: glow ? '0 0 0 2px #020010, 0 0 0 3px rgba(125,180,255,0.8)' : 'none' }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dashed ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)'} strokeWidth={dashed ? 1.2 : stroke} strokeDasharray={dashed ? '2 4' : undefined}/>
        {pct > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(100, shown) / 100)} style={{ transition: 'stroke-dashoffset 1.3s cubic-bezier(.2,.8,.2,1)' }}/>}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  );
}

function NuSecHead({ title, action, onAction }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
      <span style={nuCap}>{title}</span>
      {action && <button onClick={onAction} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{action}<Icon name="chevron-right" size={12} color="rgba(255,255,255,0.7)"/></button>}
    </div>
  );
}

function NuHomePlan() {
  const nu = useNu();
  const tot = nuDayTotal(nu.diary);
  const left = NU_PLAN.kcal - tot.kcal;
  const next = NU_PLAN.meals.find(m => !nu.diary[m.slot]?.items.length);
  const week = NU_WEEK.map(d => d.today ? { ...d, kcal: tot.kcal } : d);
  const logged = week.filter(d => d.kcal != null);
  const avg = logged.reduce((a, d) => a + d.kcal, 0) / (logged.length || 1);
  const WHITE = 'rgba(255,255,255,0.88)';
  return (
    <div style={{ padding: '0 24px 110px' }}>
      {/* anel principal: quanto falta */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
        <NuRing size={210} stroke={12} pct={tot.kcal / NU_PLAN.kcal * 100}>
          <span style={{ ...nuCap, fontSize: 10 }}>{left >= 0 ? 'Faltam' : 'Acima'}</span>
          <span className="aj2-display" style={{ fontSize: 52, lineHeight: 1, marginTop: 8, color: left >= 0 ? '#fff' : NU_WARN }}>{nuInt(Math.abs(left))}</span>
          <span style={{ ...nuCap, fontSize: 10, marginTop: 8 }}>kcal</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 10 }}>{nuInt(tot.kcal)} de {nuInt(NU_PLAN.kcal)}</span>
        </NuRing>
      </div>

      {/* macros centralizados */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 30 }}>
        {[['p', 'PROTEÍNA'], ['c', 'CARBO'], ['g', 'GORDURA'], ['f', 'FIBRA']].map(([k, l]) => {
          const [st, col] = nuStatus(tot[k], NU_PLAN[k]);
          return (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 64 }}>
              <NuRing size={60} stroke={4.5} pct={tot[k] / NU_PLAN[k] * 100} color={WHITE}>
                <span className="aj2-display" style={{ fontSize: 17, lineHeight: 1 }}>{nuInt(tot[k])}</span>
                <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>/{NU_PLAN[k]}g</span>
              </NuRing>
              <span style={{ ...nuCap, fontSize: 8.5, letterSpacing: 1.1 }}>{l}</span>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, letterSpacing: 1, color: col === NU_WARN ? NU_WARN : 'rgba(255,255,255,0.55)', marginTop: -4 }}>{st}</span>
            </div>
          );
        })}
      </div>

      {/* próxima refeição · clean */}
      {next && (
        <div style={{ marginTop: 36, paddingTop: 24, borderTop: nuHair }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={nuCap}>Próxima refeição</span>
            <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>{NU_SLOTS[next.slot]}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 12, lineHeight: 1.25, textWrap: 'pretty' }}>{next.opt.name}</div>
          <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.45)', marginTop: 6, lineHeight: 1.5 }}>{next.opt.foods.map(f => `${f[0]} (${f[1]})`).join(', ')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 20, padding: '14px 0', borderTop: nuHair, borderBottom: nuHair }}>
            {[['kcal', nuInt(next.opt.t.kcal), ''], ['Proteína', next.opt.t.p, 'g'], ['Carbo', next.opt.t.c, 'g'], ['Gordura', next.opt.t.g, 'g']].map(([l, v, u], i) => (
              <div key={l} style={{ textAlign: 'center', borderLeft: i ? nuHair : 'none' }}>
                <div><span className="aj2-display" style={{ fontSize: 20, lineHeight: 1 }}>{v}</span><span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{u}</span></div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 5 }}>{l}</div>
              </div>
            ))}
          </div>
          <button onClick={() => nu.push('register', { slot: next.slot, fromOption: next.opt })} style={{ width: '100%', marginTop: 20, padding: 17, borderRadius: 12, background: '#0b70f9', color: '#fff', fontSize: 16, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="plus" size={15} color="#fff" stroke={2.2}/>Registrar refeição
          </button>
          <button onClick={() => nu.push('meal', { slot: next.slot })} style={{ display: 'block', margin: '14px auto 0', fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Ver detalhes e alternativas</button>
        </div>
      )}

      {/* refeições de hoje */}
      <div style={{ marginTop: 40 }}>
        <NuSecHead title="Refeições de hoje" action="Diário" onAction={() => nu.push('diary')}/>
        {NU_PLAN.meals.map((m, i) => {
          const d = nu.diary[m.slot], n = d?.items.length || 0, k = n ? nuItemsTotal(d.items).kcal : 0;
          const isNext = next && next.slot === m.slot;
          return (
            <button key={m.slot} onClick={() => nu.push('meal', { slot: m.slot })} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderTop: i ? nuHair : 'none' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: n ? '#fff' : 'transparent', border: n ? 'none' : '1px solid rgba(255,255,255,0.3)' }}></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{NU_SLOTS[m.slot]}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
                  {n ? `${n} ${n > 1 ? 'itens' : 'item'}${d.followed ? ' · seguiu a recomendação' : ''}` : isNext ? 'Próxima refeição' : 'Sem registro'}
                </div>
              </div>
              <span style={{ whiteSpace: 'nowrap' }}>
                <span className="aj2-display" style={{ fontSize: 17, color: n ? '#fff' : 'rgba(255,255,255,0.3)' }}>{n ? nuInt(k) : '—'}</span>
                <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}> / {Math.round((m.min + m.max) / 2)}</span>
              </span>
              <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.3)"/>
            </button>
          );
        })}
      </div>

      {/* semana */}
      <div style={{ marginTop: 40 }}>
        <NuSecHead title="Semana" action="Resumo" onAction={() => nu.push('weekly')}/>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 6 }}>
          {week.map(d => (
            <div key={d.d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <NuRing size={38} stroke={3.5} pct={d.kcal != null ? d.kcal / NU_PLAN.kcal * 100 : 0} color={d.today ? NU_HI : WHITE} dashed={d.none} faint={d.future}></NuRing>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8.5, letterSpacing: 0.8, color: d.today ? '#fff' : 'rgba(255,255,255,0.35)' }}>{d.d}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', marginTop: 16 }}>Média de {nuInt(avg)} kcal · {logged.length} de {week.filter(d => !d.future).length} dias com registro</div>
      </div>

      {/* atalhos */}
      <div style={{ marginTop: 40 }}>
        <NuSecHead title="Atalhos"/>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
          {[['list', 'Plano completo', 'plan'], ['star', 'Favoritos', 'favFoods'], ['bookmark', 'Refeições salvas', 'favMeals'], ['history', 'Histórico de planos', 'history'], ['plus', 'Criar alimento', 'createFood'], ['pot', 'Criar receita', 'createRecipe']].map(([ic, l, k]) => (
            <button key={k} onClick={() => nu.push(k)} style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: nuHair, minHeight: 88, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-start', textAlign: 'left', gap: 14 }}>
              <Icon name={ic} size={18} color="rgba(255,255,255,0.6)"/>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{l}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── estados ─────────────────────────────────────────────
function NuSkeleton() {
  const b = (w, h, mt = 0) => <div style={{ width: w, height: h, marginTop: mt, borderRadius: 6, background: 'rgba(255,255,255,0.06)', animation: 'aj2-pulse 1.4s ease-in-out infinite' }}></div>;
  return (
    <div style={{ padding: `28px ${NP}px` }}>
      {b(110, 10)}{b(180, 56, 16)}{b('100%', 7, 22)}
      <div style={{ height: 40 }}></div>
      {[0, 1, 2, 3].map(i => <div key={i} style={{ marginTop: i ? 18 : 0 }}>{b('100%', 10)}{b('100%', 3, 10)}</div>)}
      <div style={{ height: 40 }}></div>
      {b('100%', 150)}
    </div>
  );
}

function NuStateBlock({ icon, kicker, title, body, children }) {
  return (
    <div style={{ padding: `34px ${NP}px 40px` }}>
      {icon && <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(11,112,249,0.4)', background: 'rgba(11,112,249,0.12)', marginBottom: 20 }}><Icon name={icon} size={19} color={NU_HI}/></div>}
      {kicker && <Slash>{kicker}</Slash>}
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25, marginTop: kicker ? 14 : 0, textWrap: 'pretty' }}>{title}</div>
      <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--mute)', textWrap: 'pretty' }}>{body}</p>
      {children}
    </div>
  );
}

function NuKV({ rows, title }) {
  return (
    <div style={{ marginTop: 28 }}>
      <div className="aj2-label" style={{ marginBottom: 6 }}>{title}</div>
      {rows.map(([k, v], i) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '13px 0', borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
          <span style={{ fontSize: 13.5, color: 'var(--mute)' }}>{k}</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function NuNoProfile() {
  const nu = useNu();
  return (
    <NuStateBlock kicker="PERFIL NUTRICIONAL" title="Monte sua dieta a partir do seu perfil"
      body="Já usamos os dados do seu cadastro. Falta contar sua rotina, refeições do dia e preferências alimentares.">
      <NuKV title="JÁ TEMOS" rows={[['Sexo · idade', 'Masculino · 28 anos'], ['Altura', '178 cm'], ['Peso', '77,0 kg · avaliação de 11 set'], ['Objetivo', 'Perder gordura'], ['Treinos por semana', '4']]}/>
      <button className="aj2-cta" style={{ marginTop: 28 }} onClick={() => { nu.setSt('noPlan'); nu.toast('Perfil nutricional salvo'); }}>Criar perfil nutricional</button>
    </NuStateBlock>
  );
}

function NuNoPlan() {
  const nu = useNu();
  return (
    <NuStateBlock kicker="PERFIL PRONTO" title="Gere seu plano alimentar"
      body="Calculamos suas metas de calorias e macros e montamos uma opção para cada refeição do seu dia.">
      <NuKV title="SEU PERFIL" rows={[['Refeições', '5 por dia'], ['Padrão alimentar', 'Onívoro'], ['Ritmo', 'Moderado'], ['Alergênicos excluídos', 'Lactose'], ['Variedade', 'Prefiro variar']]}/>
      <button className="aj2-cta" style={{ marginTop: 28 }} onClick={() => nu.setSt('generating')}><Icon name="sparkles" size={16} color="#fff"/>Gerar meu plano</button>
    </NuStateBlock>
  );
}

function NuBlocked() {
  const nu = useNu();
  return (
    <NuStateBlock icon="shield" title="Geração de plano indisponível"
      body="Por segurança, não geramos dietas durante a gestação ou amamentação. Procure um nutricionista para um acompanhamento individual. O diário alimentar continua disponível.">
      <button className="aj2-cta ghost" style={{ marginTop: 26 }} onClick={() => nu.push('diary')}>Abrir diário alimentar</button>
    </NuStateBlock>
  );
}

const NU_GEN_STEPS = ['Analisando seu perfil', 'Calculando suas metas', 'Montando as refeições', 'Validando o plano'];
function NuGenerating() {
  const nu = useNu();
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (i >= NU_GEN_STEPS.length) { const id = setTimeout(() => { nu.setSt('plan'); nu.toast('Seu plano está pronto'); }, 500); return () => clearTimeout(id); }
    const id = setTimeout(() => setI(i + 1), 1500); return () => clearTimeout(id);
  }, [i]);
  return (
    <div style={{ padding: `34px ${NP}px` }}>
      <Slash>GERANDO PLANO</Slash>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25, marginTop: 14 }}>Estamos montando sua dieta</div>
      <div style={{ marginTop: 28 }}>
        {NU_GEN_STEPS.map((s, n) => {
          const done = n < i, cur = n === i;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 0', borderTop: n ? '1px solid rgba(255,255,255,0.06)' : 'none', opacity: done || cur ? 1 : 0.35 }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                border: done ? 'none' : `1px solid ${cur ? NU_HI : 'rgba(255,255,255,0.25)'}`, background: done ? '#0b70f9' : 'transparent' }}>
                {done ? <Icon name="check" size={12} color="#fff" stroke={2.4}/> : cur ? <span style={{ width: 7, height: 7, borderRadius: 4, background: NU_HI, animation: 'aj2-blink 1s infinite' }}></span> : null}
              </span>
              <span style={{ fontSize: 14.5, fontWeight: cur ? 600 : 500 }}>{s}</span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: '24px 0 0', fontSize: 13, lineHeight: 1.6, color: 'var(--faint)' }}>Pode sair desta tela. Avisamos quando o plano estiver pronto.</p>
    </div>
  );
}

function NuGenError() {
  const nu = useNu();
  return (
    <NuStateBlock icon="alert" title="Não foi possível gerar seu plano"
      body="Algo deu errado do nosso lado. Seu perfil foi mantido e você pode tentar de novo.">
      <button className="aj2-cta" style={{ marginTop: 26 }} onClick={() => nu.setSt('generating')}>Tentar novamente</button>
    </NuStateBlock>
  );
}

```

### 6.4 Átomos clean + Diário, Resumo semanal, Registrar refeição

```jsx
// AJ FIT v2 — Nutrição · modelo clean para Diário, Resumo semanal e Registrar refeição
const NC = 24;
const ncCap = { fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: 1.6, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase' };
const ncHair = '1px solid rgba(255,255,255,0.07)';
const ncFaint = 'rgba(255,255,255,0.45)';
const ncDay = s => { const t = s.toLowerCase().replace(' · ', ', '); return t.charAt(0).toUpperCase() + t.slice(1); };

// ── átomos ───────────────────────────────────────────────
function NcSheet({ title, onBack, children, footer, panel }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#020010', display: 'flex', flexDirection: 'column', pointerEvents: 'auto', animation: 'aj2-rise 0.24s both' }}>
      <style>{'@keyframes nc-up{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes nc-fade{from{opacity:0}to{opacity:1}}'}</style>
      <div style={{ padding: '58px 14px 6px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <button onClick={onBack} aria-label="Voltar" style={{ width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevron-left" size={22}/></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 600 }}>{title}</div>
        <div style={{ width: 42 }}></div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: `0 ${NC}px 40px` }} className="aj2-noscroll">{children}</div>
      {footer && <div style={{ padding: `14px ${NC}px 30px`, borderTop: ncHair, flexShrink: 0 }}>{footer}</div>}
      {panel}
    </div>
  );
}

function NcPanel({ onClose, children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(2,0,16,0.65)', animation: 'nc-fade 0.2s both' }}></div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#0b0922', borderTop: '1px solid rgba(255,255,255,0.08)', borderRadius: '22px 22px 0 0', padding: `10px ${NC}px 34px`, animation: 'nc-up 0.3s cubic-bezier(.2,.8,.2,1) both' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 20px' }}></div>
        {children}
      </div>
    </div>
  );
}

function NcBtn({ children, onClick, ghost, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', padding: 17, borderRadius: 12, fontSize: 16, fontWeight: 600, color: '#fff', opacity: disabled ? 0.4 : 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      background: ghost ? 'rgba(255,255,255,0.06)' : '#0b70f9', border: ghost ? '1px solid rgba(255,255,255,0.08)' : 'none', ...style,
    }}>{children}</button>
  );
}

function NcPill({ on, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, whiteSpace: 'nowrap', padding: '9px 15px', borderRadius: 999, fontSize: 13, fontWeight: 600,
      background: on ? '#fff' : 'transparent', color: on ? '#020010' : 'rgba(255,255,255,0.6)',
      border: on ? '1px solid #fff' : '1px solid rgba(255,255,255,0.14)',
    }}>{children}</button>
  );
}

function NcNav({ label, sub, onPrev, onNext, prevOff, nextOff }) {
  const b = (ic, fn, off) => (
    <button onClick={fn} disabled={off} style={{ width: 40, height: 40, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: off ? 0.2 : 1, border: ncHair }}>
      <Icon name={ic} size={17}/>
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
      {b('chevron-left', onPrev, prevOff)}
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: ncFaint, marginTop: 3 }}>{sub}</div>}
      </div>
      {b('chevron-right', onNext, nextOff)}
    </div>
  );
}

function NcThin({ v, max, color = 'rgba(255,255,255,0.88)', tick }) {
  return (
    <div style={{ position: 'relative', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, v / max * 100)}%`, borderRadius: 2, background: v / max > 1.1 ? NU_WARN : color, transformOrigin: 'left', animation: 'aj2-grow 0.6s both' }}></div>
      {tick != null && <div style={{ position: 'absolute', left: `${tick}%`, top: -3, width: 1.5, height: 10, background: 'rgba(255,255,255,0.5)' }}></div>}
    </div>
  );
}

function NcStepper({ value, sub, onMinus, onPlus }) {
  const b = (ic, fn) => <button onClick={fn} style={{ width: 48, height: 48, borderRadius: 24, border: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={18}/></button>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      {b('minus', onMinus)}
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: ncFaint, marginTop: 2 }}>{sub}</div>}
      </div>
      {b('plus', onPlus)}
    </div>
  );
}

// ── DIÁRIO ───────────────────────────────────────────────
function NuDiary2() {
  const nu = useNu();
  const [off, setOff] = React.useState(0);
  const [sel, setSel] = React.useState(null);
  const today = off === 0;
  const day = today ? nu.diary : (NU_PAST[off] || {});
  const has = Object.values(day).some(m => m.items.length);
  const tot = nuDayTotal(day);

  const save = () => {
    nu.setDiary(d0 => {
      const d = JSON.parse(JSON.stringify(d0));
      const arr = d[sel.slot].items, i = arr.findIndex(x => x.id === sel.it.id);
      const [it] = arr.splice(i, 1, sel.it);
      d[sel.slot].followed = null;
      if (sel.to && sel.to !== sel.slot) {
        arr.splice(i, 1);
        d[sel.to] = d[sel.to] || { followed: null, items: [] };
        d[sel.to].items.push(sel.it); d[sel.to].followed = null;
      }
      return d;
    });
    nu.toast(sel.to && sel.to !== sel.slot ? `Movido para ${NU_SLOTS[sel.to]}` : 'Item atualizado');
    setSel(null);
  };
  const remove = () => {
    nu.setDiary(d0 => { const d = JSON.parse(JSON.stringify(d0)); d[sel.slot].items = d[sel.slot].items.filter(x => x.id !== sel.it.id); d[sel.slot].followed = null; return d; });
    nu.toast('Item removido'); setSel(null);
  };
  const step = dir => setSel(s => {
    const it = { ...s.it }, f = NU_FOODS[it.foodId];
    if (it.unit == null) it.grams = Math.min(10000, Math.max(10, it.grams + dir * 10));
    else { it.count = Math.max(0.5, it.count + dir * 0.5); it.grams = Math.round(it.count * f.serv[it.unit][2]); }
    return { ...s, it };
  });

  const panel = sel && (() => {
    const f = NU_FOODS[sel.it.foodId], sv = sel.it.unit != null ? f.serv[sel.it.unit] : null, k = nuCalc(sel.it.foodId, sel.it.grams);
    return (
      <NcPanel onClose={() => setSel(null)}>
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{f.name}</div>
        <div style={{ fontSize: 13, color: ncFaint, marginTop: 4 }}>{NU_SLOTS[sel.slot]}</div>
        <div style={{ marginTop: 24 }}>
          <NcStepper value={sv ? `${nuCount(sel.it.count)} ${sel.it.count > 1 ? sv[1] : sv[0]}` : `${nuInt(sel.it.grams)} g`} sub={`${sv ? nuInt(sel.it.grams) + ' g · ' : ''}${nuInt(k.kcal)} kcal`} onMinus={() => step(-1)} onPlus={() => step(1)}/>
        </div>
        <div style={{ ...ncCap, marginTop: 26, marginBottom: 10 }}>Mover para</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', margin: `0 -${NC}px`, padding: `0 ${NC}px` }} className="aj2-noscroll">
          {NU_PLAN.meals.map(m => <NcPill key={m.slot} on={(sel.to || sel.slot) === m.slot} onClick={() => setSel(s => ({ ...s, to: m.slot }))}>{NU_SLOTS[m.slot]}</NcPill>)}
        </div>
        <NcBtn onClick={save} style={{ marginTop: 26 }}>Salvar</NcBtn>
        <button onClick={remove} style={{ display: 'block', margin: '16px auto 0', fontSize: 14, fontWeight: 600, color: '#ff8a80' }}>Remover do diário</button>
      </NcPanel>
    );
  })();

  return (
    <NcSheet title="Diário" onBack={nu.back} panel={panel}>
      <NcNav label={today ? 'Hoje' : ncDay(NU_DAYS[off]).split(',')[0]} sub={ncDay(NU_DAYS[off])}
        onPrev={() => setOff(Math.min(6, off + 1))} prevOff={off >= 6} onNext={() => setOff(off - 1)} nextOff={today}/>

      {!has ? (
        <div style={{ textAlign: 'center', padding: '70px 10px 0' }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Nada registrado neste dia</div>
          <div style={{ fontSize: 13.5, color: ncFaint, marginTop: 8, lineHeight: 1.5 }}>Dias sem registro não entram na média da semana.</div>
          {today && <NcBtn onClick={() => nu.push('register')} style={{ marginTop: 28 }}><Icon name="plus" size={15} color="#fff" stroke={2.2}/>Registrar refeição</NcBtn>}
        </div>
      ) : (<>
        <div style={{ marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div><span className="aj2-display" style={{ fontSize: 40, lineHeight: 1 }}>{nuInt(tot.kcal)}</span><span style={{ fontSize: 14, color: ncFaint }}> kcal</span></div>
            <span style={{ fontSize: 13, color: ncFaint }}>meta {nuInt(NU_PLAN.kcal)}</span>
          </div>
          <div style={{ marginTop: 14 }}><NcThin v={tot.kcal} max={NU_PLAN.kcal} color={NU_HI}/></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', whiteSpace: 'nowrap', marginTop: 14, fontSize: 13, color: ncFaint }}>
            <span>Proteína <b style={{ color: '#fff', fontWeight: 600 }}>{nuInt(tot.p)}g</b></span>
            <span>Carbo <b style={{ color: '#fff', fontWeight: 600 }}>{nuInt(tot.c)}g</b></span>
            <span>Gordura <b style={{ color: '#fff', fontWeight: 600 }}>{nuInt(tot.g)}g</b></span>
          </div>
        </div>

        {NU_PLAN.meals.map(m => {
          const d = day[m.slot], items = d?.items || [];
          return (
            <div key={m.slot} style={{ marginTop: 30 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 10, borderBottom: ncHair }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{NU_SLOTS[m.slot]}</span>
                <span style={{ fontSize: 13, color: items.length ? '#fff' : ncFaint, fontWeight: 600 }}>{items.length ? `${nuInt(nuItemsTotal(items).kcal)} kcal` : '—'}</span>
              </div>
              {d?.followed && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: ncFaint, marginTop: 10 }}><Icon name="check" size={12} color={ncFaint} stroke={2.4}/>Seguiu a recomendação do plano</div>}
              {items.map(it => (
                <button key={it.id} disabled={!today} onClick={() => setSel({ slot: m.slot, it: { ...it } })} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', textAlign: 'left', borderBottom: ncHair }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{NU_FOODS[it.foodId].name}</div>
                    <div style={{ fontSize: 12.5, color: ncFaint, marginTop: 3 }}>{nuPortion(it)}</div>
                  </div>
                  <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{nuInt(nuCalc(it.foodId, it.grams).kcal)}</span>
                </button>
              ))}
              {today && (
                <button onClick={() => nu.push('register', { slot: m.slot })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 0 0', fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>
                  <Icon name="plus" size={15} color="rgba(255,255,255,0.65)" stroke={2}/>Adicionar alimento
                </button>
              )}
            </div>
          );
        })}
        {today && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 28, textAlign: 'center' }}>Toque em um alimento para editar, mover ou remover.</div>}
      </>)}
    </NcSheet>
  );
}

// ── RESUMO SEMANAL ───────────────────────────────────────
function NuWeekly2() {
  const nu = useNu();
  const [wk, setWk] = React.useState(0);
  const tt = nuDayTotal(nu.diary);
  const todayMeals = Object.values(nu.diary).filter(m => m.items.length);
  const days = wk === 0 ? NU_WEEK.map(d => d.today ? { ...d, ...tt, meals: todayMeals.length, fol: todayMeals.filter(m => m.followed).length } : d) : NU_WEEK_PREV;
  const logged = days.filter(d => d.kcal != null), elapsed = days.filter(d => !d.future).length;
  const avg = k => logged.reduce((a, d) => a + d[k], 0) / (logged.length || 1);
  const meals = logged.reduce((a, d) => a + d.meals, 0), fol = logged.reduce((a, d) => a + d.fol, 0);
  const diff = Math.round((avg('kcal') / NU_PLAN.kcal - 1) * 100);
  const msg = Math.abs(diff) <= 5 ? 'Em média, você ficou dentro da meta.' : `Em média, você ficou ${Math.abs(diff)}% ${diff < 0 ? 'abaixo' : 'acima'} da meta.`;
  const maxK = 2900, tick = NU_PLAN.kcal / maxK * 100;
  const row = (l, v, last) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0', borderBottom: last ? 'none' : ncHair }}>
      <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{l}</span><span style={{ fontSize: 15, fontWeight: 600 }}>{v}</span>
    </div>
  );
  return (
    <NcSheet title="Resumo semanal" onBack={nu.back}>
      <NcNav label={wk === 0 ? 'Esta semana' : 'Semana passada'} sub={wk === 0 ? '12 a 18 de outubro' : '5 a 11 de outubro'}
        onPrev={() => setWk(1)} prevOff={wk === 1} onNext={() => setWk(0)} nextOff={wk === 0}/>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 30 }}>
        <NuRing size={170} stroke={11} pct={avg('kcal') / NU_PLAN.kcal * 100}>
          <span style={{ ...ncCap, fontSize: 9.5 }}>Média por dia</span>
          <span className="aj2-display" style={{ fontSize: 42, lineHeight: 1, marginTop: 8 }}>{nuInt(avg('kcal'))}</span>
          <span style={{ fontSize: 12, color: ncFaint, marginTop: 6 }}>de {nuInt(NU_PLAN.kcal)} kcal</span>
        </NuRing>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 18, textAlign: 'center' }}>{msg}</div>
        <div style={{ fontSize: 12.5, color: ncFaint, marginTop: 6, textAlign: 'center' }}>Considerando {logged.length} {logged.length === 1 ? 'dia' : 'dias'} com registro.</div>
      </div>

      <div style={{ ...ncCap, marginTop: 38, marginBottom: 6 }}>Dia a dia</div>
      {days.map(d => (
        <div key={d.d} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0' }}>
          <span style={{ width: 34, fontSize: 13, fontWeight: 600, color: d.today ? '#fff' : d.future ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.7)' }}>{d.d.charAt(0) + d.d.slice(1).toLowerCase()}</span>
          <div style={{ flex: 1 }}>{d.kcal != null ? <NcThin v={d.kcal} max={maxK} tick={tick} color={d.today ? NU_HI : 'rgba(255,255,255,0.88)'}/> : <NcThin v={0} max={1} tick={tick}/>}</div>
          <span style={{ width: 84, textAlign: 'right', fontSize: 13, color: d.kcal != null ? '#fff' : 'rgba(255,255,255,0.35)' }}>{d.kcal != null ? `${nuInt(d.kcal)} kcal` : d.none ? 'Sem registro' : '—'}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
        <span style={{ width: 1.5, height: 10, background: 'rgba(255,255,255,0.5)' }}></span>meta diária
      </div>

      <div style={{ ...ncCap, marginTop: 36, marginBottom: 2 }}>Consistência</div>
      {row('Dias com registro', `${logged.length} de ${elapsed}`)}
      {row('Refeições registradas', meals)}
      {row('Seguiu a recomendação', `${meals ? Math.round(fol / meals * 100) : 0}% das refeições`, true)}

      <div style={{ ...ncCap, marginTop: 30, marginBottom: 2 }}>Macros · média por dia</div>
      {[['p', 'Proteína'], ['c', 'Carboidrato'], ['g', 'Gordura']].map(([k, l], i) => row(l, <span>{nuInt(avg(k))}<span style={{ color: ncFaint, fontWeight: 400 }}> / {NU_PLAN[k]} g</span></span>, i === 2))}

      <div style={{ ...ncCap, marginTop: 30, marginBottom: 2 }}>Peso</div>
      {row('Última pesagem', <span>77,0 kg <span style={{ color: ncFaint, fontWeight: 400 }}>· −0,3 kg</span></span>, true)}
      <NcBtn ghost onClick={() => { nu.closeAll(); nu.onOpenProgress && nu.onOpenProgress(); }} style={{ marginTop: 14, fontSize: 14.5 }}>Ver evolução do peso</NcBtn>
    </NcSheet>
  );
}

// ── REGISTRAR REFEIÇÃO ───────────────────────────────────
function NcFoodRow({ id, onOpen }) {
  const f = NU_FOODS[id];
  return (
    <button onClick={() => onOpen(id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', textAlign: 'left', borderBottom: ncHair }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
        <div style={{ fontSize: 12.5, color: ncFaint, marginTop: 3 }}>{f.per.kcal} kcal em 100 g{f.src.startsWith('OFF') ? ` · ${f.src.slice(6).charAt(0) + f.src.slice(7).toLowerCase()}` : f.src === 'PRÓPRIO' ? ' · criado por você' : f.recipe ? ' · sua receita' : ''}</div>
      </div>
      <span style={{ width: 30, height: 30, borderRadius: 15, border: '1px solid rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="plus" size={14} color="rgba(255,255,255,0.75)" stroke={2}/></span>
    </button>
  );
}

function NuRegister2({ slot: initSlot, fromOption }) {
  const nu = useNu();
  const slots = NU_PLAN.meals.map(m => m.slot);
  const [slot, setSlot] = React.useState(initSlot || slots.find(s => !nu.diary[s]?.items.length) || slots[0]);
  const [q, setQ] = React.useState('');
  const [basket, setBasket] = React.useState(() => (fromOption?.match || []).map(([foodId, grams, unit, count], n) => ({ key: 'b' + n, foodId, grams, unit, count })));
  const [touched, setTouched] = React.useState(false);
  const [ed, setEd] = React.useState(null);
  const [scan, setScan] = React.useState(false);

  const open = (foodId, existing) => {
    const f = NU_FOODS[foodId];
    setScan(false);
    setEd(existing ? { ...existing } : { foodId, unit: f.serv.length ? 0 : null, count: 1, grams: f.serv.length ? f.serv[0][2] : 100 });
  };
  const commit = () => { setTouched(true); setBasket(b => ed.key ? b.map(i => i.key === ed.key ? ed : i) : [...b, { ...ed, key: 'b' + Date.now() }]); setEd(null); setQ(''); };
  const drop = key => { setTouched(true); setBasket(b => b.filter(i => i.key !== key)); setEd(null); };
  const register = () => {
    const followed = fromOption?.match && !touched && slot === initSlot ? fromOption.id : null;
    nu.addItems(slot, basket.map(({ key, ...r }) => r), followed);
    nu.toast(`Registrado em ${NU_SLOTS[slot]}`); nu.back();
  };
  const results = q ? Object.keys(NU_FOODS).filter(id => nuNorm(NU_FOODS[id].name).includes(nuNorm(q))) : null;
  const favs = nu.favFoods.filter(id => NU_FOODS[id]);
  const bt = nuItemsTotal(basket);

  const panel = ed ? (() => {
    const f = NU_FOODS[ed.foodId], n = nuCalc(ed.foodId, ed.grams), sv = ed.unit != null ? f.serv[ed.unit] : null, fav = nu.favFoods.includes(ed.foodId);
    const setUnit = u => setEd(e => u == null ? { ...e, unit: null } : { ...e, unit: u, count: 1, grams: f.serv[u][2] });
    const step = d => setEd(e => e.unit == null ? { ...e, grams: Math.min(10000, Math.max(10, e.grams + d * 10)) }
      : (() => { const c = Math.max(0.5, e.count + d * 0.5); return { ...e, count: c, grams: Math.round(c * f.serv[e.unit][2]) }; })());
    return (
      <NcPanel onClose={() => setEd(null)}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{f.name}</div>
          <button onClick={() => nu.toggleFood(ed.foodId)} aria-label="Favoritar" style={{ padding: 4 }}><Icon name={fav ? 'star-fill' : 'star'} size={20} color={fav ? '#fff' : 'rgba(255,255,255,0.4)'}/></button>
        </div>
        {f.serv.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 18, flexWrap: 'wrap' }}>
            <NcPill on={ed.unit == null} onClick={() => setUnit(null)}>Gramas</NcPill>
            {f.serv.map((s, i) => <NcPill key={s[0]} on={ed.unit === i} onClick={() => setUnit(i)}>{s[0].charAt(0).toUpperCase() + s[0].slice(1)}</NcPill>)}
          </div>
        )}
        <div style={{ marginTop: 22 }}>
          <NcStepper value={sv ? `${nuCount(ed.count)} ${ed.count > 1 ? sv[1] : sv[0]}` : `${nuInt(ed.grams)} g`} sub={sv ? `${nuInt(ed.grams)} g` : null} onMinus={() => step(-1)} onPlus={() => step(1)}/>
        </div>
        <div style={{ textAlign: 'center', marginTop: 22 }}>
          <span className="aj2-display" style={{ fontSize: 34, lineHeight: 1 }}>{nuInt(n.kcal)}</span><span style={{ fontSize: 14, color: ncFaint }}> kcal</span>
          <div style={{ fontSize: 13, color: ncFaint, marginTop: 8 }}>Proteína {nuDec(n.p)}g · Carbo {nuDec(n.c)}g · Gordura {nuDec(n.g)}g</div>
        </div>
        <NcBtn onClick={commit} style={{ marginTop: 24 }}>{ed.key ? 'Atualizar' : 'Adicionar'}</NcBtn>
        {ed.key && <button onClick={() => drop(ed.key)} style={{ display: 'block', margin: '16px auto 0', fontSize: 14, fontWeight: 600, color: '#ff8a80' }}>Remover</button>}
      </NcPanel>
    );
  })() : scan ? (
    <NcPanel onClose={() => setScan(false)}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Escanear código de barras</div>
      <div style={{ position: 'relative', height: 220, borderRadius: 16, marginTop: 18, overflow: 'hidden', background: 'rgba(255,255,255,0.03)', border: ncHair }}>
        <div style={{ position: 'absolute', left: '12%', right: '12%', height: 2, background: '#fff', opacity: 0.8, animation: 'aj2-scan 2s ease-in-out infinite' }}></div>
      </div>
      <div style={{ fontSize: 13.5, color: ncFaint, textAlign: 'center', marginTop: 14 }}>Aponte a câmera para o código do produto</div>
      <NcBtn ghost onClick={() => open('whey')} style={{ marginTop: 20, fontSize: 14.5 }}>Simular leitura</NcBtn>
    </NcPanel>
  ) : null;

  const footer = basket.length ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{nuInt(bt.kcal)} kcal</div>
        <div style={{ fontSize: 12.5, color: ncFaint, marginTop: 2 }}>{basket.length} {basket.length > 1 ? 'alimentos' : 'alimento'} em {NU_SLOTS[slot]}</div>
      </div>
      <NcBtn onClick={register} style={{ width: 'auto', padding: '15px 26px' }}>Registrar</NcBtn>
    </div>
  ) : null;

  return (
    <NcSheet title="Registrar refeição" onBack={nu.back} footer={footer} panel={panel}>
      <div style={{ ...ncCap, marginTop: 14, marginBottom: 10 }}>Refeição</div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', margin: `0 -${NC}px`, padding: `0 ${NC}px` }} className="aj2-noscroll">
        {slots.map(s => <NcPill key={s} on={slot === s} onClick={() => setSlot(s)}>{NU_SLOTS[s]}</NcPill>)}
      </div>

      {fromOption && (
        <div style={{ marginTop: 20, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.7)' }}>
          Baseado em <b style={{ color: '#fff', fontWeight: 600 }}>{fromOption.name}</b>. {fromOption.match ? 'Confira as quantidades antes de registrar.' : 'Busque os alimentos que você comeu.'}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 50, padding: '0 16px', borderRadius: 12, marginTop: 20, background: 'rgba(255,255,255,0.05)' }}>
        <Icon name="search" size={17} color={ncFaint}/>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar alimento" style={{ flex: 1, minWidth: 0, background: 'none', border: 0, outline: 'none', color: '#fff', fontFamily: 'var(--f-ui)', fontSize: 15.5 }}/>
        {q ? <button onClick={() => setQ('')} aria-label="Limpar"><Icon name="x" size={15} color={ncFaint}/></button>
          : <button onClick={() => setScan(true)} aria-label="Escanear código"><Icon name="barcode" size={18} color="rgba(255,255,255,0.7)"/></button>}
      </div>

      {basket.length > 0 && !q && (
        <div style={{ marginTop: 26 }}>
          <div style={{ ...ncCap, marginBottom: 2 }}>Adicionados</div>
          {basket.map(b => (
            <button key={b.key} onClick={() => open(b.foodId, b)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', textAlign: 'left', borderBottom: ncHair }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={12} color="#020010" stroke={2.6}/></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{NU_FOODS[b.foodId].name}</div>
                <div style={{ fontSize: 12.5, color: ncFaint, marginTop: 3 }}>{nuPortion(b)}</div>
              </div>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{nuInt(nuCalc(b.foodId, b.grams).kcal)}</span>
            </button>
          ))}
        </div>
      )}

      {results ? (
        <div style={{ marginTop: 26 }}>
          <div style={{ ...ncCap, marginBottom: 2 }}>{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</div>
          {results.map(id => <NcFoodRow key={id} id={id} onOpen={open}/>)}
          {!results.length && (
            <div style={{ textAlign: 'center', padding: '30px 0 0' }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Não encontramos “{q}”</div>
              <NcBtn ghost onClick={() => nu.push('createFood', { name: q })} style={{ marginTop: 18, fontSize: 14.5 }}>Criar este alimento</NcBtn>
            </div>
          )}
        </div>
      ) : (<>
        <div style={{ marginTop: 26 }}>
          <div style={{ ...ncCap, marginBottom: 2 }}>Favoritos</div>
          {favs.map(id => <NcFoodRow key={id} id={id} onOpen={open}/>)}
        </div>
        <div style={{ marginTop: 26 }}>
          <div style={{ ...ncCap, marginBottom: 2 }}>Recentes</div>
          {['frango', 'arroz', 'feijao', 'ovo'].map(id => <NcFoodRow key={id} id={id} onOpen={open}/>)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 26 }}>
          <button onClick={() => nu.push('createFood')} style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Criar alimento</button>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
          <button onClick={() => nu.push('createRecipe')} style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Criar receita</button>
        </div>
      </>)}
    </NcSheet>
  );
}

Object.assign(window, { NuDiary2, NuWeekly2, NuRegister2, NcSheet, NcPanel, NcBtn, NcPill });

```

### 6.5 Detalhe da refeição, Plano, Histórico, Favoritos, Refeições salvas, Criar alimento, Criar receita

```jsx
// AJ FIT v2 — Nutrição · modelo clean: refeição, plano, histórico, favoritos, criar alimento/receita
const C2 = 24;
const c2Cap = { fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: 1.6, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase' };
const c2Hair = '1px solid rgba(255,255,255,0.07)';
const c2Faint = 'rgba(255,255,255,0.45)';
const c2Macro = t => `${nuInt(t.kcal)} kcal · P ${nuInt(t.p)}g · C ${nuInt(t.c)}g · G ${nuInt(t.g)}g`;
const C2_REASONS = [['dislike', 'Não gosto de um alimento'], ['unavailable', 'Não tenho os ingredientes'], ['quicker', 'Quero algo mais rápido'], ['fuller', 'Quero algo que sacie mais'], ['variety', 'Quero variar']];

function C2Link({ children, onClick, color = 'rgba(255,255,255,0.65)', style }) {
  return <button onClick={onClick} style={{ display: 'block', margin: '16px auto 0', fontSize: 14, fontWeight: 600, color, ...style }}>{children}</button>;
}
function C2Row({ label, value, sub, onClick, last, right }) {
  const El = onClick ? 'button' : 'div';
  return (
    <El onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', textAlign: 'left', borderBottom: last ? 'none' : c2Hair }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: 12.5, color: c2Faint, marginTop: 3 }}>{sub}</div>}
      </div>
      {value != null && <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap' }}>{value}</span>}
      {right}
      {onClick && !right && <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.3)"/>}
    </El>
  );
}
function C2IconBtn({ icon, onClick, on, label }) {
  return (
    <button onClick={onClick} aria-label={label} style={{ width: 54, flexShrink: 0, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <Icon name={icon} size={18} color={on ? '#fff' : 'rgba(255,255,255,0.6)'}/>
    </button>
  );
}

// opção de refeição: nome, itens em texto livre, totais
function C2Option({ opt, slot, primary }) {
  const nu = useNu();
  const fav = nu.isFavMeal(opt.name);
  return (
    <div>
      <div style={{ fontSize: primary ? 21 : 17, fontWeight: 700, lineHeight: 1.25, textWrap: 'pretty' }}>{opt.name}</div>
      <div style={{ fontSize: 13, color: c2Faint, marginTop: 6 }}>{c2Macro(opt.t)}</div>
      <div style={{ marginTop: 14 }}>
        {opt.foods.map(([n, q, note], i) => (
          <div key={n + i} style={{ display: 'flex', gap: 12, padding: '11px 0', borderTop: c2Hair }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5 }}>{n}</div>
              {note && <div style={{ fontSize: 12.5, color: c2Faint, marginTop: 2 }}>{note}</div>}
            </div>
            <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.6)', textAlign: 'right' }}>{q}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <NcBtn ghost={!primary} onClick={() => nu.push('register', { slot, fromOption: opt })} style={primary ? null : { fontSize: 14.5, padding: 15 }}>Registrar no diário</NcBtn>
        <C2IconBtn icon={fav ? 'star-fill' : 'star'} on={fav} label="Salvar refeição" onClick={() => nu.toggleFavMeal(opt, slot)}/>
      </div>
    </div>
  );
}

// ── DETALHE DA REFEIÇÃO ───────────────────────────────────
function NuMealDetail2({ slot }) {
  const nu = useNu();
  const meal = NU_PLAN.meals.find(m => m.slot === slot);
  const [ask, setAsk] = React.useState(false);
  const [reason, setReason] = React.useState(null);
  const [food, setFood] = React.useState(null);
  const [view, setView] = React.useState('rec');
  React.useEffect(() => { if (view !== 'gen') return; const id = setTimeout(() => setView('alts'), 1600); return () => clearTimeout(id); }, [view]);
  const logged = nu.diary[slot]?.items || [];
  const ready = reason && (reason !== 'dislike' || food);

  const panel = ask && (
    <NcPanel onClose={() => setAsk(false)}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Por que você quer trocar?</div>
      <div style={{ fontSize: 13, color: c2Faint, marginTop: 4 }}>Vamos sugerir opções com a mesma meta.</div>
      <div style={{ marginTop: 14 }}>
        {C2_REASONS.map(([k, l], i) => {
          const on = reason === k;
          return (
            <button key={k} onClick={() => { setReason(k); setFood(null); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', textAlign: 'left', borderBottom: i < C2_REASONS.length - 1 ? c2Hair : 'none' }}>
              <span style={{ width: 20, height: 20, borderRadius: 10, flexShrink: 0, border: on ? '6px solid #fff' : '1px solid rgba(255,255,255,0.3)' }}></span>
              <span style={{ fontSize: 14.5, fontWeight: on ? 600 : 400 }}>{l}</span>
            </button>
          );
        })}
      </div>
      {reason === 'dislike' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
          {meal.opt.foods.map(([n]) => <NcPill key={n} on={food === n} onClick={() => setFood(n)}>{n}</NcPill>)}
        </div>
      )}
      <NcBtn disabled={!ready} onClick={() => { setAsk(false); setView('gen'); }} style={{ marginTop: 22 }}>Ver alternativas</NcBtn>
    </NcPanel>
  );

  return (
    <NcSheet title={NU_SLOTS[slot]} onBack={nu.back} panel={panel}>
      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <div style={c2Cap}>Meta da refeição</div>
        <div style={{ marginTop: 10 }}><span className="aj2-display" style={{ fontSize: 40, lineHeight: 1 }}>{meal.min}–{meal.max}</span><span style={{ fontSize: 14, color: c2Faint }}> kcal</span></div>
        {logged.length > 0 && <div style={{ fontSize: 13, color: c2Faint, marginTop: 8 }}>Você registrou {nuInt(nuItemsTotal(logged).kcal)} kcal hoje</div>}
      </div>

      {view === 'rec' && (
        <div style={{ marginTop: 34, animation: 'aj2-rise 0.25s both' }}>
          <div style={{ ...c2Cap, marginBottom: 10 }}>Opção recomendada</div>
          <C2Option opt={meal.opt} slot={slot} primary/>
          <NcBtn ghost onClick={() => setAsk(true)} style={{ marginTop: 10, fontSize: 14.5 }}><Icon name="swap" size={15} color="rgba(255,255,255,0.75)"/>Trocar por outra opção</NcBtn>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 22, textAlign: 'center', lineHeight: 1.5 }}>Quantidades e nutrientes são estimativas. Ao registrar, você confirma o que realmente comeu.</div>
        </div>
      )}
      {view === 'gen' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 70 }}>
          <span style={{ width: 30, height: 30, borderRadius: 15, border: '2px solid rgba(255,255,255,0.12)', borderTopColor: '#fff', animation: 'aj2-spin-slow 0.9s linear infinite' }}></span>
          <span style={{ fontSize: 14, color: c2Faint }}>Buscando alternativas…</span>
        </div>
      )}
      {view === 'alts' && (
        <div style={{ marginTop: 34, animation: 'aj2-rise 0.25s both' }}>
          <div style={c2Cap}>Alternativas</div>
          <div style={{ fontSize: 13, color: c2Faint, marginTop: 6 }}>{C2_REASONS.find(r => r[0] === reason)?.[1]}{food ? ` · sem ${food.toLowerCase()}` : ''}</div>
          {NU_ALTS[slot].map((o, i) => <div key={o.id} style={{ marginTop: i ? 34 : 18 }}><C2Option opt={o} slot={slot}/></div>)}
          <C2Link onClick={() => setView('rec')} style={{ marginTop: 26 }}>Voltar para a recomendada</C2Link>
        </div>
      )}
    </NcSheet>
  );
}

// ── PLANO ALIMENTAR ──────────────────────────────────────
function NuPlanFull2({ plan, readOnly }) {
  const nu = useNu();
  const p = plan || NU_PLAN;
  const restore = () => { nu.setActivePlan(p.id); nu.toast(`Plano de ${p.created.toLowerCase()} restaurado`); nu.back(); };
  return (
    <NcSheet title={readOnly ? 'Plano arquivado' : 'Plano alimentar'} onBack={nu.back} footer={readOnly ? <NcBtn onClick={restore}>Restaurar este plano</NcBtn> : null}>
      {readOnly && <div style={{ marginTop: 14, padding: '13px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', fontSize: 13, color: 'rgba(255,255,255,0.7)', display: 'flex', gap: 10, alignItems: 'center' }}><Icon name="lock" size={14} color={c2Faint}/>Só para consulta. Restaure para voltar a usar.</div>}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
        <NuRing size={170} stroke={11} pct={100}>
          <span style={{ ...c2Cap, fontSize: 9.5 }}>Meta diária</span>
          <span className="aj2-display" style={{ fontSize: 44, lineHeight: 1, marginTop: 8 }}>{nuInt(p.kcal)}</span>
          <span style={{ fontSize: 12, color: c2Faint, marginTop: 6 }}>kcal</span>
        </NuRing>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 26, marginTop: 24 }}>
        {[['p', 'Proteína'], ['c', 'Carbo'], ['g', 'Gordura'], ['f', 'Fibra']].map(([k, l]) => (
          <div key={k} style={{ textAlign: 'center' }}>
            <div><span className="aj2-display" style={{ fontSize: 22, lineHeight: 1 }}>{nuInt(p[k])}</span><span style={{ fontSize: 12, color: c2Faint }}>g</span></div>
            <div style={{ fontSize: 12, color: c2Faint, marginTop: 5 }}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{ ...c2Cap, marginTop: 36, marginBottom: 2 }}>Refeições</div>
      {NU_PLAN.meals.map((m, i) => (
        <C2Row key={m.slot} label={NU_SLOTS[m.slot]} sub={m.opt.name} value={`${m.min}–${m.max}`} last={i === NU_PLAN.meals.length - 1}
          onClick={readOnly ? null : () => nu.push('meal', { slot: m.slot })}/>
      ))}

      <div style={{ ...c2Cap, marginTop: 30, marginBottom: 2 }}>Como calculamos</div>
      {!readOnly && <C2Row label="Metabolismo basal" value={`${nuInt(p.rmr)} kcal`}/>}
      {!readOnly && <C2Row label="Gasto diário estimado" value={`${nuInt(p.tdee)} kcal`}/>}
      <C2Row label="Ajuste para o objetivo" value={p.adj.charAt(0) + p.adj.slice(1).toLowerCase()}/>
      <C2Row label="Gerado em" value={p.created.toLowerCase()} last/>

      {!readOnly && (<>
        <NcBtn ghost onClick={() => { nu.closeAll(); nu.setSt('generating'); }} style={{ marginTop: 28, fontSize: 14.5 }}><Icon name="sparkles" size={15} color="rgba(255,255,255,0.75)"/>Gerar novo plano</NcBtn>
        <div style={{ fontSize: 12.5, color: c2Faint, marginTop: 10, textAlign: 'center' }}>O plano atual vai para o histórico.</div>
        <C2Link onClick={() => nu.push('history')}>Ver histórico de planos</C2Link>
      </>)}
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 28, textAlign: 'center', lineHeight: 1.5 }}>Este plano é uma orientação geral e não substitui o acompanhamento de um nutricionista.</div>
    </NcSheet>
  );
}

// ── HISTÓRICO DE PLANOS ───────────────────────────────────
function NuHistory2() {
  const nu = useNu();
  const all = [NU_PLAN, ...NU_PLAN_ARCH];
  return (
    <NcSheet title="Histórico de planos" onBack={nu.back}>
      <div style={{ fontSize: 13.5, color: c2Faint, marginTop: 14, lineHeight: 1.5 }}>Restaurar reativa um plano antigo exatamente como ele era, sem gerar um novo.</div>
      <div style={{ marginTop: 18 }}>
        {all.map((p, i) => {
          const active = nu.activePlan === p.id;
          const d = p.created.toLowerCase();
          return (
            <C2Row key={p.id} last={i === all.length - 1} label={d.charAt(0).toUpperCase() + d.slice(1)}
              sub={`${nuInt(p.kcal)} kcal · ${p.adj.toLowerCase()}`}
              onClick={() => nu.push('plan', { plan: p, readOnly: !active })}
              right={active
                ? <span style={{ padding: '6px 12px', borderRadius: 999, background: '#fff', color: '#020010', fontSize: 12, fontWeight: 700 }}>Ativo</span>
                : <span onClick={e => { e.stopPropagation(); nu.setActivePlan(p.id); nu.toast(`Plano de ${d} restaurado`); }} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.16)', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>Restaurar</span>}/>
          );
        })}
      </div>
    </NcSheet>
  );
}

// ── FAVORITOS (alimentos · receitas) ────────────────────────
function NuFavFoods2() {
  const nu = useNu();
  const [tab, setTab] = React.useState('foods');
  const ids = nu.favFoods.filter(id => tab === 'recipes' ? NU_FOODS[id]?.recipe : !NU_FOODS[id]?.recipe);
  return (
    <NcSheet title="Favoritos" onBack={nu.back}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14 }}>
        <NcPill on={tab === 'foods'} onClick={() => setTab('foods')}>Alimentos</NcPill>
        <NcPill on={tab === 'recipes'} onClick={() => setTab('recipes')}>Receitas</NcPill>
        <span style={{ flex: 1 }}></span>
        <span style={{ fontSize: 12.5, color: c2Faint }}>{nu.favFoods.length} de 20</span>
      </div>
      <div style={{ marginTop: 14 }}>
        {!ids.length && <div style={{ textAlign: 'center', padding: '50px 10px 0' }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{tab === 'recipes' ? 'Nenhuma receita favorita' : 'Nenhum alimento favorito'}</div>
          <div style={{ fontSize: 13.5, color: c2Faint, marginTop: 8 }}>Toque na estrela ao registrar para salvar aqui.</div>
        </div>}
        {ids.map((id, i) => {
          const f = NU_FOODS[id];
          return (
            <C2Row key={id} last={i === ids.length - 1} label={f ? f.name : 'Iogurte grego tradicional'}
              sub={f ? `${f.per.kcal} kcal em 100 g` : 'Não está mais disponível'}
              right={<button onClick={() => nu.toggleFood(id)} aria-label="Remover dos favoritos" style={{ padding: 6 }}><Icon name={f ? 'star-fill' : 'x'} size={18} color={f ? '#fff' : c2Faint}/></button>}/>
          );
        })}
      </div>
    </NcSheet>
  );
}

// ── REFEIÇÕES SALVAS ─────────────────────────────────────
function NuFavMeals2() {
  const nu = useNu();
  return (
    <NcSheet title="Refeições salvas" onBack={nu.back}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13, color: c2Faint }}>
        <span>Opções completas que você salvou</span><span style={{ whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 12 }}>{nu.favMeals.length} de 10</span>
      </div>
      {!nu.favMeals.length && (
        <div style={{ textAlign: 'center', padding: '60px 10px 0' }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Nenhuma refeição salva</div>
          <div style={{ fontSize: 13.5, color: c2Faint, marginTop: 8 }}>Toque na estrela de uma opção do plano para salvar aqui.</div>
        </div>
      )}
      {nu.favMeals.map((m, i) => (
        <div key={m.id} style={{ padding: '22px 0', borderBottom: i < nu.favMeals.length - 1 ? c2Hair : 'none' }}>
          <div style={c2Cap}>{NU_SLOTS[m.slot]}</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 8, lineHeight: 1.3 }}>{m.opt.name}</div>
          <div style={{ fontSize: 13, color: c2Faint, marginTop: 5 }}>{m.opt.foods.map(f => f[0]).join(', ')}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 5 }}>{c2Macro(m.opt.t)}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <NcBtn ghost onClick={() => nu.push('register', { slot: m.slot, fromOption: m.opt })} style={{ fontSize: 14.5, padding: 14 }}>Registrar no diário</NcBtn>
            <C2IconBtn icon="trash" label="Remover" onClick={() => { nu.removeFavMeal(m.id); nu.toast('Removida das refeições salvas'); }}/>
          </div>
        </div>
      ))}
    </NcSheet>
  );
}

// ── formulários ──────────────────────────────────────────
function C2Input({ value, onChange, placeholder }) {
  return <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    style={{ width: '100%', height: 52, padding: '0 16px', borderRadius: 12, border: 0, outline: 'none', background: 'rgba(255,255,255,0.05)', color: '#fff', fontFamily: 'var(--f-ui)', fontSize: 15.5 }}/>;
}
function C2NumRow({ label, value, onChange, unit, placeholder = '0', last }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: last ? 'none' : c2Hair }}>
      <span style={{ flex: 1, fontSize: 14.5 }}>{label}</span>
      <input value={value} inputMode="decimal" placeholder={placeholder} onChange={e => onChange(e.target.value.replace(/[^\d,.]/g, ''))}
        style={{ width: 84, height: 40, padding: '0 12px', borderRadius: 10, border: 0, outline: 'none', textAlign: 'right', background: 'rgba(255,255,255,0.05)', color: '#fff', fontFamily: 'var(--f-ui)', fontSize: 15, fontWeight: 600 }}/>
      <span style={{ width: 30, fontSize: 13, color: c2Faint }}>{unit}</span>
    </label>
  );
}
const c2Num = v => parseFloat(String(v).replace(',', '.')) || 0;

function NuCreateFood2({ name: initName = '' }) {
  const nu = useNu();
  const [v, setV] = React.useState({ name: initName, kcal: '', p: '', c: '', g: '', f: '' });
  const set = k => x => setV(s => ({ ...s, [k]: x }));
  const ok = v.name.trim() && v.kcal;
  const save = () => {
    NU_FOODS['u' + Date.now()] = { name: v.name.trim(), src: 'PRÓPRIO', per: { kcal: c2Num(v.kcal), p: c2Num(v.p), c: c2Num(v.c), g: c2Num(v.g), f: c2Num(v.f) }, serv: [] };
    nu.toast('Alimento criado'); nu.back();
  };
  return (
    <NcSheet title="Criar alimento" onBack={nu.back} footer={<NcBtn disabled={!ok} onClick={save}>Salvar alimento</NcBtn>}>
      <div style={{ ...c2Cap, marginTop: 18, marginBottom: 10 }}>Nome</div>
      <C2Input value={v.name} onChange={set('name')} placeholder="Ex.: Granola da casa"/>
      <div style={{ ...c2Cap, marginTop: 30, marginBottom: 2 }}>Valores em 100 g</div>
      <C2NumRow label="Calorias" unit="kcal" value={v.kcal} onChange={set('kcal')}/>
      <C2NumRow label="Proteína" unit="g" value={v.p} onChange={set('p')}/>
      <C2NumRow label="Carboidrato" unit="g" value={v.c} onChange={set('c')}/>
      <C2NumRow label="Gordura" unit="g" value={v.g} onChange={set('g')}/>
      <C2NumRow label="Fibra (opcional)" unit="g" value={v.f} onChange={set('f')} last/>
      <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', marginTop: 22, textAlign: 'center' }}>Só você vê este alimento. Ele aparece na busca do diário.</div>
    </NcSheet>
  );
}

function NuCreateRecipe2() {
  const nu = useNu();
  const [name, setName] = React.useState('');
  const [ings, setIngs] = React.useState([]);
  const [pick, setPick] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [finalW, setFinalW] = React.useState('');
  const [portions, setPortions] = React.useState('');
  const tot = nuItemsTotal(ings), raw = ings.reduce((a, i) => a + i.grams, 0), np = c2Num(portions), div = np || 1;
  const ok = name.trim() && ings.length;
  const pool = Object.keys(NU_FOODS).filter(id => !NU_FOODS[id].recipe && (!q || nuNorm(NU_FOODS[id].name).includes(nuNorm(q))));
  const adj = (key, d) => setIngs(s => s.map(x => x.key === key ? { ...x, grams: Math.max(5, x.grams + d) } : x));
  const save = () => {
    const w = c2Num(finalW) || raw, k = 100 / w;
    NU_FOODS['r' + Date.now()] = { name: name.trim(), src: 'RECEITA', recipe: true, per: { kcal: tot.kcal * k, p: tot.p * k, c: tot.c * k, g: tot.g * k, f: tot.f * k }, serv: np ? [['porção', 'porções', Math.round(w / np)]] : [] };
    nu.toast('Receita criada'); nu.back();
  };
  const sb = (ic, fn) => <button onClick={fn} style={{ width: 30, height: 30, borderRadius: 15, border: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={13}/></button>;

  const panel = pick && (
    <NcPanel onClose={() => { setPick(false); setQ(''); }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Adicionar ingrediente</div>
      <C2Input value={q} onChange={setQ} placeholder="Buscar alimento"/>
      <div style={{ maxHeight: 280, overflow: 'auto', marginTop: 8 }} className="aj2-noscroll">
        {pool.map(id => (
          <button key={id} onClick={() => { setIngs(s => [...s, { key: 'i' + Date.now(), foodId: id, grams: 100 }]); setPick(false); setQ(''); }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', textAlign: 'left', borderBottom: c2Hair }}>
            <span style={{ flex: 1, fontSize: 14.5 }}>{NU_FOODS[id].name}</span>
            <Icon name="plus" size={14} color="rgba(255,255,255,0.6)"/>
          </button>
        ))}
      </div>
    </NcPanel>
  );

  return (
    <NcSheet title="Criar receita" onBack={nu.back} panel={panel} footer={<NcBtn disabled={!ok} onClick={save}>Salvar receita</NcBtn>}>
      <div style={{ ...c2Cap, marginTop: 18, marginBottom: 10 }}>Nome</div>
      <C2Input value={name} onChange={setName} placeholder="Ex.: Panqueca de banana"/>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 30, marginBottom: 2 }}>
        <span style={c2Cap}>Ingredientes</span><span style={{ fontSize: 12.5, color: c2Faint }}>{ings.length} de 6</span>
      </div>
      {ings.map(it => (
        <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: c2Hair }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{NU_FOODS[it.foodId].name}</div>
            <div style={{ fontSize: 12.5, color: c2Faint, marginTop: 3 }}>{nuInt(nuCalc(it.foodId, it.grams).kcal)} kcal</div>
          </div>
          {sb('minus', () => adj(it.key, -10))}
          <span style={{ width: 52, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>{it.grams} g</span>
          {sb('plus', () => adj(it.key, 10))}
          <button onClick={() => setIngs(s => s.filter(x => x.key !== it.key))} aria-label="Remover" style={{ padding: 4 }}><Icon name="x" size={15} color={c2Faint}/></button>
        </div>
      ))}
      {ings.length < 6 && (
        <button onClick={() => setPick(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 0', fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>
          <Icon name="plus" size={15} color="rgba(255,255,255,0.65)" stroke={2}/>Adicionar ingrediente
        </button>
      )}

      <div style={{ ...c2Cap, marginTop: 24, marginBottom: 2 }}>Rendimento · opcional</div>
      <C2NumRow label="Peso final" unit="g" value={finalW} onChange={setFinalW} placeholder={raw ? String(raw) : '0'}/>
      <C2NumRow label="Porções" unit="" value={portions} onChange={setPortions} last/>

      {ings.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 30, paddingTop: 24, borderTop: c2Hair }}>
          <div style={c2Cap}>{np ? 'Por porção' : 'Receita inteira'}</div>
          <div style={{ marginTop: 10 }}><span className="aj2-display" style={{ fontSize: 38, lineHeight: 1 }}>{nuInt(tot.kcal / div)}</span><span style={{ fontSize: 14, color: c2Faint }}> kcal</span></div>
          <div style={{ fontSize: 13, color: c2Faint, marginTop: 8 }}>Proteína {nuInt(tot.p / div)}g · Carbo {nuInt(tot.c / div)}g · Gordura {nuInt(tot.g / div)}g</div>
        </div>
      )}
    </NcSheet>
  );
}

Object.assign(window, { NuMealDetail2, NuPlanFull2, NuHistory2, NuFavFoods2, NuFavMeals2, NuCreateFood2, NuCreateRecipe2 });

```
