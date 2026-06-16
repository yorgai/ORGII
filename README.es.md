# ORG-II

[English](README.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md) · [Русский](README.ru.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md) · [Polski](README.pl.md)

ORG-II es un framework open-source de desarrollo agentic construido con Rust y Tauri para ejecución local-first con menos de 100 MB en disco.

No es solo otra herramienta de programación con IA; es un experimento en organizaciones humano/Agent y alineación a nivel organizacional. Los Agents están mejorando, pero la colaboración, la observabilidad, la estructura y la responsabilidad compartida no avanzan al mismo ritmo — y en algunos casos empeoran. Cursor, Claude Code y herramientas similares suelen tratar a los Agents como asistentes externalizados: útiles para producir resultados, pero difíciles de auditar, coordinar, alinear o evolucionar a nivel de sistema.

ORG-II explora un modelo distinto: Agents como colegas persistentes y observables dentro de una organización estructurada. En lugar de sesiones de AI IDE sin estado y difíciles de revisar, introduce ejecución de Agents reproducible, memoria entre sesiones, AI blame y un runtime Rust local-first para que humanos, Agents y equipos colaboren alrededor de contexto compartido y objetivos alineados.

## Capacidades clave

- Sesiones de larga duración con trazas de ejecución reproducibles para auditoría, revisión y depuración.
- Agents basados en Rust que funcionan con tus API keys y suscripciones de Agents existentes.
- GUI, CLI, Terminal, Git, navegador, LSP, timeline y herramientas de base de datos.
- Memoria entre sesiones, intercambio de conocimiento entre Agents y estado compartido del Workspace.
- Ejecución consciente de recursos que puede reaccionar a CPU, RAM y disponibilidad de atención humana.
- Pruebas end-to-end de GUI impulsadas por Agent para autoevolución supervisada.
- Programación y sesiones iniciadas automáticamente para que los Agents trabajen durante la noche o continúen cuando no estás.
- Superficies de alineación organizacional para coordinar humanos, Agents, objetivos y responsabilidad (WIP).
- Colaboración de sesiones y flujos de issues de grupo mediante Supabase autohospedado (WIP).

## Demo

https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a

![Demo del navegador GitHub en ORGII](assets/github-browser-demo.png)

![Demo de programación de Agents en ORGII](assets/agent-scheduling-demo.png)

## Descargar

Obtén la última aplicación desktop de ORGII desde la página de [Releases](https://github.com/YORG-AI/ORGII/releases). Abre la release más reciente, descarga el instalador o app bundle para tu plataforma y sigue las instrucciones del sistema operativo para instalar ORGII.

## Desarrollar desde el código fuente

Para compilar o contribuir desde el código fuente:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

Para más detalles sobre contribución, consulta [CONTRIBUTING.md](CONTRIBUTING.md). Pedimos a todos actuar con respeto y empatía; consulta [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Sidecars nativos opcionales

Las funciones Browser Use y Computer Use dependen de helpers nativos opcionales para automatización del navegador y automatización de pantalla en macOS:

- `agent-browser` se descarga desde las releases de `vercel-labs/agent-browser` para el OS/CPU actual.
- `peekaboo` se descarga desde las releases de `steipete/peekaboo` en macOS.

Computer Use actualmente solo está disponible en macOS. Browser Use puede usar `agent-browser` en plataformas compatibles.

Si falta un sidecar, el build de Rust crea un pequeño recurso placeholder para que los builds de desarrollo puedan continuar. La capacidad relacionada puede volver al `PATH` o permanecer no disponible hasta ejecutar `pnpm run download:sidecars`.

## Licencia

ORGII está licenciado bajo GNU Affero General Public License v3.0 o posterior (`AGPL-3.0-or-later`). Consulta [`LICENSE`](LICENSE) para ver el texto completo de la licencia.
