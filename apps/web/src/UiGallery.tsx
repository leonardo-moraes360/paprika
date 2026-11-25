/**
 * Galeria de primitivas do shadcn (PAP-B-030). Uma página em `/ui`, sem link nenhum no app, que mostra
 * cada primitiva nos dois temas para comparar com a folha desenhada no board
 * (docs/en-US/assets/boards/PAP-B-030). Não chama a API nem abre WebSocket: é só markup dos componentes.
 *
 * O painel claro não duplica estilo nenhum: a classe `ui-light` só redefine as variáveis `--color-ui-*`
 * para o espelho claro do tema (ADR 0005). Conteúdo em portal (diálogo, menu, popover, tooltip, select)
 * recebe a mesma classe `ui-light`, porque o portal nasce fora do painel, direto no `body`.
 */
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Trash2 } from "lucide-react";
import { cn } from "./lib/cn";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { Separator } from "./components/ui/separator";
import { Slider } from "./components/ui/slider";
import { Toggle } from "./components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible";
import { ScrollArea } from "./components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/ui/alert-dialog";
import { StatusLiveRegion } from "./components/ui/status";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-ui-muted-foreground">{title}</h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}

function GalleryBody({ light }: { light: boolean }) {
  const [layers, setLayers] = useState(true);
  const [opacity, setOpacity] = useState<number[]>([0.6]);
  const scope = light ? "ui-light" : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Section title="Botões">
        <Button>Conectar</Button>
        <Button variant="secondary">Salvo</Button>
        <Button variant="outline">Cancelar</Button>
        <Button variant="ghost">Duplicar</Button>
        <Button variant="destructive">Excluir</Button>
        <Button variant="link">Abrir doc</Button>
        <Button disabled>Desabilitado</Button>
        <Button size="xs">xs</Button>
        <Button size="sm">sm</Button>
        <Button>padrão</Button>
        <Button size="lg">lg</Button>
        <Button size="icon" aria-label="Copiar">
          <Copy aria-hidden />
        </Button>
        <Button variant="outline" size="icon" aria-label="Confirmar">
          <Check aria-hidden />
        </Button>
      </Section>

      <Section title="Cartão">
        <Card className="w-52">
          <CardHeader className="pb-2">
            <CardTitle>Workspace</CardTitle>
            <CardDescription>12 nós · agora</CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-ui-muted-foreground">Capa opcional e renomeação inline.</CardContent>
          <CardFooter>
            <Button size="sm">Abrir</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Campos">
        <div className="flex w-44 flex-col gap-1">
          <Label htmlFor="gal-opacity">Opacidade</Label>
          <Input id="gal-opacity" defaultValue="0,8" />
        </div>
        <div className="flex w-44 flex-col gap-1">
          <Label htmlFor="gal-bad" className="text-ui-destructive-text">
            Valor inválido
          </Label>
          <Input id="gal-bad" defaultValue="1aaaaa" aria-invalid="true" aria-describedby="gal-bad-msg" />
          <p id="gal-bad-msg" className="m-0 text-2xs text-ui-destructive-text">
            Use um número entre 0 e 1.
          </p>
        </div>
        <div className="flex w-44 flex-col gap-1">
          <Label htmlFor="gal-off">Desabilitado</Label>
          <Input id="gal-off" defaultValue="0,5" disabled />
        </div>
        <Textarea className="w-56" defaultValue="Uma folha com todas as primitivas, em claro e escuro." />
      </Section>

      <Section title="Seleção">
        <Select defaultValue="frame">
          <SelectTrigger className="w-40" aria-label="Ferramenta">
            <SelectValue placeholder="Escolher" />
          </SelectTrigger>
          <SelectContent className={scope}>
            <SelectGroup>
              <SelectLabel>Formas</SelectLabel>
              <SelectItem value="rect">Retângulo</SelectItem>
              <SelectItem value="ellipse">Elipse</SelectItem>
              <SelectItem value="frame">Frame</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Section>

      <Section title="Ligado, deslizante e divisória">
        <Toggle pressed={layers} onPressedChange={setLayers} aria-label="Camadas">
          Camadas
        </Toggle>
        <Toggle variant="outline" defaultPressed aria-label="Grade">
          Grade
        </Toggle>
        <ToggleGroup type="single" defaultValue="select" aria-label="Ferramentas" className="rounded-md border border-ui-border p-0.5">
          <ToggleGroupItem value="select" aria-label="Selecionar" size="sm">
            V
          </ToggleGroupItem>
          <ToggleGroupItem value="frame" aria-label="Frame" size="sm">
            F
          </ToggleGroupItem>
          <ToggleGroupItem value="rect" aria-label="Retângulo" size="sm">
            R
          </ToggleGroupItem>
        </ToggleGroup>
        <Slider value={opacity} onValueChange={setOpacity} min={0} max={1} step={0.1} className="w-40" aria-label="Opacidade" />
        <span className="text-xs text-ui-muted-foreground">{opacity[0]?.toFixed(1)}</span>
        <Separator className="w-8" />
        <Separator orientation="vertical" className="h-6" />
      </Section>

      <Section title="Abas e seção recolhível">
        <Tabs defaultValue="camadas" className="w-64">
          <TabsList>
            <TabsTrigger value="camadas">Camadas</TabsTrigger>
            <TabsTrigger value="paginas">Páginas</TabsTrigger>
            <TabsTrigger value="time">Time</TabsTrigger>
          </TabsList>
          <TabsContent value="camadas" className="text-xs text-ui-muted-foreground">
            Painel da aba Camadas.
          </TabsContent>
          <TabsContent value="paginas" className="text-xs text-ui-muted-foreground">
            Painel da aba Páginas.
          </TabsContent>
          <TabsContent value="time" className="text-xs text-ui-muted-foreground">
            Painel da aba Time.
          </TabsContent>
        </Tabs>
        <Collapsible defaultOpen className="w-64">
          <CollapsibleTrigger className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-sm bg-ui-accent px-2 text-xs font-semibold text-ui-accent-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring">
            <ChevronDown aria-hidden />
            Aparência
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2 py-1 text-xs text-ui-muted-foreground">
            Preenchimento, traço e sombra.
          </CollapsibleContent>
        </Collapsible>
      </Section>

      <Section title="Área rolável">
        <ScrollArea className="h-24 w-48 rounded-md border border-ui-border bg-ui-card">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-1">
            {["Login · mobile", "Cabeçalho", "Rodapé", "Botão CTA", "Formulário", "Validação", "Sucesso"].map((name) => (
              <li key={name} className="flex h-5 items-center px-1.5 text-xs text-ui-card-foreground">
                {name}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Section>

      <Section title="Popover e tooltip (abrem no hover/foco ou no clique)">
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button variant="secondary">Exportar</Button>
            </TooltipTrigger>
            <TooltipContent className={scope}>Exportar como SVG</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Popover modal={false}>
          <PopoverTrigger asChild>
            <Button variant="outline">Estilo do traço</Button>
          </PopoverTrigger>
          <PopoverContent className={cn("w-44", scope)}>
            <p className="m-0 text-xs text-ui-muted-foreground">Raio 6px, sombra suave.</p>
          </PopoverContent>
        </Popover>
      </Section>

      <Section title="Menu e diálogos (abrem no clique)">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Ações</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={scope}>
            <DropdownMenuLabel>Camada</DropdownMenuLabel>
            <DropdownMenuItem>
              Duplicar <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>
              Visível <DropdownMenuShortcut>V</DropdownMenuShortcut>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Mover para lixeira</DropdownMenuItem>
            <DropdownMenuItem variant="destructive">
              <Trash2 aria-hidden />
              Excluir <DropdownMenuShortcut>Ctrl+Del</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog>
          <DialogTrigger asChild>
            <Button>Abrir diálogo</Button>
          </DialogTrigger>
          <DialogContent className={scope}>
            <DialogHeader>
              <DialogTitle>Excluir workspace?</DialogTitle>
              <DialogDescription>3 páginas e 12 camadas serão removidas. Esta ação não pode ser desfeita.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Cancelar</Button>
              <Button variant="destructive">Excluir</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Excluir workspace</Button>
          </AlertDialogTrigger>
          <AlertDialogContent className={scope}>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanecer nesta página?</AlertDialogTitle>
              <AlertDialogDescription>Alterações não salvas podem ser perdidas.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Sair sem salvar</AlertDialogCancel>
              <AlertDialogAction>Continuar editando</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>

      <StatusLiveRegion>Estado da galeria</StatusLiveRegion>
    </div>
  );
}

export function UiGallery() {
  return (
    <main data-slot="gallery" className="flex min-h-full flex-col gap-4 bg-ui-background p-4 text-ui-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-xl font-bold">Galeria de primitivas · PAP-B-030</h1>
          <p className="m-0 text-xs text-ui-muted-foreground">
            Superfície interna (sem link no app) para comparar os componentes com a folha do board. Tema
            fechado, sem Preflight: o painel claro só troca as variáveis <code>--color-ui-*</code>.
          </p>
        </div>
        <Button variant="link" asChild>
          <a href="/">Voltar aos workspaces</a>
        </Button>
      </header>
      <div className="flex flex-wrap items-start gap-4">
        <section data-panel="dark" className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-ui-border bg-ui-background p-4">
          <h2 className="m-0 text-md font-bold">Escuro</h2>
          <GalleryBody light={false} />
        </section>
        <section data-panel="light" className="ui-light flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-ui-border bg-ui-background p-4">
          <h2 className="m-0 text-md font-bold">Claro</h2>
          <GalleryBody light />
        </section>
      </div>
    </main>
  );
}
