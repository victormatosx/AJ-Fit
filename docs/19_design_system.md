# AJ Fit Design System

## 1. Direção visual

O AJ Fit usa uma linguagem **performance-tech**: escura, precisa, atlética e energética. A interface combina fundos azul-marinho quase pretos, vidro translúcido, azul elétrico e tipografia condensada em caixa alta. O objetivo é transmitir foco e progresso sem competir com a ação principal: iniciar e concluir o treino.

Princípios:

- **Ação acima de decoração:** cada tela deve ter uma ação primária inequívoca.
- **Hierarquia por tipografia:** Anton comunica impacto; Archivo garante leitura; JetBrains Mono organiza metadados e números.
- **Profundidade contida:** superfícies usam transparência, borda fina e glow apenas em itens ativos ou prioritários.
- **Densidade atlética:** layouts compactos, com grid de 4 pt e pouco espaço desperdiçado.
- **Dark-first:** este sistema possui apenas tema escuro nesta versão.

A fonte de verdade executável está em `src/theme/tokens.ts`.

---

## 2. Cores

### 2.1 Paleta base

| Token | Valor | Uso |
|---|---:|---|
| `palette.ink950` | `#020010` | Fundo principal |
| `palette.ink900` | `#060220` | Fundo alternativo |
| `palette.navy800` | `#04021C` | Final de gradiente de pôster |
| `palette.navy700` | `#051042` | Meio de gradiente de pôster |
| `palette.navy600` | `#0A1A55` | Início de gradiente de pôster |
| `palette.blue700` | `#0B70F9` | Ação e marca |
| `palette.blue600` | `#1F82FF` | Início de gradiente de ação |
| `palette.blue500` | `#4DA3FF` | Destaques, ícones e foco |
| `palette.blue400` | `#7DB4FF` | Texto azul claro ocasional |
| `palette.white` | `#FFFFFF` | Texto e ação invertida |
| `palette.green500` | `#22C55E` | Sucesso e evolução positiva |
| `palette.orange400` | `#FFA840` | Aviso |
| `palette.red500` | `#F0563F` | Erro e evolução negativa |
| `palette.red300` | `#FF9A9A` | Texto de erro sobre fundo escuro |

### 2.2 Cores semânticas

Use os tokens semânticos em componentes novos. A paleta base deve ser reservada à construção dos próprios tokens.

| Token | Papel |
|---|---|
| `colors.bg` | canvas do aplicativo |
| `colors.surface` | card ou agrupamento padrão |
| `colors.surfaceRaised` | superfície elevada, hover/ênfase leve |
| `colors.surfacePressed` | feedback de pressão |
| `colors.surfaceSelected` | seleção com banho azul |
| `colors.accent` | ação primária e progresso |
| `colors.accentHi` | ícone ativo, foco e detalhe luminoso |
| `colors.text` | conteúdo principal |
| `colors.textSecondary` | texto explicativo |
| `colors.mute` | texto auxiliar |
| `colors.faint` | metadado e placeholder |
| `colors.border` | borda padrão |
| `colors.borderStrong` | controle ou separação enfatizada |
| `colors.success` | estado concluído/positivo |
| `colors.warning` | atenção sem bloqueio |
| `colors.danger` | erro e ação destrutiva |
| `colors.overlayStrong` | scrim de modal |

### 2.3 Gradientes

- `gradients.brand`: `#1F82FF → #0B70F9`, usado em CTA primário e avatar.
- `gradients.poster`: `#0A1A55 → #051042 → #04021C`, usado em cards hero e treino do dia.
- `gradients.glass`: branco 5% → branco 1,5%, usado em cards neutros.
- `gradients.accentWash`: azul 24% → azul 4%, usado em cards especiais.

Não aplicar glow em todos os elementos azuis. Glow indica prioridade, foco ou seleção.

---

## 3. Tipografia

### 3.1 Famílias

| Família | Pesos carregados | Função |
|---|---|---|
| **Anton** | 400 | títulos display, números grandes e CTAs |
| **Archivo** | 400, 500, 600, 700 | corpo, formulários, títulos funcionais |
| **JetBrains Mono** | 400, 700 | labels, métricas, unidades, datas e metadados |

Nomes no código:

- `fonts.display`: `Anton_400Regular`
- `fonts.ui`: `Archivo_400Regular`
- `fonts.uiMed`: `Archivo_500Medium`
- `fonts.uiSemi`: `Archivo_600SemiBold`
- `fonts.uiBold`: `Archivo_700Bold`
- `fonts.mono`: `JetBrainsMono_400Regular`
- `fonts.monoBold`: `JetBrainsMono_700Bold`

### 3.2 Escala canônica

| Estilo | Fonte | Tamanho / linha | Tracking | Uso |
|---|---|---:|---:|---|
| `displayHero` | Anton | 46 / 53 | 0,5 | onboarding e mensagem hero |
| `displayLarge` | Anton | 38 / 44 | 0,5 | pôster principal |
| `displayMedium` | Anton | 34 / 39 | 0,5 | título de tela |
| `displaySmall` | Anton | 26 / 30 | 0,5 | título de card/modal |
| `title` | Archivo 700 | 17 / 22 | 0 | título funcional |
| `subtitle` | Archivo 600 | 14,5 / 20 | 0 | título de item/card |
| `body` | Archivo 400 | 14 / 21 | 0 | texto padrão e input |
| `bodySmall` | Archivo 400 | 12,5 / 18 | 0 | apoio e descrição curta |
| `button` | Anton | 17 / automático | 1,5 | CTA primário em caixa alta |
| `label` | JetBrains Mono | 10 / automático | 2 | seção e metadado em caixa alta |
| `labelStrong` | JetBrains Mono 700 | 10 / automático | 2 | label enfatizado |
| `data` | JetBrains Mono | 11 / automático | 0,5 | valor, unidade ou data |

Regras:

- Anton é sempre usado em caixa alta e pode receber inclinação horizontal de `-8deg` para títulos editoriais.
- Anton deve usar `displayLineHeight(size)`. Uma altura de linha menor pode cortar glifos no iOS.
- Textos corridos nunca usam Anton ou JetBrains Mono.
- Labels Mono devem ser curtas; evitar parágrafos e traduções longas com tracking alto.
- Não usar `fontWeight` para simular pesos. Selecionar a família carregada correspondente.

---

## 4. Espaçamento e layout

O sistema usa grid base de **4 pt**, com meios passos de 2 pt para ajustes compactos.

| Token | px | Uso recorrente |
|---|---:|---|
| `spacing.1` | 4 | microespaço |
| `spacing.2` | 8 | gap interno pequeno |
| `spacing.3` | 12 | gap entre controles |
| `spacing.4` | 16 | padding de card |
| `spacing.5` | 20 | card hero |
| `spacing[5.5]` | 22 | margem lateral de tela |
| `spacing.6` | 24 | separação de blocos |
| `spacing.8` | 32 | separação de seções |
| `spacing.12` | 48 | área ampla/controle médio |
| `spacing.14` | 56 | altura próxima do CTA |

Layout padrão:

- Gutter de tela: `sizes.screenGutter` = **22 px**.
- Largura máxima de conteúdo: `sizes.contentMaxWidth` = **420 px**.
- Modal compacto: `sizes.modalMaxWidth` = **340 px**.
- Padding de card: 14–20 px; padrão recomendado de 16 px.
- Gap entre ícone e texto: 10–14 px.
- Respeitar safe areas superior e inferior.

---

## 5. Raios, bordas e forma

| Token | px | Uso |
|---|---:|---|
| `radii.xs` | 6 | indicador pequeno |
| `radii.sm` | 8 | chip/mini card |
| `radii.control` | 10 | botão compacto, input e ícone |
| `radii.md` | 12 | input e CTA |
| `radii.lg` | 14 | card e agrupamento |
| `radii.xl` | 16 | card principal/modal |
| `radii.xxl` | 18 | navegação e card premium |
| `radii.pill` | 999 | avatar, badge e pílula |

Padrão proprietário: CTAs e pôsteres prioritários podem ter o canto inferior direito quadrado (`borderBottomRightRadius: 0`). Não usar esse corte em campos de formulário ou cards utilitários.

Bordas são normalmente de **1 px**, branco entre 6% e 12%. O foco usa azul claro; o erro usa vermelho.

---

## 6. Elevação e sombra

- `shadows.card`: elevação discreta para superfície flutuante.
- `shadows.accent`: glow azul para CTA primário ou seleção importante.
- `shadows.nav`: sombra ascendente da barra inferior.

Sombras devem funcionar em iOS (`shadow*`) e Android (`elevation`). Nunca depender apenas da sombra para comunicar estado: combinar com cor, borda ou ícone.

---

## 7. Iconografia

Os ícones são vetoriais, outline, com `strokeWidth` padrão de **1,7**, cantos e terminações arredondados.

- Pequeno: `sizes.iconSm` = 14 px.
- Médio: `sizes.iconMd` = 18 px.
- Padrão/grande: `sizes.iconLg` = 22 px.
- Ícone ativo: `colors.accentHi` ou branco.
- Ícone inativo: `colors.faint`.
- Ícones de marca (Google/Apple) preservam cores/regras próprias.

Todo ícone interativo precisa estar dentro de uma área tocável de pelo menos **44 × 44 px**, mesmo quando o desenho for menor.

---

## 8. Componentes

### Botão primário

- Altura: 58 px (`sizes.controlLg`).
- Gradiente `gradients.brand`.
- Raio 12 px, com canto inferior direito quadrado quando for CTA editorial.
- Texto `typography.button`, branco e caixa alta.
- Estado desabilitado: opacidade 35%, sem glow.
- Pressionado: reduzir opacidade para 82% ou aplicar feedback equivalente.

### Botão secundário/ghost

- Altura: 58 px.
- Fundo branco 5%, borda branca 12%, raio 14 px.
- Texto Archivo 600, 14 px.

### Card

- Gradiente `gradients.glass`.
- Borda `colors.cardBorder`, 1 px.
- Raio padrão 16 px.
- Padding recomendado 16 px.
- `HudCorners` é reservado para pôster, plano e blocos de alta prioridade.

### Campo de entrada

- Altura mínima: 48 px.
- Fundo branco 3–4%, borda branca 9%, raio 10–12 px.
- Texto Archivo 500, 14 px; placeholder `colors.faint`.
- Foco: borda azul claro.
- Erro: borda `colors.danger` e mensagem em vermelho claro abaixo do campo.
- Desabilitado: opacidade 35%, mantendo legibilidade do valor.

### Label de seção

- Usar `Slash`/`MonoLabel`: `//` azul + texto mono em caixa alta.
- Tamanho padrão 10 px e tracking 2 px.

### Barra inferior

- Superfície azul-marinho translúcida, raio 18 px e borda branca 7%.
- Quatro destinos: início, treino, progresso e perfil.
- Estado ativo precisa combinar ícone, cor e label; não depender apenas de glow.

### Modal

- Scrim `colors.overlayStrong`.
- Largura máxima de 340 px e raio 16 px.
- Ação primária primeiro; ação de cancelamento com contraste secundário.
- Toque no scrim pode fechar apenas quando não houver perda de dados.

### Estado vazio, loading e feedback

- Loading global sobre `colors.bg`, spinner `colors.accentHi`.
- Sucesso: verde + ícone/texto; erro: vermelho + explicação acionável.
- Um estado vazio deve explicar o motivo e oferecer a próxima ação, não exibir apenas “—”.

---

## 9. Movimento

| Token | Duração | Uso |
|---|---:|---|
| `motion.duration.fast` | 120 ms | pressão e microfeedback |
| `motion.duration.normal` | 200 ms | chevron, expansão e troca simples |
| `motion.duration.slow` | 320 ms | entrada/saída de bloco |
| `motion.tickerLoop` | 18 s | ticker contínuo da home |

Movimento deve comunicar causalidade. Respeitar a preferência do sistema por movimento reduzido ao adicionar novas animações não essenciais.

---

## 10. Acessibilidade e conteúdo

- Área tocável mínima de 44 × 44 px.
- Não comunicar sucesso, erro ou seleção somente por cor.
- Textos de corpo devem manter contraste alto sobre o fundo escuro.
- `colors.faint` é adequado para metadados; não usar em texto essencial ou longo.
- Pressables com ícone precisam de `accessibilityRole` e `accessibilityLabel` localizados.
- O app suporta pt-BR, en e es: não fixar largura de texto e validar expansão das traduções.
- Evitar caixa alta em frases longas; ela fica reservada a títulos curtos, labels e CTAs.
- Formulários devem indicar erro próximo ao campo e preservar o valor digitado.

---

## 11. Uso no código

```tsx
import { colors, radii, spacing, typography } from '../theme/tokens';

<View
  style={{
    padding: spacing[4],
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  }}
>
  <Text style={[typography.title, { color: colors.text }]}>Resumo</Text>
  <Text style={[typography.body, { color: colors.textSecondary }]}>Conteúdo</Text>
</View>
```

Para valores fracionários no objeto `spacing`, usar colchetes: `spacing[2.5]`.

---

## 12. Governança

Ao criar ou revisar uma tela:

1. Usar primeiro um token semântico existente.
2. Se o valor se repetir em três ou mais contextos, transformá-lo em token.
3. Criar uma nova cor somente quando ela tiver papel semântico distinto.
4. Validar loading, vazio, erro, desabilitado, pressionado, foco e sucesso.
5. Verificar iOS e Android, safe areas, teclado e escala de texto.
6. Atualizar este documento quando um padrão visual novo for aprovado.

### Débito visual identificado

O inventário atual contém várias opacidades e tamanhos próximos aplicados inline. Eles foram preservados para evitar regressão visual. Novos componentes devem usar os tokens deste documento; a migração das telas existentes deve ser gradual e acompanhada de comparação visual por tela.
