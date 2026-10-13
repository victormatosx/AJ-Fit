# C4 — performance e volume de reads

## Medição real

Ambiente: Firestore `ajfit-2f321`, 23.606 documentos, benchmark sequencial de 151 queries. O relatório final foi coletado sem outros scans concorrentes.

| Métrica | C3 / antes | C4 / depois |
|---|---:|---:|
| candidate pool | 60 | 40 |
| reads médios/query | ~45 | 32,5 |
| reads totais/151 | 6.788 | 4.900 |
| p50 | ~558 ms | 501,1 ms |
| p95 | ~889 ms | 786,2 ms na medição limpa; 908,6 ms na verificação pós-lifecycle |
| máximo | ~1,9 s | 1.685,7 ms na medição limpa |
| cobertura útil | 99,3% | 100% |
| segunda página | 2 queries / até 61 reads | 1 query / até 40 reads |

O cursor agora carrega os dois valores de ordenação (`searchSourcePriority` e document ID). Isso remove o `getDoc` usado apenas para reconstruir o cursor. O pool 40 foi mantido porque o benchmark real preservou 151/151 resultados úteis e 27/27 prioritários.

Uma repetição funcional pós-`hidden`/`deprecated` confirmou 151/151 e 32,4 reads médios, mas observou um outlier isolado de transporte de 66,8 s; p50 foi 505,6 ms e p95 908,6 ms. Como o Firestore Web SDK não cancela `getDocs`, o serviço agora limita a espera visível a 10 s: a UI recebe erro/retry e uma resposta tardia não entra no cache. O outlier foi documentado, não usado como justificativa para migrar de engine.

## Cache

Cache local em memória:

- TTL: 60 segundos;
- capacidade: 50 páginas, descarte LRU;
- chave: hash da query normalizada, cursor e pool;
- query crua não é persistida nem usada como chave legível;
- paginação isolada por cursor;
- ranking pessoal aplicado depois da recuperação do candidato cacheado;
- refresh operacional pode chamar `clearFoodLogSearchCache`; sessões normais expiram pelo TTL.

Um hit evita a consulta Firestore daquela página (zero reads de catálogo). Não foi assumida taxa de hit na estimativa, para não maquiar custo.

## Estimativa de volume

Com 32,5 reads frios por busca, antes de cache:

- 100 buscas: aproximadamente 3.250 reads;
- 1.000 buscas: aproximadamente 32.500 reads;
- 100.000 buscas: aproximadamente 3.250.000 reads.

Não foi convertido para moeda porque preço, região, franquia e contrato não estão fixados na configuração do repositório. A estimativa é deliberadamente de volume.

## Decisão

Firestore permanece adequado neste estágio: cobertura integral, p95 típico na faixa de 0,8–0,9 s, espera de UI limitada, uma query por página e custo reduzido em ~27,8% na média (`45` para `32,5`). Algolia/Typesense não foi introduzido. Reavaliar somente com telemetria de produção que demonstre p95/custo inadequado ou necessidade real de fuzzy/typo search global.

O teste sintético de 10 mil candidatos continua cobrindo determinismo e tempo de ranking client-side. O limitante observado é I/O remoto, não o sort local limitado a 40 candidatos.
