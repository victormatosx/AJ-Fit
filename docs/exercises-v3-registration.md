# AJ Fit — Etapa 2: cadastro local V3

Commit de referência: `18c27fc98439c7722b979592494a0eb57cb92bf7`.

## Resultado

41 identidades reconfirmadas e cadastradas como rascunhos locais: 38 no shape existente ExerciseSeedInput e três atividades cardio no shape CanonicalActivity, com os mesmos campos de bloqueio do exercício por interseção de tipos. Zero exercícios ativados, zero reutilizações entre os 41 solicitados, zero vídeos novos associados. A etapa permanece pendente de mídia correspondente e revisão especializada; não está concluída para uso operacional.

A Flexão de Joelho Deslizante, citada na planilha mas fora dos 41 pedidos desta etapa, continua sendo `slider-leg-curl`; nenhum segundo cadastro foi criado.

## Isolamento e tipos

`src/data/exercisesV3DraftData.ts` é um registro de autoria local, separado das coleções operacionais EXERCISES_SEED e CANONICAL_ACTIVITIES. Não é um novo schema de exercício. Usa os tipos existentes e não altera enums, algoritmos, templates nem identidade publicada. Os 38 rascunhos de resistência passam pelo validador atual junto dos 130 exercícios anteriores. As três atividades não recebem músculo principal inventado.

Não se deve adicionar rascunhos ao seed operacional: o loader exige a existência remota de todos os IDs do seed; a composição inclui o seed no hash do catálogo e deriva similares por família. Mesmo um exercício draft adicionado ali poderia alterar o funcionamento sem publicação coordenada. Os rascunhos têm status=draft e as três disponibilidades=false; não possuem grupo, similares ou variantes de substituição.

Os ambientes são metadados editoriais da aba Novos Exercícios da V3, não alterações no gate atual. A unidade é indicada pelos campos já existentes reps ou duration: duração para Cadeirinha na Parede, Prancha Lateral e as três atividades cardio. Não foram inventadas doses. Barra fixa/paralelas exigem os apoios físicos descritos nas instruções; o enum atual bodyweight não representa esses apoios separadamente. A taxonomia não representa anti-flexão lateral separadamente; a prancha lateral usa o padrão de estabilização existente e continua pendente de revisão, sem adicionar enum nesta etapa.

## Limitações

Cada cadastro contém as sete regiões explicitamente pending. Nenhuma região foi declarada compatible/not_applicable, nenhuma restrição foi inferida por omissão e nenhum perfil clínico de outro exercício foi copiado. Cada objeto é independente.

O schema existente exige reviewStatus=approved e reviewBasis=product_policy mesmo quando as regiões estão pending. Esse envelope aprova somente a política técnica de bloquear decisões não revisadas; **não significa aprovação clínica**. A validação confirma o shape, não segurança. Os testes mostram rejeição das 38 identidades pelo avaliador manual e pelo avaliador clínico para cada região, inclusive se forem injetadas acidentalmente no catálogo.

## Vídeos: arquitetura existente

- Produção/obtenção: gravação original e upload manual pelo painel ajfit-admin; não foi encontrado gerador de demonstrações no projeto.
- Armazenamento: Firebase Storage; os documentos só guardam execution.videos.vertical/horizontal com url e storagePath. Paths de destino seguem exercises/{id}/execution/{vertical,horizontal}.mp4; nenhum path ou URL de destino foi preenchido sem objeto existente.
- Formato do fluxo administrativo: MP4/H.264, MIME video/mp4; duas orientações independentes, quadrados rejeitados. Não há resolução fixa imposta no código. O exemplo local horizontal existente mede 832×464 a 60 fps.
- Carregamento: consultas Firestore direcionadas em lotes de até 30 IDs. O hook resolve uma vez por conjunto de IDs, descarta respostas antigas e não introduz um cache persistente próprio. ExerciseGif usa fontes URI/asset; não habilita explicitamente useCaching do expo-video.
- Exibição: o mesmo ExerciseGif atende banner, modal e miniaturas de substituição. Prioridade: vídeo próprio da orientação, asset local, duas imagens em crossfade, estado indisponível. Erros são isolados por ID/fonte/orientação; o fallback não aparece antes da consulta de vídeo próprio terminar.
- Reprodução: configureSilentDemoVideo mantém mixWithOthers antes de mute, loop, sem Now Playing, playback externo ou reprodução em background. AppState pausa fora do app e retoma em primeiro plano.
- O crossfade de duas imagens não é vídeo correspondente e não foi usado para cumprir esta etapa.

## Fontes examinadas e resultado da mídia

Foram examinadas as 58 gravações da pasta local `/Users/victor/CropSight-Solutions/AJ Fit Videos Exercicios`, os sete MP4 de assets/videos e o fluxo administrativo em ajfit-admin. O JSON de auditoria registra os arquivos originais e seus SHA-256. Nenhuma demonstração exata dos novos movimentos foi confirmada. A existência de uma gravação local não foi usada como certificação de licença; nenhum material externo foi importado.

As sequências IMG_3579/3580 são supino inclinado em máquina articulada, não barra livre. IMG_3563/3564 não demonstram o stiff de joelhos estáveis solicitado. IMG_3610/3611 são rosca com halteres em banco inclinado, não supino reto. As associações candidatas foram descartadas; nenhum derivado foi retido no repositório. Não foi gravado nome de arquivo fictício nem URL presumida. Para **cada** exercício da tabela abaixo, origem e localização do vídeo associado são inexistentes.

## Situação individual

| Exercício | ID | Ambiente | Vídeo | Perfil de limitações | Status final |
|---|---|---|---|---|---|
| Abdução de Quadril na Polia | `cable-hip-abduction` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Adução de Quadril na Polia | `cable-hip-adduction` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Afundo com Halteres | `dumbbell-stationary-lunge` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Agachamento Sumô com Halter | `dumbbell-sumo-squat` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Barra Fixa | `pull-up` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Cadeirinha na Parede | `wall-sit` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Crucifixo Inverso na Máquina | `reverse-pec-deck` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Crucifixo com Elástico | `resistance-band-chest-fly` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Desenvolvimento Arnold | `arnold-dumbbell-press` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Desenvolvimento no Smith | `smith-machine-shoulder-press` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Elevação Frontal com Elástico | `resistance-band-front-raise` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Elevação Frontal na Polia | `cable-front-raise` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Elevação Pélvica na Máquina | `machine-hip-thrust` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Encolhimento com Halteres | `dumbbell-shrug` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Encolhimento no Smith | `smith-machine-shrug` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Extensão de Joelho com Elástico | `resistance-band-knee-extension` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Flexão Fechada | `close-grip-push-up` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Glúteo Quatro Apoios | `quadruped-hip-extension` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Mergulho nas Paralelas | `parallel-bar-dips` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Panturrilha em Pé com Halteres | `standing-dumbbell-calf-raise` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Panturrilha no Degrau | `step-calf-raise` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Panturrilha no Leg Press | `leg-press-calf-raise` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Prancha Lateral | `side-plank` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Pullover com Halter | `dumbbell-pullover` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Pullover na Polia | `straight-arm-cable-pulldown` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Remada Alta com Halteres | `dumbbell-upright-row` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Remada Curvada com Barra | `bent-over-barbell-row` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Rosca Direta com Elástico | `resistance-band-biceps-curl` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Rosca Martelo na Polia | `cable-rope-hammer-curl` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Stiff com Barra | `barbell-stiff-leg-deadlift` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Superman | `superman` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Supino Fechado | `close-grip-barbell-bench-press` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Supino Inclinado com Barra | `incline-barbell-bench-press` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Supino Reto com Barra | `barbell-flat-bench-press` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Tríceps Coice com Halter | `dumbbell-triceps-kickback` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Tríceps Testa com Halteres | `lying-dumbbell-triceps-extension` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Supino Reto com Halteres | `dumbbell-flat-bench-press` | Academia / Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Elevação Pélvica Unilateral | `single-leg-bench-hip-thrust` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Corrida Estacionária | `running-in-place` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Elíptico | `elliptical-trainer` | Academia | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |
| Polichinelo | `jumping-jack` | Casa | Ausente; sem origem/arquivo associado | 7 regiões pending | PENDENTE |

## Validação executada

- TypeScript: npm run typecheck passou.
- ESLint dos dois arquivos TypeScript novos passou.
- Recorte de catálogo, tipos, mídia e silêncio: oito arquivos, 54 testes passaram. Inclui dez testes novos de cobertura das 41 identidades, isolamento, perfis, unidades, equipamentos e variantes.
- Suíte completa: 612 arquivos passaram e 16 falharam; 7862 testes passaram, 44 falharam e 227 foram ignorados. A suíte completa não está aprovada.
- Os 16 arquivos com falhas foram reexecutados em cópia limpa de git archive HEAD com dependências existentes. Houve 44 falhas, com nomes de arquivo e teste idênticos aos da execução atual; zero falhas novas nesse confronto. A lista está no JSON de auditoria.
- Snapshot de regressão dos 130 exercícios e seis atividades (incluindo valores, ordem e relações): SHA-256 dd58787a649949c800deb04d4ebac1426ed39d1ca857b00a7c21edaf2913a11e, aprovado.
- Os testes de áudio são de configuração/lifecycle, não teste nativo com Spotify/Apple Music. Não havia simulador iOS inicializado ou Android conectado; reprodução em aparelho, cache offline real e validação visual dos novos exercícios nas telas não foram aprovados. Não há novos vídeos para essa validação.

## Arquivos e próximos requisitos

Criados: src/data/exercisesV3DraftData.ts, src/data/__tests__/exercisesV3DraftData.test.ts, docs/exercises-v3-registration.md e docs/exercises-v3-audit.json. Nenhum arquivo rastreado anterior foi alterado. Nenhum player, algoritmo, seed operacional, template, perfil publicado ou dado de usuário foi alterado. Nenhum commit, push, deploy ou escrita remota.

Para promover cada cadastro: obter gravação correspondente com procedência/autorização verificável no padrão do projeto; preparar MP4 nas orientações utilizadas e associar arquivos reais; revisar as sete regiões e os metadados que dependem de taxonomia; validar reprodução e áudio externo em iOS/Android; só então habilitar o cadastro no fluxo de publicação separado. Esta etapa não habilita substituições V3.
