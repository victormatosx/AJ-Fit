# Calculadora de Dobras Subcutâneas

## 1. Objetivo deste documento

Definir a lógica oficial de cálculo de percentual de gordura corporal.

Definir:

* protocolos suportados
* dados necessários
* fórmulas utilizadas
* armazenamento dos resultados
* regras de validação

---

# 2. Objetivo da funcionalidade

Permitir que o usuário acompanhe sua evolução física através da estimativa de percentual de gordura corporal.

---

## Observação

O resultado representa uma estimativa.

Não substitui avaliação profissional.

---

# 3. Protocolos suportados

Protocolos iniciais:

* Jackson & Pollock 3 Dobras
* Jackson & Pollock 7 Dobras

---

# 4. Unidade de medida

Todas as dobras devem ser informadas em:

```txt
milímetros (mm)
```

---

# 5. Dados obrigatórios

Todo cálculo exige:

* sexo
* idade
* protocolo escolhido
* medidas das dobras

---

# 6. Jackson & Pollock 3 Dobras

## Masculino

Dobras utilizadas:

* Peitoral
* Abdômen
* Coxa

---

### Soma das Dobras

```txt
S = Peitoral + Abdômen + Coxa
```

---

### Densidade Corporal

```txt
DC =
1.10938
-
(0.0008267 × S)
+
(0.0000016 × S²)
-
(0.0002574 × Idade)
```

---

## Feminino

Dobras utilizadas:

* Tríceps
* Supra-ilíaca
* Coxa

---

### Soma das Dobras

```txt
S = Tríceps + Supra-ilíaca + Coxa
```

---

### Densidade Corporal

```txt
DC =
1.0994921
-
(0.0009929 × S)
+
(0.0000023 × S²)
-
(0.0001392 × Idade)
```

---

# 7. Jackson & Pollock 7 Dobras

## Masculino

Dobras utilizadas:

* Peitoral
* Axilar Média
* Tríceps
* Subescapular
* Abdômen
* Supra-ilíaca
* Coxa

---

### Soma das Dobras

```txt
S = soma das 7 dobras
```

---

### Densidade Corporal

```txt
DC =
1.112
-
(0.00043499 × S)
+
(0.00000055 × S²)
-
(0.00028826 × Idade)
```

---

## Feminino

Dobras utilizadas:

* Peitoral
* Axilar Média
* Tríceps
* Subescapular
* Abdômen
* Supra-ilíaca
* Coxa

---

### Soma das Dobras

```txt
S = soma das 7 dobras
```

---

### Densidade Corporal

```txt
DC =
1.097
-
(0.00046971 × S)
+
(0.00000056 × S²)
-
(0.00012828 × Idade)
```

---

# 8. Conversão para percentual de gordura

Após calcular a densidade corporal:

Utilizar a Equação de Siri.

---

## Fórmula

```txt
BF (%) =
(495 / DC)
-
450
```

---

# 9. Resultado exibido

O sistema deve exibir:

* percentual de gordura
* protocolo utilizado
* data da medição

---

## Exemplo

```txt
BF: 14,8%

Protocolo:
Jackson & Pollock 7 Dobras

Data:
03/06/2026
```

---

# 10. Armazenamento

O sistema deve armazenar:

* protocolo
* sexo
* idade
* todas as dobras informadas
* soma das dobras
* densidade corporal
* BF calculado
* data da medição

---

# 11. Histórico

Todas as medições devem permanecer registradas.

Não sobrescrever registros antigos.

---

## Objetivo

Permitir acompanhamento da evolução corporal ao longo do tempo.

---

# 12. Comparação

O sistema deve permitir comparação entre medições diferentes.

---

## Exemplos

* última medição
* 30 dias
* 60 dias
* 90 dias

---

# 13. Validação dos dados

Não permitir:

* valores negativos
* campos vazios
* idade inválida

---

## Recomendação

Aceitar apenas valores maiores que:

```txt
0 mm
```

---

# 14. Arredondamento

O percentual de gordura deve ser exibido com:

```txt
1 casa decimal
```

---

## Exemplo

```txt
14,8%
```

---

# 15. Alteração de protocolo

O usuário pode alternar entre:

* 3 Dobras
* 7 Dobras

---

## Regra

Cada registro deve armazenar qual protocolo foi utilizado.

---

# 16. Funcionamento offline

O cálculo deve funcionar totalmente offline.

---

## Regra

Nenhuma consulta externa é necessária para calcular o resultado.

---

# 17. Sincronização

As medições realizadas offline devem ser sincronizadas quando houver conexão.

---

# 18. Segurança dos dados

As medições devem ser tratadas como dados privados do usuário.

---

## Aplicar mesmas regras de segurança definidas em:

```txt
12_seguranca_geral_do_app.md
```

---

# 19. Critério de sucesso

Uma medição é considerada válida quando:

* todas as dobras obrigatórias foram informadas
* idade foi informada
* sexo foi informado
* fórmula correta foi aplicada

---

# 20. Pedido para o Agente Backend

Definir:

* estrutura de armazenamento
* validações
* testes automatizados dos cálculos
* sincronização offline

Garantindo consistência matemática entre todos os dispositivos.
