# ORG-II

[English](README.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md) · [Русский](README.ru.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md) · [Polski](README.pl.md)

ORG-II é um framework open-source de desenvolvimento agentic, criado com Rust e Tauri para execução local-first com menos de 100 MB em disco.

Ele não é apenas mais uma ferramenta de programação com IA; é um experimento em organizações humano/Agent e alinhamento em nível organizacional. Agents estão ficando melhores, mas colaboração, observabilidade, estrutura e responsabilidade compartilhada não estão acompanhando — e em alguns casos estão piorando. Cursor, Claude Code e ferramentas semelhantes muitas vezes tratam Agents como assistentes terceirizados: úteis para gerar saída, mas difíceis de auditar, coordenar, alinhar ou evoluir em nível de sistema.

ORG-II explora um modelo diferente: Agents como colegas persistentes e observáveis dentro de uma organização estruturada. Em vez de sessões de AI IDE sem estado e difíceis de revisar, ele introduz execução de Agents reproduzível, memória entre sessões, AI blame e um runtime Rust local-first para que humanos, Agents e equipes colaborem em torno de contexto compartilhado e objetivos alinhados.

## Principais capacidades

- Sessões de longa duração com traces de execução reproduzíveis para auditoria, revisão e depuração.
- Agents baseados em Rust que funcionam com suas API keys e assinaturas de Agents existentes.
- GUI, CLI, Terminal, Git, navegador, LSP, timeline e ferramentas de banco de dados.
- Memória entre sessões, compartilhamento de conhecimento entre Agents e estado compartilhado do Workspace.
- Execução consciente de recursos, capaz de reagir a CPU, RAM e disponibilidade da atenção humana.
- Testes GUI end-to-end movidos por Agent para autoevolução supervisionada.
- Agendamento e sessões iniciadas automaticamente para que Agents possam rodar durante a noite ou continuar trabalhando enquanto você está ausente.
- Superfícies de alinhamento organizacional para coordenar humanos, Agents, objetivos e responsabilidade (WIP).
- Colaboração de sessões e workflows de issues em grupo via Supabase auto-hospedado (WIP).

## Demo

https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a

![Demo do navegador GitHub no ORGII](assets/github-browser-demo.png)

![Demo de agendamento de Agents no ORGII](assets/agent-scheduling-demo.png)

## Download

Baixe a versão mais recente do app desktop ORGII na página de [Releases](https://github.com/YORG-AI/ORGII/releases). Abra a release mais recente, baixe o instalador ou app bundle para sua plataforma e siga as instruções do sistema operacional para instalar o ORGII.

## Desenvolver a partir do código-fonte

Para compilar ou contribuir a partir do código-fonte:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

Para mais detalhes de contribuição, consulte [CONTRIBUTING.md](CONTRIBUTING.md). Pedimos que todos sejam respeitosos e empáticos; consulte [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Sidecars nativos opcionais

Os recursos Browser Use e Computer Use dependem de helpers nativos opcionais para automação de navegador e automação de tela no macOS:

- `agent-browser` é baixado das releases de `vercel-labs/agent-browser` para o OS/CPU atual.
- `peekaboo` é baixado das releases de `steipete/peekaboo` no macOS.

Computer Use atualmente está disponível apenas no macOS. Browser Use pode usar `agent-browser` em plataformas compatíveis.

Se um sidecar estiver ausente, o build Rust cria um pequeno placeholder resource para que builds de desenvolvimento possam continuar. O recurso relacionado pode voltar para o `PATH` ou permanecer indisponível até você executar `pnpm run download:sidecars`.

## Licença

ORGII é licenciado sob a GNU Affero General Public License v3.0 ou posterior (`AGPL-3.0-or-later`). Consulte [`LICENSE`](LICENSE) para o texto completo da licença.
