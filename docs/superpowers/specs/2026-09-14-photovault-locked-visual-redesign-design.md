# Redesign visual do estado bloqueado — Photo Vault / Evolução

Data: 2026-09-14
Status: aprovado para implementação
Escopo: apenas a apresentação visual do estado bloqueado da galeria (`ProgressPhotosScreen`). Sem mudanças em criptografia, sessão, persistência ou política de acesso às fotos.

---

## 1. Problema

O estado bloqueado hoje é uma tela decorativa separada (`PhotoVaultLockedState.tsx` + `PhotoVaultProtectedIntro.tsx`): ilustração de cards empilhados, título grande, descrição e um `CtaButton` de largura total. Não se parece com a galeria em si.

Objetivo: o estado bloqueado deve parecer a própria galeria já aberta (mesmo header, mesma estrutura, mesmo grid, mesmos espaçamentos, mesmo fundo), porém com o conteúdo do grid fortemente borrado e um único controle central — um cadeado — para desbloquear.

## 2. Auditoria do fluxo atual

- `ProgressPhotosScreen.tsx:151-180,515-532`: `unlocked = status === 'unlocked'`. Quando `!unlocked`, retorna cedo com `pageHeader` + `PhotoVaultLockedState` + `pageFooter` dentro de um `ScrollView`; `PhotoVaultGrid` só existe no branch `unlocked`. `loadGallery()` só roda em `useEffect` disparado por `unlocked === true`.
- `PhotoVaultLockedState.tsx` (186 linhas): recebe `status: 'locked' | 'authenticating'`, `issue: PhotoVaultIssue | null`, `onUnlock: () => void`. Renderiza `PhotoVaultProtectedIntro` (ilustração, sem dados reais) + badge + título + descrição + erro opcional + CTA. Nunca recebe contagem/conteúdo do vault — não pode vazar se está vazio ou cheio.
- `PhotoVaultGrid.tsx` / `PhotoVaultDayRow.tsx`: grid real é uma `FlatList` virtualizada de dias; cada célula (`PhotoCell`) usa `CELL_HEIGHT = 148`, gaps de `theme.spacing[2]`, `Image` do React Native (não `expo-image`, deliberado — evita cache em disco de plaintext), skeleton (`testID="photo-vault-thumbnail-skeleton"`) enquanto carrega.
- Biometria: `src/services/localAuthentication.ts` (`authenticateForPhotoVault`) → `src/lib/photoVaultLock.ts` (`unlockPhotoVault`). Já existe um guard `inFlight` (promise singleton no módulo) que impede prompts concorrentes — **não precisa ser reimplementado na UI**. `status` já transiciona para `'authenticating'` de forma síncrona antes do prompt nativo.
- **Achado crítico de segurança (confirmado seguro)**: nenhum dado de foto é descriptografado antes da autenticação. `requirePhotoVaultUnlocked` / `currentUnlockedUid` (`photoVaultSession.ts`, `progressPhotos.ts`) bloqueiam qualquer decrypt/download até existir uma sessão em memória aberta por `openPhotoVaultSession`, que só é chamada dentro de `runUnlock` após o prompt nativo ter sucesso. `photoVaultPlaintextAudit.test.ts` audita isso automaticamente. `PhotoVaultGrid` nunca é montado antes do unlock (garantido pelo early-return e testado por `photoVaultUiStructure.test.ts`).
- `expo-blur` não está instalado (só `expo-linear-gradient`). Compatível com Expo SDK 56 via `npx expo install expo-blur` (confirmado na doc versionada).
- `react-native-reanimated@4.3.1` já está em uso no projeto (ex: `PhotoVaultViewer.tsx`) — usar para as animações de transição/shake.
- `Icon.tsx` tem `lock` mas não tem variante de cadeado aberto — precisa de uma nova entrada no union `IconName`.

### 2.1 Implicação de arquitetura

Como nenhum dado real pode existir em memória antes do unlock, o "grid borrado" não pode ser o grid real com blur por cima — teria que ser dados reais renderizados antes da autenticação, o que violaria a garantia atual. A solução é um **esqueleto estático** que reproduz a forma/layout do grid real (mesmas constantes de espaçamento/altura), sem nenhum dado, foto ou `Image` real por trás do blur.

## 3. Arquitetura aprovada

```text
ProgressPhotosScreen (pageHeader sempre visível, sem blur)
  └─ showLocked (estado local, não é só `!unlocked`)
       true  → <PhotoVaultLockedState status issue onUnlock onRevealComplete />
                 ├─ <PhotoVaultGallerySkeleton />         (estático, sem dados reais)
                 ├─ <BlurView> sobre o skeleton            (novo: expo-blur)
                 └─ cadeado central (círculo tocável)
       false → <PhotoVaultGrid ... /> (fluxo atual, inalterado)
```

`showLocked` começa `true` quando `!unlocked` e só vira `false` via callback `onRevealComplete`, disparado pelo próprio `PhotoVaultLockedState` ao final da animação de sucesso. Isso preserva a garantia existente ("grid real nunca monta antes do unlock real") apenas adiando o *reveal visual* por uma fração de segundo controlada localmente — a autenticação em si não muda.

## 4. Componentes

### 4.1 `PhotoVaultGallerySkeleton.tsx` (novo)

Réplica puramente visual e estática da estrutura do grid real, usando as mesmas constantes de `PhotoVaultDayRow` (altura de célula, gaps, raio, cores de tema). Sem `FlatList`, sem dados de dia/foto reais, sem `Image`, sem import de qualquer módulo de vault/crypto/rede. Gera um número fixo de linhas/células placeholder (blocos translúcidos no estilo do skeleton que `PhotoCell` já usa) — o suficiente para preencher a tela, sem implicar contagem real de fotos ou datas reais.

### 4.2 `PhotoVaultLockedState.tsx` (reescrito)

Novo props:
```ts
interface Props {
  status: 'locked' | 'authenticating';
  issue: PhotoVaultIssue | null; // inclui 'notConfigured'
  onUnlock: () => void;
  onRevealComplete: () => void;
}
```

Renderiza `PhotoVaultGallerySkeleton` + `BlurView` (intensidade alta, ex. 90) + cadeado central. Sem card, sem título, sem descrição, sem CTA de largura total.

**Cadeado central**: círculo tocável (~64–72dp de diagonal, área de toque adequada), ícone `lock` por padrão. Cor de fundo/ícone com três estados:
- Neutro (tema atual) — padrão e durante `authenticating` (com opacidade reduzida para indicar estado ocupado, sem spinner grande).
- **Vermelho** — quando `issue` é setado após falha/cancelamento (junto com shake, ver §6).
- **Verde** — brevemente durante a transição de sucesso, antes do blur sumir (ver §7).

Caso `issue === 'notConfigured'`: mesmo cadeado central, com um badge de alerta sutil sobreposto; toque chama `Linking.openSettings()` em vez de `onUnlock`.

### 4.3 `Icon.tsx`

Adicionar variante `lock-open` ao union `IconName`, seguindo o mesmo padrão SVG (`Rect` + `Path`) do `lock` atual, para o ícone de cadeado aberto usado na transição de sucesso.

## 5. Interação (toque no cadeado)

1. Toque dispara `onUnlock` → fluxo de biometria existente (`unlockPhotoVault`), incluindo fallback nativo de senha/PIN (já suportado, `disableDeviceFallback: false`).
2. Enquanto `status === 'authenticating'`, o cadeado fica com toque desabilitado (guard de UI, redundante com o guard `inFlight` já existente no módulo — mantém defesa em profundidade sem duplicar lógica).
3. Caso `notConfigured`, toque abre configurações do dispositivo em vez de autenticar.

## 6. Falha / cancelamento

- `status` volta para `'locked'`, `issue` é setado.
- Cadeado faz **shake** (Reanimated, `withSequence` de `translateX`) e fica **vermelho** por um curto período (ex. ~600ms), depois volta à cor neutra, permanecendo fechado.
- Sem texto visível — mas o erro é **anunciado para leitor de tela** via `AccessibilityInfo.announceForAccessibility`, usando as strings i18n de erro já existentes (`progress.photos.authError.*`), preservando acessibilidade sem reintroduzir texto visual.
- Nenhum conteúdo é revelado; blur e skeleton permanecem.

## 7. Sucesso

Sequência dentro de `PhotoVaultLockedState`, disparada quando `unlockPhotoVault` resolve com sucesso:

1. Cadeado fica **verde**.
2. Ícone troca de `lock` → `lock-open` (crossfade curto).
3. Blur anima de intensidade alta para 0 (Reanimated, ~350–450ms).
4. Ao final da animação, chama `onRevealComplete()` — só então `ProgressPhotosScreen` desmonta o overlay e o `PhotoVaultGrid` real é montado (que já dispara `loadGallery()` normalmente).

Do desbloqueio em diante, upload, visualização, navegação, exclusão e comparação seguem exatamente o fluxo atual — nada nesses caminhos é alterado.

## 8. Segurança — garantias preservadas

- Nenhuma foto real, thumbnail, URI ou dado de vault existe em `PhotoVaultGallerySkeleton` ou `PhotoVaultLockedState` — apenas formas estáticas.
- `PhotoVaultGrid` continua não sendo montado antes do desbloqueio real (adiado apenas pela animação local de `showLocked`, nunca pela ausência de autenticação bem-sucedida).
- Nenhuma mudança em `photoVaultLock.ts`, `photoVaultSession.ts`, `localAuthentication.ts`, criptografia ou cache em disco.
- O blur é puramente estético sobre conteúdo já não-sensível (placeholders) — não é a fronteira de segurança; a fronteira continua sendo a autenticação nativa.

## 9. Testes

- `src/screens/__tests__/photoVaultUiStructure.test.ts`: reescrever as asserções estruturais para a nova árvore (`PhotoVaultGallerySkeleton`, `BlurView`, cadeado), **mantendo** as proibições de segurança (nenhum `Image`/`decrypt`/`vaultKey`/`localAuthentication`/`AsyncStorage`/`SecureStore`/import de Firebase nos componentes do estado bloqueado) e a garantia de que o grid real não é montado antes do unlock bem-sucedido.
- `src/i18n/__tests__/photoVaultLockedContent.test.ts`: mantém-se sem alteração — não há novo texto visível; strings i18n existentes são reaproveitadas (algumas passam a ser usadas só para acessibilidade, não visualmente).
- Novos testes a considerar: `PhotoVaultGallerySkeleton` não importa nada de crypto/rede/vault; transição de estado `authenticating → locked` (falha) não altera `showLocked`; transição `unlocked` só desmonta o overlay após `onRevealComplete`.

## 10. Fora de escopo

Não serão alterados: `photoVaultLock.ts`, `photoVaultSession.ts`, `localAuthentication.ts`, `progressPhotos.ts` (decrypt/download), `photoVaultEncryptedCache.ts`, política de acesso, i18n de erro (conteúdo textual), `PhotoVaultViewer`, `PhotoVaultDayRow`/`PhotoVaultGrid` reais (exceto reaproveitar constantes de layout por leitura).
