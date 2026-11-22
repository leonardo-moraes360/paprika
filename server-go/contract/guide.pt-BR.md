# Paprika: guia para agentes

Documento = mapa plano de nós + rootIds (telas/frames de topo, em coordenadas do canvas).
Tipos: frame (contêiner com estilo e layout), group (agrupa sem pintar), page (canvas separado), rect, ellipse,
text, image, path (vetor com curvas bezier), shape (forma de diagrama com texto dentro), connector (linha/seta entre
nós). Só frame, group e page têm filhos.

Campos comuns: name, x, y, width, height (número | "hug" | "fill"), rotation, opacity (0..1),
visible, locked, fill (cor), stroke {color,width}, radius, shadow {x,y,blur,spread,color}, notes.
frame: clip (bool), layout {mode: none|row|column, gap, padding (n | [t,r,b,l]), align: start|center|end|stretch,
  justify: start|center|end|between, wrap}. Com layout row/column, x/y dos filhos são ignorados.
text: text, color, fontFamily, fontSize (n | "$token"), fontWeight (100..900), lineHeight, letterSpacing, textAlign.
  Sem width/height, um texto novo abraça o conteúdo ("hug" nos dois eixos); dê width para quebrar linhas.
image: src (https:// ou data:image/), fit (cover|contain|fill), alt.
group: name, x, y, opacity, visible, locked, notes, children. A caixa (x, y, width, height) é calculada a partir
  dos filhos ao fim de cada escrita; coordenadas dos filhos são relativas ao grupo. Use group_nodes/ungroup_nodes.
page: name, fill (fundo do canvas), notes, children. Só no topo; com páginas, todo nó de topo é página e os
  frames vão em parentId = id da página (coordenadas do canvas). create_page cria a primeira já levando o
  conteúdo atual para "Página 1". create_page {ensure: true, name} devolve a página que já tem esse nome
  em vez de criar outra. Telas de outra página: get_document_outline {rootId: id da página}.
Componentes: um frame com component: true é um componente (create_component). Uma instância é um frame com
  instanceOf = id do componente e scale opcional (create_instance): os filhos são cópias geradas, com ids
  derivados e sourceId = id do nó de origem; mudar o componente muda todas as instâncias. Numa cópia, update só
  troca fill, color, text, src, alt, visible e opacity (vira override da instância; null volta ao componente);
  na raiz, fill vira override e width/height/layout/stroke/radius/shadow/clip vêm do componente (use scale).
  Cópias não podem ser movidas, apagadas nem receber filhos: edite o componente ou detach_instance.
path: d (dados de caminho SVG: M L H V C S Q T A Z, absolutos ou relativos), fill (preenchimento; sem fill = vazado),
  stroke {color,width} (traço), fillRule (nonzero|evenodd), strokeCap (butt|round|square), strokeJoin (miter|round|bevel),
  viewBox [x,y,w,h] opcional. Sem viewBox, as coordenadas de d são px a partir do canto (x,y) do nó; com viewBox,
  o desenho é escalado para caber em width×height (bom para ícones num grid 24×24). Sem width/height, o nó
  ganha a caixa do desenho. Curvas: "C c1x c1y c2x c2y x y" (cúbica), "Q cx cy x y" (quadrática), S/T espelham
  o controle anterior (curvas suaves). Use get_bounds (caixas absolutas + cantos rotacionados), path_info para conferir bounds antes de posicionar.
shape: shape (rect|ellipse|diamond|triangle|note), text (centralizado; numa nota, no topo à esquerda), color, fontFamily, fontSize,
  fontWeight, lineHeight, textAlign. width/height são números (padrão 160×80; nota 160×160). fill/stroke/radius/shadow
  pintam o contorno; campos omitidos na criação ganham o padrão do tipo (branco com borda escura; note = nota adesiva amarela).
connector: from/to = {nodeId, side?: auto|top|right|bottom|left} (preso a um nó) ou {x, y} (ponto solto nas coordenadas
  do pai), route (straight|elbow), startArrow/endArrow (none|arrow), stroke {color,width}, dashed,
  label (texto no meio da rota, na cor do traço: "sim", "não"). x, y, width, height e
  d são calculados a partir das pontas a cada escrita (só leitura): mover uma forma redesenha os conectores dela, e
  apagar um nó apaga os conectores presos a ele.
Diagramas: draw_diagram recebe nodes (formas) + edges (conectores) e posiciona sozinho as formas sem x/y.

Cores: #hex, rgb(), rgba() ou "$token" (ver set_tokens). Prefira tokens para cores e tamanhos recorrentes.
Modos de tema: set_tokens com mode ("dark", "compact"…) grava só os tokens que mudam; "mode" num frame ou página aplica o modo ao subtree (dá para pôr a mesma tela clara e escura lado a lado). export_code com cssVariables: true sai com var(--token) e uma regra por modo.
"fill" em width/height ocupa o espaço restante no eixo principal do pai com layout, ou estica no eixo cruzado.

Fluxo recomendado:
1. get_document_outline para se orientar (barato).
2. set_tokens com a paleta e a escala tipográfica.
3. create_nodes com árvores aninhadas (children) numa só chamada; prefira frames com layout a posicionamento absoluto.
4. lint_design e corrija o que vier como error/warning.
5. render_screenshot para conferir visualmente; export_code para levar ao código.
Para trazer um ícone ou um trecho de página pronto, use import_svg ou import_html (viram nós editáveis), import_image para um arquivo PNG, JPEG, WebP, AVIF ou GIF; export_code com format "svg" devolve SVG vetorial.
Toda escrita é atômica (tudo ou nada) e pode ser desfeita com undo. Para várias chamadas virarem um passo só de undo (ex.: "desenhar a proposta 3"), passe o mesmo batch em cada uma; o batch fecha quando outra pessoa escreve ou desfaz no meio.
Resultados: as ferramentas que devolvem JSON também devolvem structuredContent conforme o outputSchema; leia esse campo em vez de interpretar o texto.
Workspaces: o servidor guarda vários documentos (list_workspaces); toda ferramenta trabalha no ativo, que é também o do canvas do humano. open_workspace troca o ativo para todos, então pergunte ao humano antes; create_workspace cria um vazio, rename_workspace renomeia um, set_workspace_cover põe uma imagem (ou o screenshot de um frame) no card; delete_workspace não tem desfazer e leva duas chamadas: a primeira, sem confirmToken, devolve um resumo do que se perde e um token de curta duração; mostre esse resumo ao humano e só chame de novo com o token depois que ele concordar. list_workspace_ops mostra quem criou, renomeou, abriu ou apagou um workspace, e a entrada do apagamento guarda o resumo dele.
O humano vê suas edições ao vivo no canvas. Campos desconhecidos são rejeitados com erro: leia a mensagem e ajuste.
Erros e mensagens das ferramentas são em inglês.