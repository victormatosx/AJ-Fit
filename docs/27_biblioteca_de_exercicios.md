# Biblioteca Oficial de Exercícios

## 1. Objetivo

Documentar a collection `exercises/{exerciseId}` — a biblioteca global de
exercícios do AJ Fit, usada (hoje ou no futuro) para geração de treinos,
exibição, substituição, filtros e histórico. Complementa
`03_modelagem_banco_e_dados.md` §6/§7 com o schema definitivo.

Implementação de referência: `src/types/exercise.ts` (tipos + taxonomias),
`src/data/exercisesSeedData.ts` (dataset dos 116 exercícios oficiais),
`src/validators/exerciseValidation.ts` (validação do dataset) e
`scripts/seedExercises.ts` (script de seed).

---

## 2. Natureza do conteúdo

`exercises` é conteúdo administrado, não pelo usuário. Dois caminhos de
escrita legítimos:

1. O script de seed (`scripts/seedExercises.ts`, Firebase Admin SDK,
   Application Default Credentials, nunca uma chave de service account no
   repositório) — usado para carga inicial/em lote.
2. O painel administrativo **ajfit-admin** (`/exercises`), usado por
   administradores autenticados (`users/{uid}.metadata.role == 'admin'`)
   para o CRUD do dia a dia — criar, editar, ativar/desativar, gerenciar
   substituições e anexar/substituir/remover os vídeos de execução. Ver
   `ajfit-admin/docs/exercises-admin.md` para a documentação do painel.

Usuários comuns (não-admin) só leem.

Ver `firestore.rules`, `match /exercises/{exerciseId}`: leitura liberada
para qualquer usuário autenticado; `create`/`update` liberados apenas para
`isAdmin()` (mesmo mecanismo usado por `supportTickets`); `delete` sempre
negado, mesmo para admins — exercícios podem ser referenciados por
histórico de treino (ver §4.1).

---

## 3. Política de IDs

O `id` do documento (e o campo `slug`) é um slug estável em inglês,
independente do nome de exibição:

```txt
exercises/barbell-back-squat
exercises/incline-dumbbell-bench-press
exercises/cable-face-pull
```

Nunca usar IDs aleatórios do Firestore. Nunca renomear um `id` só porque a
tradução exibida mudou — o nome de exibição vive em `name.{ptBR,en,es}`,
não no `id`.

Nos 79 documentos gravados pelo seed inicial, a identidade canônica é o ID
do documento e o corpo não contém o campo duplicado `id` (o seed o remove
antes da escrita). O painel pode persistir `id` em documentos novos; quando
presente, ele deve continuar igual ao ID do documento. As Rules aceitam os
dois formatos sem permitir divergência de identidade.

---

## 4. Schema

```typescript
type Exercise = {
  id: string;
  slug: string; // igual a `id`
  name: { ptBR: string; en: string; es: string };
  status: 'active' | 'inactive' | 'draft';

  target: {
    primaryMuscle: MuscleId;
    primaryRegion?: MuscleRegionId;
    secondaryMuscles: MuscleId[];
  };

  movement: {
    pattern: MovementPattern;
    mechanic: 'compound' | 'isolation';
    laterality: 'bilateral' | 'unilateral' | 'alternating';
  };

  equipment: EquipmentId[];
  bodyPosition?: 'standing' | 'seated' | 'lying' | 'kneeling' | 'hanging';

  execution: {
    videos?: {
      vertical?: { url: string; storagePath: string };
      horizontal?: { url: string; storagePath: string };
    };
    thumbnailUrl?: string;
  };
  instructions?: { ptBR: string[]; en?: string[]; es?: string[] };

  substitution: { group?: string; similarExerciseIds: string[] };

  difficulty: 'beginner' | 'intermediate' | 'advanced';
  availability: {
    workoutGeneration: boolean;
    manualSelection: boolean;
    substitution: boolean;
  };

  tags?: string[];
  metadata: { version: number; createdAt: Timestamp; updatedAt: Timestamp };
};
```

`metadata.createdAt`/`updatedAt` are always `serverTimestamp()` — never a
device-side `new Date()`.

### 4.1 `status` vs `availability`

`status` and `availability` are deliberately separate:

- `status: 'inactive'` — the exercise is fully retired from the app (kept
  for historical workout records that reference it).
- `availability.{workoutGeneration,manualSelection,substitution}` — finer
  per-flow toggles, e.g. disabling an exercise from auto-generation while
  still allowing manual selection.

**An exercise is never deleted once it has been used in the app.**
Retiring one means flipping `status`/`availability`, not removing the
document — deleting it would break historical workout records that
reference its id.

### 4.2 Vídeos de execução (`execution.videos`)

Cada exercício pode ter até dois vídeos de execução, ambos opcionais e
independentes: `vertical` e `horizontal`. Evoluído a partir de um shape
anterior de vídeo único (`execution.videoUrl`) — nenhum dos 79 exercícios
tinha esse campo preenchido no momento da mudança, então não houve
migração de dados.

- Armazenamento: Firebase Storage, nunca Firestore (sem blob/base64).
  Path determinístico: `exercises/{exerciseId}/execution/{vertical,horizontal}.mp4`.
- Formato aceito: exclusivamente `.mp4` (`video/mp4`, H.264), validado por
  extensão e MIME tanto no cliente quanto no Storage Rules (`storage.rules`).
  Era `.webm` originalmente; migrado porque `expo-video`/AVFoundation no
  iOS não decodifica WebM — todo vídeo `.webm` falhava silenciosamente ao
  abrir "Ver Execução" no app, mesmo com a referência correta no
  Firestore/Storage (ver `src/components/fitness/ExerciseGif.tsx`).
- Orientação: validada no cliente lendo as dimensões reais do vídeo antes
  do upload — vertical exige altura > largura, horizontal exige largura >
  altura; vídeos quadrados são rejeitados nos dois slots.
- `url`/`storagePath` no Firestore são só metadados de localização — a
  fonte da mídia é sempre o Storage.
- Gerenciados exclusivamente pelo painel `ajfit-admin` (anexar, substituir,
  remover). O seed script não popula vídeos.
- O gate administrativo das Storage Rules lê
  `users/{uid}.metadata.role` no Firestore com `firestore.get/exists`. Em
  produção isso exige que o service agent do Cloud Storage possua
  `roles/firebaserules.firestoreServiceAgent`; o emulador não valida esse
  vínculo IAM. Antes/depois de publicar as Rules, valide o projeto real com
  `npm run check:storage-iam -- --project ajfit-2f321`.
- Limite de tamanho: **não há política de negócio definida ainda.** O
  painel aplica um teto técnico de 100 MB só para não deixar o Storage sem
  cota nenhuma — não é um limite aprovado, revisar quando essa decisão for
  tomada.

---

## 5. Taxonomias

### 5.1 Músculos (`MuscleId`)

```txt
chest, lats, upper_back, traps, lower_back,
front_deltoid, side_deltoid, rear_deltoid,
biceps, triceps, forearms,
quads, hamstrings, glutes, adductors, abductors, calves, abs
```

### 5.2 Regiões (`MuscleRegionId`, opcional via `target.primaryRegion`)

```txt
upper_chest, mid_chest, lower_chest,
upper_lats, mid_back, upper_traps, lower_back,
front_deltoid, side_deltoid, rear_deltoid, rectus_abdominis
```

Usado só quando agrega valor biomecânico real (ex.: supino inclinado →
`upper_chest`; remada → `upper_back` + `mid_back`). Não usado em todo
exercício.

### 5.3 Padrões de movimento (`MovementPattern`)

```txt
horizontal_push, vertical_push, horizontal_pull, vertical_pull,
squat, hinge, lunge,
knee_extension, knee_flexion, hip_extension, hip_abduction, hip_adduction,
elbow_flexion, elbow_extension,
shoulder_abduction, shoulder_flexion,
scapular_retraction, scapular_elevation, horizontal_adduction,
calf_raise, core_flexion, core_anti_extension, core_anti_rotation,
loaded_carry, gait, cycling, balance, mobility, breathing
```

`scapular_elevation` (encolhimento de trapézio) e `horizontal_adduction`
(voador/crucifixo/peck deck) foram adicionados além da lista de referência
original porque nenhum padrão listado descrevia esses movimentos sem
forçar uma classificação biomecanicamente errada.

### 5.4 Equipamentos (`EquipmentId`)

```txt
bodyweight, barbell, dumbbell, cable, machine,
smith_machine, hack_machine, leg_press, bench,
roman_chair, mini_band, ez_bar, resistance_band, chair, step,
stationary_bike, slider
```

Nota: esta lista é intencionalmente diferente (e menor) do vocabulário
usado no seletor de equipamentos do onboarding
(`src/components/fitness/EquipmentPicker.tsx`, baseado na taxonomia do
ExerciseDB). São dois domínios distintos — um descreve o **inventário do
usuário**, o outro descreve **o que um exercício exige** — e não devem ser
unificados sem uma decisão de produto explícita.

### 5.5 Mecânica, lateralidade, dificuldade, status

```txt
mechanic:    compound | isolation
laterality:  bilateral | unilateral | alternating
difficulty:  beginner | intermediate | advanced
status:      active | inactive | draft
```

---

## 6. Substituição

Cada exercício tem:

```typescript
substitution: { group?: string; similarExerciseIds: string[] };
```

`group` identifica uma família funcional (ex.: `hip_hinge`,
`horizontal_back_row`, `quad_squat`, `biceps_curl`). Exercícios do mesmo
grupo compartilham músculo principal, padrão de movimento e mecânica por
construção — é a partir disso, e não apenas do músculo trabalhado, que o
dataset oficial deriva `similarExerciseIds` automaticamente
(`buildSubstitutions` em `exercisesSeedData.ts`): dentro do grupo,
exercícios com a mesma lateralidade são preferidos e listados primeiro,
até um máximo de 4 IDs. Um exercício sozinho em seu grupo (ex.: Prancha,
Tríceps Banco) fica com `similarExerciseIds: []` — nenhuma substituição
forçada.

Todo `similarExerciseIds` referencia apenas IDs que existem no próprio
seed; nenhum exercício se autorreferencia.

Grupos usados no seed atual: `vertical_back_pull`, `horizontal_back_row`,
`horizontal_chest_press`, `chest_fly`, `shrug`, `rear_delt_fly`,
`vertical_shoulder_press`, `front_raise`, `lateral_raise`, `biceps_curl`,
`triceps_extension`, `hip_hinge`, `hip_extension`, `hip_adduction`,
`hip_abduction`, `quad_squat`, `knee_extension`, `hamstring_curl`,
`lunge`, `back_extension`, `calf_raise`, `abs_flexion`.

---

## 7. Seed

Script: `scripts/seedExercises.ts` (rodado via `npm run seed:exercises`).

- Fonte de dados: `src/data/exercisesSeedData.ts` (116 exercícios).
- Valida o dataset inteiro antes de qualquer chamada de rede
  (`validateExerciseSeed`): total, IDs/slugs/nomes ptBR únicos, enums,
  `similarExerciseIds` existentes, nenhuma autorreferência, nenhuma URL
  inventada em `execution`.
- **Dry-run por padrão.** Sem flags, o script conecta ao Firestore, lê o
  que já existe, mostra o plano (quantos criar/ignorar) e **não
  escreve**. Escrita real exige `npm run seed:exercises -- --confirm`.
- Idempotente e conservador: reexecutar não duplica documentos (`id` = doc
  id), não altera documentos existentes e nunca deleta nada. Novos
  documentos recebem `metadata.createdAt` e `metadata.updatedAt` com
  `serverTimestamp()`.
- Usa Application Default Credentials — nunca uma chave de service account
  no repositório. Rodar `gcloud auth application-default login` antes de
  usar `--confirm`.
- Este repositório só tem um projeto Firebase configurado
  (`.firebaserc` → `production`/`ajfit-2f321`). Não existe staging/dev:
  toda escrita real do seed vai direto para esse projeto.

---

## 8. Índices

Nenhum índice composto foi adicionado em `firestore.indexes.json` para
esta tarefa: as consultas previstas hoje (`status == 'active'`,
`target.primaryMuscle == '...'`, `substitution.group == '...'`,
`movement.pattern == '...'`) são igualdades de campo único, cobertas pelos
índices automáticos do Firestore. Um índice composto só deve ser
adicionado quando uma query real implementada precisar dele.
