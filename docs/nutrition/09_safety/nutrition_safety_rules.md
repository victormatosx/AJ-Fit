# AJ Fit Nutrition — Regras de Segurança Nutricional

## 1. Princípio

Segurança nutricional é responsabilidade determinística do backend.

A IA nunca pode:

- relaxar safety gates;
- aceitar calorias abaixo do mínimo;
- aumentar agressividade além dos limites;
- ignorar exclusões;
- ignorar alergênicos;
- gerar plano para usuário inelegível.

Em conflito entre IA e regra determinística:

**a regra determinística vence sempre**.

---

## 2. Gates de bloqueio da V1

A geração de dieta é bloqueada quando:

- usuário está grávida;
- usuário está em lactação/amamentação.

Comportamento:

1. não chamar IA;
2. não gerar plano parcial;
3. não oferecer bypass;
4. recomendar acompanhamento profissional.

---

## 3. Limites do Nutrition Engine

O engine deve impor:

- calorias mínimas por sexo;
- limites máximos de déficit;
- limites máximos de superávit;
- intervalos de proteína;
- mínimo de gordura;
- tolerâncias de macros;
- regras de fibra.

Mesmo o ritmo `accelerated` deve permanecer dentro dos limites definidos.

---

## 4. Pedido extremo do usuário

A interface não oferece campo livre para solicitar dieta extrema.

Se, no futuro, qualquer input tentar exigir valor fora das regras:

- ignorar a instrução incompatível;
- aplicar limite seguro;
- informar que a meta foi limitada quando relevante.

---

## 5. Exclusões

Todo alimento em:

`excludedFoodIds`

é hard exclusion.

A regra se aplica a:

- geração inicial;
- nova opção de refeição;
- restauração/revalidação futura;
- seleção de candidatos pela IA.

---

## 6. Alergênicos

Alergênicos do catálogo são uma camada adicional.

Se o sistema souber que um produto contém ingrediente/alergênico incompatível, ele deve ser bloqueado mesmo que seu `foodId` específico não esteja na lista de exclusões.

---

## 7. Produtos compostos/industrializados

Quando metadados disponíveis indicarem ingrediente/alergênico incompatível:

- excluir o produto dos candidatos;
- rejeitar saída da IA que o contenha.

Se os metadados forem insuficientes, não inventar composição.

---

## 8. Validação pós-IA

Toda saída passa por:

1. schema validation;
2. food ID validation;
3. exclusion validation;
4. dietary-pattern validation;
5. allergen validation;
6. nutrition target validation;
7. safety validation.

Só então pode ser persistida.

---

## 9. Falha

Se nenhuma combinação válida puder ser gerada:

- falhar de forma explícita;
- não flexibilizar segurança para concluir a operação.
