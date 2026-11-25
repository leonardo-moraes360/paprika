[🇺🇸 English](../visual-verification.md) | 🇧🇷 Português

# Verificação visual

Como o Paprika prova, com números, que uma tela do aplicativo bate com o board aprovado. A ideia
é adversária de propósito: quem fez a tela não é quem a certifica.

O objetivo é a linha **Verificação adversarial assistida no canvas** do
[backlog](backlog.md). Esta página é o que existe hoje, o que ainda não existe e as regras
exatas da parte que existe — porque nesse loop as regras são o que está em disputa, então elas
precisam estar escritas e ser revisáveis.

## O loop

1. A **referência** é o board aprovado: um frame num documento Paprika, um por tela e por modo
   (claro e escuro).
2. Um **gerador** mexe no aplicativo até uma captura da tela real chegar a pelo menos
   **95 % de similaridade** contra essa referência, para cada tela e nos dois modos.
3. Um **discriminador** independente refaz o trabalho do zero — build, referência, captura,
   comparação — e reprova a rodada por:
   - **score**: abaixo da barra em qualquer tela ou modo;
   - **trapaça**: referência editada, máscara sem motivo ou comparador alterado para a tela
     passar;
   - **regressão**: uma tela que passou na rodada anterior e não passa agora;
   - **contraste**: cores que batem pixel a pixel mas são ilegíveis.
4. No máximo **3 rodadas**; depois disso uma pessoa decide.

## O que existe agora

`server/internal/visualdiff` — o comparador e a checagem de contraste, em Go:

| Chamada | O que entrega |
| --- | --- |
| `Compare(a, b image.Image, opts)` | score e contagens de duas imagens |
| `CompareFiles(pathA, pathB, opts)` | o mesmo lendo dois PNGs (o caminho do discriminador) |
| `Result.WriteDiffPNG(w)` | a imagem anotada, para uma pessoa ver o que foi perdoado |
| `ContrastRatio`, `MeetsContrast`, `MinContrast` | contraste WCAG 2.1, os mesmos números que o loop vai cobrar |
| `ParseHex` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, do jeito que o board escreve seus tokens |

Tudo sai em números e toda exceção é contada, porque um `PASS` sozinho não é evidência.

## O que ainda não existe

O resto da linha é a próxima fatia: renderizar as referências a partir dos boards, capturar as
telas de verdade, o guardião anti-trapaça que roda este pacote de novo em vez de confiar num
score guardado, e o driver de rodadas com seu orçamento de três rodadas. Nada neste pacote decide
se passou ou não: ele devolve o score, e a barra é de quem chama.

## A comparação, exatamente

**Canvas.** O canvas comparado é o maior dos dois (`max(largura) × max(altura)`). A área que um
dos dois não tem é preenchida com **magenta** (`#ff00ff`), uma cor que nenhuma tela real
produz, e essa faixa conta como diferença: uma captura que perdeu o rodapé não é a mesma tela.
`Result.SizeMismatch` diz quanto do canvas existia de só um lado.

**Distância de cor.** Um pixel é diferença quando sua distância perceptual passa a barra. A
distância é medida em **YIQ** (a rotação NTSC do RGB, ponderada 0,5053 / 0,2926 / 0,1597),
porque o olho separa brilho de cor muito melhor do que separa canais RGB: uma distância por
canal marca dithering e anti-aliasing como erro e deixa passar mudança de matiz que as pessoas
veem. A distância é ao quadrado e normalizada para que cores idênticas sejam 0 e preto contra
branco seja ≈ 0,505.

**Barra 0,1.** É o padrão, e o número que o harness do mantenedor usava. Não passar opções é
esse padrão; barra 0 conta toda diferença visível, que é o que se quer quando um teste exige que
dois renders sejam byte a byte iguais. Scores só são comparáveis na mesma barra, então mudar isso
muda as regras do jogo — e o discriminador roda de novo este código exatamente para isso.

**Anti-aliasing.** Uma diferença numa borda não é mudança de design: a mesma diagonal cai em
pixels diferentes conforme o coverage sub-pixel. Um pixel é tratado como mistura quando seu
brilho fica estritamente entre um vizinho mais escuro e um mais claro; a diferença é perdoada
quando **os dois** lados são misturas (a borda tremeu) ou quando a outra imagem tem aquela mesma
cor a menos de um pixel (a borda se moveu). Uma mistura que existe de só um lado, com aquela cor
longe dali, é contada — isso é uma forma que apareceu ou sumiu, não arredondamento.
`Result.AntiAliased` diz quantos pixels foram perdoados; passe `IncludeAntiAliasing` para contá-
los mesmo assim.

**Máscaras.** Um retângulo pode ser excluído da comparação, e **cada um precisa de um motivo**:
uma área pulada sem explicação é exatamente como uma tela é feita para passar. Máscara sem
motivo, com tamanho zero ou com coordenada negativa é recusada, com a posição da máscara na
mensagem. Área sobreposta é perdoada uma vez só, e `Result.MaskedPerMask` guarda a contagem de
cada máscara, para que uma máscara que não cobre nada fique visível na rodada seguinte. Máscaras
não podem cobrir tudo: comparar zero pixels é erro, não 1,0.

**Similaridade.** `1 − DiffPixels / Scored`, com `Scored = Compared − Masked`. O score vem sempre
ao lado de `Masked` e `AntiAliased`; 97 % com metade do canvas mascarado é um fato diferente de
97 % sem máscara nenhuma, e os números dizem qual dos dois foi.

**A imagem de diff.** Vermelho é diferença contada, amarelo é anti-aliasing, azul é máscara,
magenta é a faixa que só um dos dois tinha; o resto é a referência escurecida a 40 % para as
marcas lerem por cima.

| Campo | Significado |
| --- | --- |
| `width`, `height`, `compared` | o canvas e quantos pixels ele tem |
| `masked`, `maskedPerMask`, `scored` | o que foi perdoado, por máscara, e o que decidiu o score |
| `diffPixels`, `antiAliased`, `sizeMismatch` | diferenças contadas, misturas perdoadas, área de um lado só |
| `similarity` | `1 − diffPixels/scored`, em 0..1 |
| `maxDelta` | o pior pixel sozinho, na mesma escala 0..1 da barra |

## Contraste

Os pixels podem bater a 99 % e ainda assim sair um rótulo que ninguém lê. As funções são WCAG 2.1:
luminância relativa a partir do sRGB linearizado, razão `(L1 + 0,05) / (L2 + 0,05)`, mínimo 4,5
para texto corrido e 3 para texto grande (18 px bold ou 24 px), um degrau acima no AAA (7 e 4,5).
Partes de interface que carregam sentido (um ícone, uma borda que separa duas áreas) ficam na
barra de texto grande, e é por isso que o loop a reutiliza. Uma cor translúcida é composta sobre
o fundo antes de ser julgada, porque essa é a cor que a tela pinta.

## Custo

Dois PNGs 1440×900, uma comparação, num AMD Ryzen 9 9950X3D (benchmark Go, `-benchtime 10x`):

```
BenchmarkCompareIdentical1440x900        12,5 ms/op   16,9 MB/op    6 allocs/op
BenchmarkCompareEdited1440x900           15,3 ms/op   16,9 MB/op    6 allocs/op
BenchmarkCompareEditedWithMasks1440x900  13,7 ms/op   16,9 MB/op    7 allocs/op
BenchmarkCompareFiles1440x900            21,6 ms/op   27,3 MB/op   56 allocs/op
```

Ler os PNGs custa uns 9 ms disso. Um loop inteiro — várias telas, dois modos, três rodadas,
rodado duas vezes (gerador e discriminador) — são uns dois segundos de comparação, então o custo
do loop está em compilar e capturar, não em julgar.

## Mudar este pacote

A técnica (distância YIQ mais um filtro de borda misturada) é a que o pixelmatch popularizou, que
tem licença ISC; esta é uma implementação nossa e nenhum código foi copiado. Se uma regra aqui
mudar — a barra, o teste de borda, o que uma máscara pode cobrir, o denominador da similaridade —
diga isso no pull request: isso move todo score que já foi ou que será reportado.
