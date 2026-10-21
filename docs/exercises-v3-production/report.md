# AJ Fit — Etapa 2.1: produção e integração de demonstrações

## Resultado real

**3 arquivos MP4 produzidos a partir de fontes abertas, associados a três IDs em rascunho. 38 exercícios sem derivado selecionado. Zero vídeos aprovados para publicação. Zero vídeos novos reutilizados da pasta original AJ Fit.** Os três são PRODUZIDO — AGUARDANDO REVISÃO: possuem validação técnica e inspeção visual amostrada, mas faltam tomada vertical nativa, revisão humana do clipe/loop inteiro e testes nativos. Não há exercício ativado.

Foram gastos **US$0** em serviços. Nenhuma geração paga, contratação, upload externo, escrita no Firebase, publicação, deploy, commit ou push. Não foram alterados os cadastros/perfis de limitações, algoritmos ou exercícios anteriores.

## Auditoria do padrão existente

As 58 gravações em AJ Fit Videos Exercicios foram reconferidas por SHA-256 contra o inventário anterior: nenhuma mudou. A triagem visual anterior foi reavaliada nos candidatos e comparada às definições dos 41. Nenhuma correspondência exata nova foi confirmada. Não se considerou autorização comercial a mera existência de um arquivo na pasta.

O padrão é demonstração humana em academia real, com câmera lateral/oblíqua e pares de tomadas. Os masters MOV incluem HEVC/HLG e rotação de exibição; não devem ser confundidos com a entrega MP4 do app. Os sete MP4 existentes foram reinspecionados: H.264 a 60 fps, duração entre 9,56 e 19,89 s. As demos locais de supino máquina medem 832×464 (horizontal, 17,69 s) e 464×832 (vertical, 15,24 s). Têm áudio AAC embutido, silenciado pelo player. Não há uma resolução mínima/fixa de negócio no cadastro.

O painel ajfit-admin aceita MP4 e orientações independentes e usa Firebase Storage em exercises/{id}/execution/{vertical,horizontal}.mp4. Firestore guarda apenas os metadados execution.videos. Nenhuma referência remota foi criada para os pilotos locais.

ExerciseGif mantém a prioridade vídeo próprio → asset local → crossfade de imagens → indisponível. O hook consulta somente os IDs necessários, em lotes de até 30, com estado em memória por conjunto de IDs; não há cache persistente customizado e o componente não pede useCaching explicitamente. O setup mixWithOthers/muted/loop e o lifecycle de background permanecem intactos. O material silencioso novo também remove fisicamente qualquer faixa de áudio.

## Comparação das soluções

| Alternativa | Fidelidade e clareza | Consistência | Custo para 41 | Prazo e manutenção | iPhone / direitos | Decisão |
|---|---|---|---|---|---|---|
| Gravação própria + processamento em lote | Execução revisável em pessoa, equipamento e pegada exatos | Melhor correspondência com AJ Fit; mesmas condições de câmera e demonstrador | Licença/processamento local R$0. Planejamento de 6–10 h; a R$100/h seriam R$600–1.000, sem cotação contratual e excluindo academia/modelo/deslocamento/impostos | Uma ou duas sessões de captação, mais QA; masters próprios facilitam refilmagem | Exportação H.264 local; obter autorização de imagem/uso dos participantes | **Escolhida para concluir os 41 com identidade visual completa** |
| wger / CC BY-SA 4.0 | Humanos reais; conferir cada variante e tomada, sem aprovação automática | Pilotos usam o mesmo demonstrador e academia, mas não reproduzem exatamente a identidade visual AJ Fit | US$0 de licença; três pilotos produzidos. Catálogo consultado: 932 exercícios, somente 78 vídeos, sem cobertura comprovada dos 41 | Download e conversão em lote; revisão e tomadas verticais ainda necessárias | Permite uso comercial/adaptação com crédito, licença e ShareAlike da mídia. Manter avisos acessíveis antes da distribuição | **Alternativa gratuita concreta, em avaliação local** |
| MuscleWiki API | Demonstrações profissionais; cobertura exata precisa ser confirmada | Biblioteca coerente, visual diferente; preservar branding | TESTING US$10/mês; GROWTH US$39,99/mês. Não é aquisição dos 41 arquivos | Dependência recorrente de API/tokens; cada Range consome chamada | Termos proíbem download/re-hosting; só cache transitório | **Incompatível com obter arquivos locais nestes termos** |
| ExerciseDB / AscendAPI | Base de exercícios ampla; examinar execução individual | Biblioteca própria | Cotação/plano, sem custo total confirmado para exportação | API recorrente | Termos consultados proíbem armazenamento persistente e restringem cache | **Não baixar/re-hospedar sem licença escrita diferente** |
| WorkoutLabs / animações licenciadas | Animações exigem conferir gesto e aparelho | Coerência alta dentro da biblioteca; estilo ilustrado difere do app | Licença escrita sob orçamento, nenhum valor inventado | Catálogo pronto pode acelerar; cobertura/exportação precisam constar do contrato | Apps e derivados exigem licença específica | **Alternativa comercial sob orçamento, não contratada** |
| IA generativa — Runway gen4_turbo como referência de custo | Não há teste de fidelidade nesta execução. Risco técnico de mudar pegada, apoio, contato com aparelho e anatomia exige revisão por movimento | Pode aproximar estética, sem garantir gesto/identidade entre tomadas | 82 clipes × 10 s × US$0,05/s = US$41 por tentativa; três tentativas = US$123, sem imagens, impostos e QA | Lote rápido após autorização, mas rejeições/refações podem dominar o custo | Direitos comerciais sujeitos aos termos do provedor e referências; upload e cobrança precisam de aprovação | **Não executar lote de 41 sem piloto e custo aprovados** |
| Animação 3D com rig e movimento validado | Controle explícito possível, mas 41 gestos/aparelhos exigem animação e revisão | Coerência alta se um único rig/cenário; diferente de demonstração humana filmada | Ferramentas podem ser gratuitas; artista/mocap sob orçamento. Não há rig/arquivo de movimentos nem Blender no ambiente identificado | Setup maior; excelente reuso futuro se houver investimento | Render MP4 funciona; direitos do rig e de cada movimento precisam ser conferidos | **Infraestrutura indisponível nesta execução; não substituída por boneco simplificado** |

Os valores de gravação são uma hipótese de esforço, **não preço de mercado confirmado**. A IA não foi escolhida apenas pela aparência nem executada com créditos existentes. Um piloto futuro de três movimentos em duas orientações, dez segundos e três tentativas teria US$9 só de vídeo nesse modelo; um teto ilustrativo de US$15 exigiria aprovação prévia e não garantiria aprovação biomecânica.

O conector Higgsfield disponível neste ambiente também foi consultado apenas para leitura e cotação: **Wan 2.6, 720p, 10 segundos = 15 créditos por clipe**. Isso daria **1.230 créditos para 82 clipes**, ou **3.690 créditos para três tentativas**. Não enviei referências, não submeti geração e não usei saldo/franquia gratuita. A cotação não valida entradas ou fidelidade; o valor monetário depende da conta e não foi inferido pela tabela de outra API. Esta alternativa exige aprovação explícita de custo e upload antes de execução.

## Fontes verificadas

- [wger: vídeos e licenças por registro](https://wger.de/api/v2/video/) e [licença 2](https://wger.de/api/v2/license/2/): snapshot reduzido em wger-source-metadata.json. Os arquivos são autorizados por CC BY-SA 4.0, não pela licença do código do wger.
- [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.en): uso comercial/adaptação, atribuição, indicação de alterações e ShareAlike. Não equivale a certificação de técnica nem garantia de todos os direitos de terceiros.
- [MuscleWiki: preços](https://api.musclewiki.com/pricing) e [termos](https://api.musclewiki.com/api-terms), consultados nesta execução: restrições de download, re-hosting e cache de vídeos. Nenhum vídeo foi baixado dessa biblioteca.
- [ExerciseDB: termos](https://exercisedb.notion.site/ExerciseDB-API-Terms-of-Use-226983b728ca8090bf7be79564e4b356): armazenamento persistente proibido no contrato consultado. Nenhum conteúdo dessa API foi baixado.
- [WorkoutLabs: regras de uso](https://workoutlabs.com/use-of-illustrations/): uso em aplicativos e derivados exige licença escrita.
- [Runway API: preços](https://docs.dev.runwayml.com/guides/pricing/) e [uso comercial](https://help.runwayml.com/hc/en-us/articles/18927776141715-Usage-rights): gen4_turbo a cinco créditos/s, crédito US$0,01; nenhuma chamada de geração.
- [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html): liberdade comercial não demonstra existência/adequação de 41 movimentos com aparelhos.

## Produção local e QA

Os três arquivos em assets/videos/exercises-v3 têm 1280×720, H.264 Main/yuv420p, MP4 faststart, duração de 6/7/8 s e **nenhuma faixa de áudio**. Mantêm o movimento em tempo real, sem espelhar, inverter repetição, interpolar corpo, cortar articulações por crop ou inventar uma tomada vertical. Foram completamente decodificados com ffmpeg -xerror. Cada vídeo possui SHA-256, hash do original, autor, URL real, licença, recorte, propriedades técnicas e decisões de revisão no .mp4.json adjacente. As contact sheets têm 12 quadros.

- **Tríceps Coice com Halter**: fonte wger 76. Um halter, apoio da outra mão no banco e extensão unilateral observados. Confirmar estabilidade do ombro e loop completo.
- **Tríceps Testa com Halteres**: fonte wger 60. Extensão de cotovelos deitado, dois halteres e pegada neutra observados. Recorte termina antes da mudança de câmera; amplitude e costura do loop pendentes.
- **Supino Reto com Halteres**: fonte wger 20. Banco reto e dois halteres observados. Selecionada tomada contínua sem corte de câmera; apoio dos pés e loop completo ainda exigem revisão.

Essas observações são limitadas aos quadros amostrados e **não aprovam o clipe inteiro, sua biomecânica, a identidade visual ou a reprodução nativa**. Os três permanecem PRODUZIDO — AGUARDANDO REVISÃO.

Outros candidatos foram rejeitados ou retidos pelos motivos registrados em plan.json: máquina em vez de barra, rosca em vez de supino, baixa resolução, enquadramento insuficiente, ausência de apoio visível e HDR sem tone-map validado. Cinco transferências expiraram incompletas; nenhum arquivo parcial entrou nos assets ou foi tratado como vídeo concluído.

## Integração

exerciseV3VideoAssets.ts associa somente arquivos reais aos três IDs novos. ExerciseGif recebeu apenas a inclusão do registry e suporte tipado a orientação local ausente, como já ocorre nos slots remotos independentes. Seu setup de player, prioridade, áudio, loop, autoplay e lifecycle não mudaram. A orientação ausente é normalizada para null, sem vídeo substituto inventado. A integração é **horizontal e parcial**; a tela vertical não foi declarada concluída.

Os cadastros permanecem em exercisesV3DraftData.ts, fora dos catálogos operacionais, status=draft e todas as disponibilidades=false. Não houve alteração nesse arquivo ou em seus perfis. As mídias novas não tornam um exercício elegível. Antes de publicação, também será necessário tornar os créditos CC acessíveis aos usuários; o aviso local não foi declarado solução de atribuição de produção.

## Situação individual

| Exercício | ID | Origem do vídeo | Status de produção | Status de validação | Status de integração |
|---|---|---|---|---|---|
| Abdução de Quadril na Polia | `cable-hip-abduction` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Adução de Quadril na Polia | `cable-hip-adduction` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Afundo com Halteres | `dumbbell-stationary-lunge` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Agachamento Sumô com Halter | `dumbbell-sumo-squat` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Barra Fixa | `pull-up` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Cadeirinha na Parede | `wall-sit` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Crucifixo Inverso na Máquina | `reverse-pec-deck` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Crucifixo com Elástico | `resistance-band-chest-fly` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Desenvolvimento Arnold | `arnold-dumbbell-press` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Desenvolvimento no Smith | `smith-machine-shoulder-press` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Elevação Frontal com Elástico | `resistance-band-front-raise` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Elevação Frontal na Polia | `cable-front-raise` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Elevação Pélvica na Máquina | `machine-hip-thrust` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Encolhimento com Halteres | `dumbbell-shrug` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Encolhimento no Smith | `smith-machine-shrug` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Extensão de Joelho com Elástico | `resistance-band-knee-extension` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Flexão Fechada | `close-grip-push-up` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Glúteo Quatro Apoios | `quadruped-hip-extension` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Mergulho nas Paralelas | `parallel-bar-dips` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Panturrilha em Pé com Halteres | `standing-dumbbell-calf-raise` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Panturrilha no Degrau | `step-calf-raise` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Panturrilha no Leg Press | `leg-press-calf-raise` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Prancha Lateral | `side-plank` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Pullover com Halter | `dumbbell-pullover` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Pullover na Polia | `straight-arm-cable-pulldown` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Remada Alta com Halteres | `dumbbell-upright-row` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Remada Curvada com Barra | `bent-over-barbell-row` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Rosca Direta com Elástico | `resistance-band-biceps-curl` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Rosca Martelo na Polia | `cable-rope-hammer-curl` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Stiff com Barra | `barbell-stiff-leg-deadlift` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Superman | `superman` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Supino Fechado | `close-grip-barbell-bench-press` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Supino Inclinado com Barra | `incline-barbell-bench-press` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Supino Reto com Barra | `barbell-flat-bench-press` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Tríceps Coice com Halter | `dumbbell-triceps-kickback` | wger #76, Goulart, CC BY-SA 4.0 | PRODUZIDO — AGUARDANDO REVISÃO | Técnica OK; revisão final pendente | Horizontal local; vertical pendente |
| Tríceps Testa com Halteres | `lying-dumbbell-triceps-extension` | wger #60, Goulart, CC BY-SA 4.0 | PRODUZIDO — AGUARDANDO REVISÃO | Técnica OK; revisão final pendente | Horizontal local; vertical pendente |
| Supino Reto com Halteres | `dumbbell-flat-bench-press` | wger #20, Goulart, CC BY-SA 4.0 | PRODUZIDO — AGUARDANDO REVISÃO | Técnica OK; revisão final pendente | Horizontal local; vertical pendente |
| Elevação Pélvica Unilateral | `single-leg-bench-hip-thrust` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Corrida Estacionária | `running-in-place` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Elíptico | `elliptical-trainer` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |
| Polichinelo | `jumping-jack` | Sem demonstração selecionada | PENDENTE | Pendente | Não integrada |

## Como continuar sem refazer o trabalho

1. Abrir review.html localmente para revisar os três pilotos, seus quadros e os 41 itens. Definir se esse padrão de biblioteca pode ser aceito ou se todos devem ser gravados com a equipe AJ Fit.
2. Usar plan.json como shot list: ele contém equipamento, instruções exatas, duas orientações nativas e oito verificações por exercício. Planejar 82 tomadas se a opção for uma coleção própria uniforme.
3. Confirmar autorização comercial e de imagem das fontes. Registrar a proveniência real; para a opção CC, cumprir licença/créditos antes de distribuir.
4. Gravar em SDR, com mãos, apoios, articulações e carga visíveis. Registrar 2–3 repetições e margem no início/fim; conferir a execução durante a captação. Não usar crop de paisagem para simular retrato.
5. Preparar JSON de entradas locais e executar: node --import tsx scripts/prepareExerciseV3Videos.ts --sources <arquivo-local.json> --out <diretório-local>. O script não faz rede, pagamento, upload, publicação nem ativação. O contrato VideoSource está no módulo scripts/lib/exerciseV3VideoPipeline.ts.
6. O pipeline bloqueia ID fora dos rascunhos, licença/proveniência sem confirmação explícita, orientação errada, trim inválido, resolução baixa e HDR sem conversão revisada. Ele remove áudio, valida codec/pixels, decodifica integralmente e gera evidência; nunca devolve APROVADO automaticamente.
7. Revisar clipe completo e costura do loop, tom de cor, posição inicial/final, amplitude, pegada, equipamento e anatomia. Validar nos três contextos do app e com música externa em iPhone/Android. Somente após isso aprovar mídia; a ativação do exercício e suas limitações permanecem etapas separadas.

## Testes e limites

- TypeScript: passou. ESLint dos seis arquivos TypeScript criados/alterados: passou sem warnings.
- Recorte direcionado: seis arquivos, **42 testes passaram**. Inclui processamento real de fixture sintética com áudio: saída silenciosa, preservação da fonte, decodificação e bloqueio de overwrite. A fixture é só teste temporário, nunca uma demonstração.
- Suíte completa: **7873 passaram, 44 falharam, 227 ignorados**; 614 arquivos passaram e 16 falharam. A lista de falhas coincide exatamente com a execução anterior. Não foi declarada aprovação da suíte inteira.
- Há testes de associação ID/arquivo, integridade SHA-256, presença de atribuição, codec/áudio registrados, bloqueio dos rascunhos e preservação dos 130 exercícios/seis atividades anteriores.
- Não havia dispositivo iOS/Android disponível: testes reais de AVPlayer/ExoPlayer, música externa, cache/offline e enquadramento em iPhone permanecem pendentes. Os testes de áudio são de configuração/lifecycle.

## Alterações e aprovações pendentes

Criados: scripts/prepareExerciseV3Videos.ts; scripts/lib/exerciseV3VideoPipeline.ts; src/data/exerciseV3VideoAssets.ts; src/lib/__tests__/exerciseV3VideoPipeline.test.ts; src/data/__tests__/exerciseV3VideoAssets.test.ts; esta pasta de relatório/plano/galeria; três MP4 e seus sidecars/contact sheets e LICENSE.md. Modificado: src/components/fitness/ExerciseGif.tsx, somente para o registry local e orientação opcional.

Aprovações/recursos para concluir: aceitação visual e revisão humana dos pilotos; tomadas faltantes e equipamento/demonstrador para captação; autorizações de imagem/licenças; aparelhos para QA. Se optar por IA, animação contratada ou biblioteca comercial, autorizar orçamento e eventual envio de referências **antes** de qualquer contratação, upload ou chamada paga. Nenhuma dessas ações foi iniciada.
