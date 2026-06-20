# ORG-2

**IDE agentique open-source dans le style de Cursor — mais conçu pour la lisibilité des revues, la traçabilité et le contrôle, pas seulement pour coder plus vite.**

Construit avec Rust et Tauri pour une exécution local-first sous 100 Mo sur disque. Prend en charge le livestream et le replay des trajectoires d’Agents. Facile à suivre et à relire.

[English](../../README.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md) · [Русский](README.ru.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md) · [Polski](README.pl.md)

<p align="center">
  <video src="https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a" controls width="720"></video>
</p>

Ce n’est pas seulement un autre outil de codage IA ; c’est une expérimentation sur les organisations humain/agent et l’alignement au niveau organisationnel. Les Agents deviennent plus performants, mais la collaboration, l’observabilité, la structure et la responsabilité partagée ne suivent pas — et, dans certains cas, régressent. Cursor, Claude Code et les outils similaires traitent souvent les Agents comme des assistants externalisés : utiles pour produire du résultat, mais difficiles à auditer, coordonner, aligner ou faire évoluer au niveau système.

ORG-II explore un autre modèle : des Agents comme collègues persistants et observables au sein d’une organisation structurée. Au lieu de sessions d’AI IDE sans état et difficiles à relire, il introduit l’exécution d’Agents rejouable, la mémoire inter-session, l’AI blame et un runtime Rust local-first afin que les humains, les Agents et les équipes puissent collaborer autour d’un contexte partagé et d’objectifs alignés.

## Capacités clés

- Sessions longues avec traces d’exécution rejouables pour l’audit, la revue et le débogage.
- Agents basés sur Rust qui fonctionnent avec vos clés API et abonnements d’Agents existants.
- GUI, CLI, terminal, Git, navigateur, LSP, timeline et outils de base de données.
- Mémoire inter-session, partage de connaissances entre Agents et état de workspace partagé.
- Exécution consciente des ressources, capable de réagir au CPU, à la RAM et à la disponibilité de l’attention humaine.
- Tests end-to-end de GUI alimentés par Agent pour une auto-évolution supervisée.
- Planification et sessions lancées automatiquement pour permettre aux Agents de travailler toute la nuit ou de continuer pendant votre absence.
- Surfaces d’alignement organisationnel pour coordonner humains, Agents, objectifs et responsabilité (WIP).
- Collaboration de session et workflows d’issues de groupe via Supabase auto-hébergé (WIP).

<p align="center">
  <img src="../../assets/github-browser-demo.png" alt="Démo du navigateur GitHub dans ORGII" width="720" />
</p>

<p align="center">
  <img src="../../assets/agent-scheduling-demo.png" alt="Démo de planification des Agents ORGII" width="720" />
</p>

## Télécharger

Téléchargez la dernière application desktop ORGII depuis la page [Releases](https://github.com/YORG-AI/ORGII/releases). Ouvrez la dernière release, téléchargez l’installateur ou le bundle d’application pour votre plateforme, puis suivez les instructions de votre système d’exploitation pour installer ORGII.

## Développer depuis les sources

Pour construire ou contribuer depuis les sources :

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

Pour plus de détails sur la contribution, consultez [CONTRIBUTING.md](../../CONTRIBUTING.md). Nous demandons à chacun de rester respectueux et empathique ; consultez [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md).

## Sidecars natifs optionnels

Les fonctionnalités Browser Use et Computer Use dépendent de helpers natifs optionnels pour l’automatisation du navigateur et l’automatisation d’écran sur macOS :

- `agent-browser` est téléchargé depuis les releases `vercel-labs/agent-browser` pour l’OS/CPU actuel.
- `peekaboo` est téléchargé depuis les releases `steipete/peekaboo` sur macOS.

Computer Use est actuellement disponible uniquement sur macOS. Browser Use peut utiliser `agent-browser` sur les plateformes prises en charge.

Si un sidecar est manquant, le build Rust crée une petite ressource placeholder pour permettre aux builds de développement de continuer. La capacité associée peut revenir au `PATH` ou rester indisponible jusqu’à l’exécution de `pnpm run download:sidecars`.

## Licence

ORGII est sous licence GNU Affero General Public License v3.0 ou ultérieure (`AGPL-3.0-or-later`). Consultez [`LICENSE`](../../LICENSE) pour le texte complet de la licence.
