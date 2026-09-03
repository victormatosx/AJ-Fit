# Contrato de limitações musculoesqueléticas

Status DR-004: `RESOLVED_IMPLEMENTED_V1`. O contrato está tipado, validado e
consumido pelo Limitation Resolver. Isso não representa aprovação clínica.

## Regiões canônicas

O questionário usa `none`, sete regiões enumeráveis e `other`. A matriz por
exercício cobre exclusivamente:

```ts
type LimitationRegionId =
  | 'knee'
  | 'hip'
  | 'back'
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'ankle_foot';
```

`none` é sentinela de seleção. `other` é uma resposta válida, mas não é uma
chave da matriz: sem região estruturada, o resolver retorna
`UNMAPPED_LIMITATION_REGION`, nunca a ignora.

## Estados de domínio

```ts
type LimitationCompatibility =
  | 'compatible'
  | 'adapt'
  | 'avoid'
  | 'unknown'
  | 'not_applicable';
```

- `compatible`: a região é material, foi revisada e o exercício pode permanecer
  sem transformação regional no escopo do protocolo aprovado.
- `adapt`: a região é material e o exercício só pode permanecer por uma ação
  estruturada e executável.
- `avoid`: o exercício original é rejeitado para a região; candidatos ainda
  precisam passar por todas as outras constraints.
- `unknown`: a região é ou pode ser material, mas não há decisão aprovada
  suficiente. É fail-safe, mesmo quando registrado por um reviewer.
- `not_applicable`: a região foi explicitamente revisada como não material para
  a decisão desse exercício no resolver V1. Não afirma segurança clínica.

`compatible` e `not_applicable` não são intercambiáveis: o primeiro é uma
decisão sobre uma região relevante; o segundo exclui aquela região do cálculo
daquele exercício dentro deste protocolo.

## Schema V1 implementado

```ts
interface ExerciseLimitationProfileCore {
  schemaVersion: 1;
  protocolVersion: 'musculoskeletal-v1';
  regions: Partial<Record<LimitationRegionId, ExerciseLimitationRule>>;
}

type ExerciseLimitationProfile = ExerciseLimitationProfileCore & (
  | {
      reviewStatus: 'draft';
    }
  | {
      reviewStatus: 'approved';
      reviewBasis: 'product_policy';
    }
  | {
      reviewStatus: 'approved';
      reviewBasis: 'professional_review';
      reviewedAt: Timestamp;
      reviewedBy: string;
    }
);

interface ExerciseLimitationRule {
  status: LimitationCompatibility;
  adaptation?: {
    kind: 'exercise_variant';
    exerciseId: string;
  };
  substituteExerciseIds?: string[];
  candidateStatus?: 'ready' | 'missing_exercise_candidate';
}

interface Exercise {
  limitationProfile?: ExerciseLimitationProfile;
}
```

Regras de validade:

1. perfil ausente, `draft`, versão desconhecida ou região ausente equivale a
   `unknown`, nunca a `not_applicable`;
2. `approved` exige `reviewBasis` e as sete chaves regionais explicitamente
   presentes;
3. `not_applicable`, `compatible` e `unknown` não carregam ação executável;
4. `adapt` exige `adaptation.kind=exercise_variant` e um `exerciseId` existente;
5. `avoid` usa candidatos ordenados; lista vazia é válida e exige
   `candidateStatus=missing_exercise_candidate`; nesse caso, sem outro
   candidato original válido, o resultado é `NO_SAFE_SUBSTITUTION`;
6. todo ID referenciado precisa existir, estar ativo e habilitado no momento da
   resolução; aprovação não congela disponibilidade ou equipment;
7. `approved + product_policy` não carrega identidade profissional fictícia;
   `reviewedAt`/`reviewedBy` permanecem ausentes e a rastreabilidade vem de
   `protocolVersion` e da versão do dataset/política;
8. `approved + professional_review` exige `reviewedAt` e `reviewedBy` reais.
   `reviewedBy` identifica o registro administrativo e não aparece no trace do
   usuário;
9. `draft` não usa `reviewBasis`: ausência de aprovação continua fail-safe.

## Governança de aprovação

`reviewStatus` responde se a regra pode dirigir o comportamento do produto;
`reviewBasis` responde qual autoridade aprovou esse comportamento.

- `approved + product_policy`: regra aprovada para comportamento conservador do
  produto. Não representa avaliação individual, contraindicação médica ou
  liberação clínica universal;
- `approved + professional_review`: regra aprovada por revisão profissional sob
  governança própria, com reviewer e timestamp reais;
- `draft`: incompleto/não aprovado, independentemente de intenção futura.

Os 76 profiles persistidos usam `approved + product_policy`; nenhum deles usa
identidade profissional fictícia. Os 40 exercícios sem profile permanecem
fail-closed somente quando há limitação musculoesquelética a avaliar.

## Estratégia para `not_applicable`

Persistir explicitamente a opção A:

```json
"knee": { "status": "not_applicable" }
```

Omitir a chave não funciona, pois ausência também representa documento legado,
rascunho incompleto ou região nunca revisada. A combinação de sete chaves +
`reviewStatus=approved` + `protocolVersion` distingue cobertura completa de
ausência de revisão sem criar uma collection paralela.

## Estratégia para `adapt`

O catálogo e o runtime não possuem registry executável para amplitude, carga,
apoio ou técnica. Portanto, `adapt` não aceita instruções livres nem
`adaptationRuleIds` inexistentes. Na implementação V1, só é válido quando
aponta para uma variante real do catálogo. Qualquer
adaptação que preserve o mesmo `exerciseId` permanece `unknown` até existir um
contrato estruturado próprio.

## Versionamento e snapshots

`schemaVersion` versiona a forma do documento. `protocolVersion` identifica o
protocolo de revisão. Mudança de julgamento ou critérios cria nova versão de
protocolo; não redefine silenciosamente o significado de dados já usados por um
snapshot. O Prescription Engine registra `limitationResolver: "1.0.0"`,
`limitationResolverVersion: 1`, o protocolo e a base de revisão de cada decisão.

## Estado atual e integração

`Exercise` e o Prescription Engine tipam `limitationProfile`. Em produção, o
serviço carrega uma vez os 116 documentos de `exercises` quando o questionário
declara limitação e entrega o catálogo ao resolver puro. O runtime aceita os 76
profiles persistidos e falha fechado para os 40 ausentes; sem limitação, não
exige profile nem faz essa leitura adicional.

O portal `ajfit-admin` já lista/edita os 116 documentos e possui picker de IDs
reais para `similarExerciseIds`, mas não visualiza nem valida limitações. Uma
eventual ferramenta administrativa futura precisará adicionar:

- grade fixa com sete regiões e os cinco estados;
- modo draft e ação explícita de aprovação integral;
- picker ordenável de variantes/substitutos existentes;
- validação condicional de `adapt`, `avoid` e cobertura das sete regiões;
- protocolo, reviewer e timestamp somente leitura após o save aprovado;
- alerta para candidates ainda sem perfil aprovado.

As Firestore Rules locais validam o profile com schema fechado, enums, sete
regiões e gates administrativos, e os testes de emulador passam. Também exigem
evidência versionada do resolver para persistir um programa associado a
limitação canônica. O arquivo local contém mudanças de outros fluxos cuja
prontidão integral de produção ainda não foi provada; portanto seu deploy está
`RULESET_DEPLOY_PENDING` e os gates não foram relaxados em produção nesta fase.

Cobertura mínima implementada:

- perfil ausente/draft/versão desconhecida e região ausente falham fechado;
- `compatible` mantém e `not_applicable` ignora somente a região explícita;
- `avoid` percorre candidatos ordenados; ID inexistente é rejeitado;
- `adapt` exige variante real e executável;
- candidato `unknown` para qualquer segunda limitação é rejeitado;
- equipment/environment/status/availability são revalidados;
- múltiplas limitações usam interseção determinística;
- nenhum candidate válido retorna `NO_SAFE_SUBSTITUTION`;
- duplicatas, autorreferência e ciclos são detectados;
- mesma entrada e versões produzem a mesma saída;
- rules bloqueiam schema inválido e escrita por não admin.

## Linguagem e responsabilidade

A metadata expressa compatibilidade conservadora com uma **limitação declarada**.
Ela não diagnostica, não prescreve tratamento e não declara um exercício
universalmente seguro ou inseguro. Notes de reviewer podem existir no portal,
mas não dirigem lógica nem devem ser copiadas para analytics ou trace clínico.
