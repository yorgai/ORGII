# Journal des modifications

🌐 [English](Changelog) · **Français** · [中文](Changelog.zh)

Cette page résume les livraisons de chaque mois. Le journal d'activité complet, jour par jour, est accessible dans l'application sous **Changelog** dans la barre latérale gauche.

---

## Juin 2026

### Discussion de groupe Agent Org et coordination

- La discussion de groupe est désormais la vue par défaut pour les conversations d'équipe Agent Org, avec des flux de bulles en direct, des indicateurs de progression et un routage des messages non interruptifs pour ne pas perturber le travail actif des membres.
- Ajout de la messagerie directe entre membres, du routage par @-mention et de la coordination des tours par session pour des conversations multi-agents plus claires.
- Ajout de surfaces d'état d'intervention pour rendre visibles les moments de supervision humaine dans les workflows d'équipe.

### WorkStation et contrôle de source

- Refonte de la section PR dans la barre latérale Source Control avec des tokens partagés, des actions compactes et un comportement de recréation plus sûr après la fermeture ou la fusion d'une PR.
- Ajout de la navigation GitHub Issues directement dans WorkStation avec un câblage dans la barre latérale et des filtres alignés sur le Source Control.
- Ajout d'actions de sélection de diff qui copient des références de fichiers et envoient les modifications sélectionnées dans le chat pour des invites de révision plus rapides.
- Ajout de la saisie vocale push-to-talk dans le compositeur de chat.

### Canvas

- Les artefacts Canvas peuvent désormais circuler depuis la sortie de l'agent vers le chat et WorkStation sous forme de blocs intégrés ou d'onglet de prévisualisation dédié.
- Ajout de surfaces d'application simulateur Canvas, de blocs de chat `setup_repo` et de sauts chat-vers-simulateur pour des aperçus d'applications générées plus riches.

### Session et relecture

- Ajout de l'import/export JSON de session pour déplacer ou inspecter les données de session.
- Ajout des modes d'exécution du Benchmark Runner et de la gestion des tâches par lots réutilisables.
- Sérialisation des writers SQLite pour éviter les saturations de verrou de base de données lors d'une activité intensive.

---

## Mai 2026

### Runtime Agent Orgs

- Les membres Agent Org s'exécutent désormais comme de vraies sessions exécutables, avec des instantanés de lancement, des sémantiques de réveil, des revendications atomiques de tâches et des preuves d'état des membres pour un suivi runtime plus riche.
- Ajout de contrôles de pause et de reprise — remplaçant l'arrêt — avec état persisté entre les redémarrages de l'application et restauration des sessions dans la barre latérale au relancement.
- Amélioration des sous-agents conscients des worktrees pour que les exécutions de membres opèrent avec un contexte de dépôt précis.
- Ajout des preuves de file d'attente de tâches et verrouillage des règles de classification des preuves pour une catégorisation runtime cohérente.

### Authentification et fournisseurs

- Ajout des flux OAuth pour Gemini, Claude Code et Codex, couvrant la connexion intégrée, la persistance du rafraîchissement des tokens et l'isolation du changement de compte.
- Authentification GitHub par flux d'appareil ajoutée avec un ID client public intégré et un repli sur un token local.
- Amélioration de la compatibilité CLI et clé API de Cursor, réduisant les cas limites de configuration du fournisseur.

### WorkStation

- Ajout de la navigation All Tabs et du changement d'onglets entre hôtes.
- Introduction d'une pilule de présence qui injecte le contexte de disponibilité dans les sessions d'agents actives.
- Ajout de vues de projet Linear natives pour inspecter les données de projet liées à Linear dans ORGII.
- Ajout de flux d'approbation du mode plan avec des états de révision de plan d'agent plus clairs.
- Ajout de métriques de streaming en direct dans le chat : temps écoulé, taux de tokens et estimation de complétion.

### Configuration des agents

- Ajout de sections de limites runtime partagées dans les pages de configuration des agents avec des capacités par défaut plus strictes et un amorçage d'outils désactivés par défaut.
- Consolidation des Règles, de la Mémoire et de l'Évolution dans une surface de paramètres unifiée.
- Amélioration de la gestion de SOUL.md pour que le contexte de personnalité s'applique de manière cohérente aux flux d'agents prévus.

---

## Avril 2026 et antérieur

Les journaux complets jour par jour pour avril 2026 et jusqu'à juin 2025 sont disponibles dans le Changelog intégré à l'application. Ouvrez l'application et sélectionnez **Changelog** dans la barre latérale gauche.

---

## À propos de ce journal

ORGII est développé quotidiennement. Chaque entrée ci-dessus est un résumé de haut niveau tiré de l'activité des commits. Les nombres exacts de commits et les détails frontend/backend par jour sont visibles dans l'application.

Modèles utilisés pour le développement : **GPT 5.5**, **Opus 4.6**.
