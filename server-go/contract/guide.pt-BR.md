# Paprika: guia para agentes

Documento = mapa plano de nós + rootIds (telas/frames de topo, em coordenadas do canvas).
Tipos: frame (contêiner com estilo e layout), group (agrupa sem pintar), page (canvas separado), rect, ellipse,
text, image, path (vetor com curvas bezier), shape (forma de diagrama com texto dentro), connector (linha/seta entre
nós). Só frame, group e page têm filhos.

Campos comuns: name, x, y, width, height (número | "hug" | "fill"), rotation, opacity (0..1),
visible, locked, layoutPositioning ("auto"|"absolute", omitir = auto), constraints {horizontal: left|right|center|scale, vertical: top|bottom|center|scale} (omitir = left/top; vale no filho fora do fluxo quando a largura ou altura numérica do frame pai muda), fill (cor), stroke {color, width: n | "$token"}, radius (n | "$token", ou em frame, rect e image [tl, tr, br, bl]; cada canto n | "$token"), shadow (um objeto ou uma lista de até 8: {x, y, blur, spread: n | "$token", color, inner?}), outline {color, width: n | "$token", style?: solid|dashed|dotted, offset?}, filter e backdropFilter {blur?: n | "$token", saturate? 0..10, grayscale? 0..1, brightness? 0..10, sepia? 0..1, invert? 0..1, hueRotate? -360..360}, notes, lintIgnore (nomes de regras que o lint_design ignora neste nó).
frame: clip (bool), layout {mode: none|row|column, gap (n | "$token"), padding (um número ou [topo, direita, baixo, esquerda]; cada um n | "$token"; não dois valores), align: start|center|end|stretch,
  justify: start|center|end|between, wrap}, scaledMock (true: mock em escala; o lint_design não avisa small-text dentro dele). Com layout row/column, x/y dos filhos são ignorados, salvo layoutPositioning "absolute" (o filho fica em x/y relativos ao pai e sai do fluxo, do gap e do hug). Omitir ou "auto" permanece no fluxo.
text: text, color, fontFamily (string | "$token"), fontSize (n | "$token"), fontWeight (100..900 | "$token"), lineHeight (n | "$token"), letterSpacing (n | "$token"), textAlign.
  runs (opcional, até 200): trechos {start, end} em índices UTF-16, sem sobreposição, cada um com ao menos um de fontWeight (100..900 | "$token"), color, fontSize (n | "$token"), italic: true, href (http(s), mailto, ou caminho com / ou #).
  Sem width/height, um texto novo abraça o conteúdo ("hug" nos dois eixos); dê width para quebrar linhas.
image: src (https://, data:image/ ou $asset), fit (cover|contain|fill), alt, decorative (true pula o lint de alt e exporta alt="" aria-hidden). Os nomes $asset ficam no documento via set_assets.
frame e text podem ter href (relativo, #hash, http(s), mailto, tel), exportado como <a>. Um frame raiz pode ter minWidth e maxWidth; o export usa width 100% entre esses limites. O canvas mantém a largura de desenho.
convert_to_path transforma rect e ellipse em path com o mesmo id (o raio entra no d).
group: name, x, y, opacity, visible, locked, notes, children. A caixa (x, y, width, height) é calculada a partir
  dos filhos ao fim de cada escrita; coordenadas dos filhos são relativas ao grupo. Use group_nodes/ungroup_nodes.
  wrap_nodes põe os mesmos irmãos num frame novo (o desenho não se move, um desfazer). align_nodes (edge: left|center|right|top|middle|bottom)
  e distribute_nodes (axis: horizontal|vertical, pelo menos 3) movem os irmãos num desfazer. show_all e unlock_all revelam o que está oculto
  ou travado; pageId limita à página, e omitir cobre o documento inteiro.
page: name, fill (fundo do canvas), notes, children. Só no topo; com páginas, todo nó de topo é página e os
  frames vão em parentId = id da página (coordenadas do canvas). create_page cria a primeira já levando o
  conteúdo atual para "Page 1" (inglês; a UI passa o nome localizado). create_page {ensure: true, name} devolve a página que já tem esse nome
  em vez de criar outra. Telas de outra página: get_document_outline {rootId: id da página}.
Componentes: um frame com component: true é um componente (create_component). Ele pode declarar props (text,
  boolean, variant) e frames ou groups dentro dele podem nomear um slot. Uma instância é um frame com
  instanceOf = id do componente, scale opcional, propValues e slots (create_instance). Instâncias podem ficar
  dentro de um componente; um ciclo é recusado. Os filhos são cópias geradas, com ids derivados e sourceId = id
  de origem ou o caminho slot/id ou instancia/copia. Mudar o componente muda todas as instâncias. Numa cópia,
  update só troca fill, color, text, src, alt, visible, opacity e runs (vira override; null volta ao componente). Uma
  cópia aninhada se endereça pelo caminho instancia/copia, e esse caminho também aceita propValues e slots. Na
  raiz, fill vira override e width/height/layout/stroke/radius/shadow/clip vêm do componente (use scale). Uma prop
  text dirige o texto de text e shape via bind.text; uma boolean dirige bind.visible; bind.variant omite o nó
  salvo quando cada par combina. Cópias não podem ser movidas, apagadas nem receber filhos: edite o componente
  ou detach_instance.
path: d (dados de caminho SVG: M L H V C S Q T A Z, absolutos ou relativos), fill (preenchimento; sem fill = vazado),
  stroke {color,width} (traço), fillRule (nonzero|evenodd), strokeCap (butt|round|square), strokeJoin (miter|round|bevel),
  viewBox [x,y,w,h] opcional. Sem viewBox, as coordenadas de d são px a partir do canto (x,y) do nó; com viewBox,
  o desenho é escalado para caber em width×height (bom para ícones num grid 24×24). Sem width/height, o nó
  ganha a caixa do desenho. Curvas: "C c1x c1y c2x c2y x y" (cúbica), "Q cx cy x y" (quadrática), S/T espelham
  o controle anterior (curvas suaves). Use get_bounds (caixas absolutas + cantos rotacionados), path_info para conferir bounds antes de posicionar.
shape: shape (rect|ellipse|diamond|triangle|cylinder|parallelogram|cloud|note), text (centralizado; numa nota, no topo à esquerda), color, fontFamily (string | "$token"), fontSize (n | "$token"),
  fontWeight (100..900 | "$token"), lineHeight (n | "$token"), textAlign. width/height são números (padrão 160×80; nota 160×160). fill/stroke/radius/shadow
  pintam o contorno; campos omitidos na criação ganham o padrão do tipo (branco com borda escura; note = nota adesiva amarela).
connector: from/to = {nodeId, side?: auto|top|right|bottom|left} (preso a um nó) ou {x, y} (ponto solto nas coordenadas
  do pai), route (straight|elbow|rounded|curve), radius (cantos arredondados), control {x,y} (alça da curva nas coords do pai), startArrow/endArrow (none|arrow), stroke {color,width}, dashed,
  label (texto no meio da rota, na cor do traço: "sim", "não"). x, y, width, height e
  d são calculados a partir das pontas a cada escrita (só leitura): mover uma forma redesenha os conectores dela, e
  apagar um nó apaga os conectores presos a ele.
Diagramas: draw_diagram recebe nodes (formas) + edges (conectores) e posiciona sozinho as formas sem x/y.

Cores: #hex, rgb(), rgba() ou "$token" (ver set_tokens). Prefira tokens para cores e tamanhos recorrentes. set_tokens aceita type (color, length, fontFamily, fontWeight, fontSize, lineHeight, letterSpacing) e collection. Um token com tipo é conferido ao gravar e ao usar; sem tipo continua string ou número e ainda entra em qualquer campo de comprimento. fontWeight e lineHeight tipados saem sem unidade nas variáveis CSS; os outros números ficam em px. detach_tokens troca "$nome" pelo literal resolvido no modo do nó.
Modos de tema: set_tokens com mode ("dark", "compact"…) grava só os tokens que mudam; o valor do modo tem de combinar com o tipo do token. "mode" num frame ou página aplica o modo ao subtree (dá para pôr a mesma tela clara e escura lado a lado). Uma coleção é um nome no token, não um segundo mapa de valores. export_code com cssVariables: true sai com var(--token) e uma regra por modo.
"fill" em width/height ocupa o espaço restante no eixo principal do pai com layout, ou estica no eixo cruzado.

Posicionamento: um frame novo de topo deixa x e y de fora (ou passa place:"free") e cai no espaço livre, à direita do conteúdo da página, no mesmo topo, respiro 80, quebrando para a linha de baixo depois de 2400px a partir da esquerda do conteúdo. place é "free" | "below" | "right" | {near, side: left|right|above|below} | "none" (x/y exatos). Escritas simultâneas não ocupam o mesmo lugar. get_document_outline e get_bounds sem ids devolvem a caixa do conteúdo da página e o próximo lugar livre. Desenhe overlays (modais, menus, toasts) por último, ou traga-os para a frente com index:"front". Uma escrita avisa quando um nó novo de topo sobrepõe outro e diz o lugar livre mais próximo.

Apontamentos: o humano pode apontar um nó ou uma área do canvas e escrever o que fazer ali ("Apontar para a IA"). Chame list_pins primeiro quando o humano falar de apontamentos e sempre que um resultado de escrita trouxer openPins; claim_pin antes de trabalhar num deles, resolve_pin com uma resposta curta ao terminar. wait_for_pins espera os novos.

Fluxo recomendado:
1. get_document_outline para se orientar (barato).
2. set_tokens com a paleta e a escala tipográfica (passe type e collection quando o token for tipado). propose_tokens lê variáveis CSS, um tema Tailwind ou tokens JSON a partir do conteúdo que você passa (o texto do arquivo, nunca um caminho no disco) e devolve operações set_tokens; não grava o documento.
3. create_nodes com árvores aninhadas (children) numa só chamada; prefira frames com layout a posicionamento absoluto.
4. lint_design e corrija o que vier como error/warning. rootIds (ou rootId) limita às subárvores. groups dobra cada regra numa contagem e nos primeiros maxIds ids (padrão 8), em ordem de severidade; issues continua com cada achado. minSeverity (info|warning|error) descarta o que é mais quieto. minFontSize sobe o piso de small-text (padrão 12). Um frame com scaledMock, ou lintIgnore no nó, tira da lista o tipo pequeno e as cores literais de propósito.
5. render_screenshot para conferir visualmente; export_image para PNG/JPEG/WebP/AVIF/PDF sem Chromium; export_code para levar ao código.
Para trazer um ícone ou um trecho de página pronto, use import_svg (caminhos, texto e sprites <use>/<symbol> viram nós editáveis) ou import_html (estilos inline, ou computed:true para o servidor renderizar o HTML no Chromium e gravar os estilos computados), import_image para um arquivo PNG, JPEG, WebP, AVIF ou GIF (.fig e PDF são recusados); export_code com format "svg" devolve SVG vetorial.
Toda escrita é atômica (tudo ou nada) e pode ser desfeita com undo. Para várias chamadas virarem um passo só de undo (ex.: "desenhar a proposta 3"), passe o mesmo batch em cada uma; o batch fecha quando outra pessoa escreve ou desfaz no meio.
Resultados: as ferramentas que devolvem JSON também devolvem structuredContent conforme o outputSchema; leia esse campo em vez de interpretar o texto.
Workspaces: o servidor guarda vários documentos (list_workspaces). As ferramentas de documento aceitam `workspaceId` opcional e leem ou escrevem nesse workspace sem `open_workspace` e sem mover o canvas do humano; sem `workspaceId`, vale o workspace ativo. A primeira linha do outline e todo resultado de escrita trazem o id e o nome desse workspace. `undo` e `redo` aceitam o mesmo `workspaceId` e desfazem só esse workspace; cada workspace guarda o próprio histórico enquanto o processo estiver no ar. Edições no workspace que o canvas está mostrando chegam ao vivo; edições em outro workspace não trocam o canvas. `open_workspace` ainda troca o ativo para todos, então pergunte ao humano antes; create_workspace cria um vazio, rename_workspace renomeia um, set_workspace_cover põe uma imagem (ou o screenshot de um frame) no card; archive_workspace esconde um do list_workspaces sem apagar (o ativo passa para o outro não arquivado atualizado mais recentemente; o único não pode ser arquivado) e unarchive_workspace traz de volta; abrir um workspace arquivado desarquiva; list_workspaces omite os arquivados salvo com includeArchived, e cada workspace informa archived; delete_workspace não tem desfazer e leva duas chamadas: a primeira, sem confirmToken, devolve um resumo do que se perde e um token de curta duração; mostre esse resumo ao humano e só chame de novo com o token depois que ele concordar. list_workspace_ops mostra quem criou, renomeou, abriu, arquivou, desarquivou ou apagou um workspace, e a entrada do apagamento guarda o resumo dele.
O humano vê suas edições ao vivo no canvas. Campos desconhecidos são rejeitados com erro: leia a mensagem e ajuste.
Erros e mensagens das ferramentas são em inglês.