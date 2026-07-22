# Documentation du bot Discord KickBot

## Vue d'ensemble

Ce bot Discord est un bot en Node.js basé sur discord.js v14. Il charge automatiquement ses commandes et ses événements depuis les dossiers `commands/` et `events/`, puis se connecte à Discord avec le token stocké dans le fichier `.env`. Le démarrage principal se fait dans `index.js`, qui initialise le client, enregistre les handlers et lance la tâche mensuelle de crédits quand le bot est prêt.[cite:695][cite:694]

Le système actuel repose sur trois briques principales :

- les commandes slash, comme `/roulette`
- les événements Discord, notamment `interactionCreate`
- les services métier, comme `credits.service.js` et `monthlyCredits.service.js`

## Structure du projet

L'arborescence logique actuelle du bot est la suivante :

```text
kick-bot/
├── commands/
│   └── roulette.js
├── events/
│   └── interactionCreate.js
├── services/
│   ├── credits.service.js
│   └── monthlyCredits.service.js
├── utils/
│   ├── roulette.js
│   └── rouletteRounds.js
├── deploy-commands.js
├── index.js
├── package.json
└── .env
```

Le dossier `commands/` contient les slash commands chargées dynamiquement au démarrage, tandis que `events/` contient les handlers Discord branchés avec `client.on(...)` ou `client.once(...)`. Ce modèle de chargement automatique est cohérent avec les pratiques courantes de gestion d'événements et de commandes dans discord.js.[cite:695][cite:705]

## Variables d'environnement

Le bot dépend d'un fichier `.env` pour ses paramètres sensibles et ses identifiants de rôles. Les variables utilisées dans le projet sont notamment :

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `LEGENDARY_ROLE_ID`
- `EPIC_ROLE_ID`
- `MODO_ROLE_ID`
- `BOT_ROLE_ID`
- `USER_ROLE_ID`

Ces variables sont chargées avec `dotenv`, ce qui permet d'accéder à leur valeur via `process.env` dans les différents fichiers du projet.[cite:649][cite:652]

## Démarrage du bot

Le fichier `index.js` fait les actions suivantes :

1. charge les variables d'environnement avec `dotenv`
2. crée le client Discord avec les intents nécessaires
3. charge automatiquement les commandes du dossier `commands/`
4. charge automatiquement les événements du dossier `events/`
5. se connecte à Discord
6. lance la tâche mensuelle de crédits quand l'événement `clientReady` se déclenche

L'événement `clientReady` est bien le nom recommandé à utiliser à la place de `ready` dans les versions récentes de discord.js.[cite:696][cite:697]

## Commandes slash

### `/roulette`

La commande `/roulette` permet à un utilisateur de miser ses crédits sur une roulette simple. Les options actuellement disponibles sont :

- `bet` : `red`, `black`, `even`, `odd`, `number`
- `amount` : le montant misé
- `number` : le numéro entre 0 et 36, uniquement si `bet = number`

Les options de slash command avec choix prédéfinis et entiers correspondent bien au modèle prévu par discord.js pour les commandes d'application.[cite:500][cite:627]

## Règles d'accès aux crédits

L'accès aux crédits n'est pas limité au seul rôle `USER_ROLE_ID`. La logique actuelle a été élargie pour autoriser tout membre dont le plus haut rôle est **égal ou supérieur** à `USER_ROLE_ID` dans la hiérarchie Discord. Cette comparaison de niveau se fait via la position des rôles, ce qui correspond au fonctionnement prévu dans discord.js avec `comparePositionTo(...)`.[cite:711][cite:644]

Cette logique dépend directement de l'ordre réel des rôles dans le serveur Discord. Si les rôles ne sont pas placés correctement dans la hiérarchie du serveur, l'autorisation donnée par le bot suivra cet ordre et non le nom affiché du rôle.[cite:710][cite:720]

## Système de crédits

Le service `credits.service.js` utilise actuellement un stockage en mémoire basé sur `Map`. Quand un utilisateur est rencontré pour la première fois, il est créé avec **50 crédits par défaut**. Les fonctions principales sont :

- `findByDiscordId(...)` : récupère ou crée l'utilisateur
- `decrementCredits(...)` : retire des crédits
- `incrementCredits(...)` : ajoute des crédits
- `getBalance(...)` : retourne le solde actuel

Ce fonctionnement est volontairement simple et ne modifie pas la logique actuelle du bot. En revanche, comme les données sont stockées en mémoire, elles disparaissent si le process Node.js redémarre, car une `Map` mémoire n'est pas persistante entre deux exécutions.[cite:693][cite:690]

## Roulette

### Fonctionnement général

La roulette est gérée par trois fichiers :

- `commands/roulette.js` : validation de la commande et accès utilisateur
- `utils/roulette.js` : logique des numéros, couleurs, parité et résolution des mises
- `utils/rouletteRounds.js` : gestion des tours de roulette partagés dans un salon

La roulette implémente une roulette européenne simple avec 37 résultats possibles, de 0 à 36. Les paris `red/black` et `even/odd` sont traités comme des paris à 1:1, tandis qu'un pari sur un numéro exact est traité comme un pari à 35:1.[cite:560][cite:606][cite:573]

### Tour partagé de 40 secondes

Le bot utilise un seul tour actif par salon texte. Le fonctionnement est le suivant :

1. tant qu'aucune mise n'est faite, aucun tour n'est actif
2. la première mise démarre un tour de 40 secondes
3. plusieurs utilisateurs peuvent rejoindre ce tour
4. un même utilisateur peut poser plusieurs mises pendant le même tour
5. un message public dans le salon affiche le compte à rebours
6. le message est mis à jour aux paliers 40, 30, 20, 10 et 5 secondes
7. à la fin, une seule bille est tirée et le résultat est affiché publiquement

L'édition d'un message déjà envoyé à intervalles définis avec `setTimeout` est un schéma valide pour gérer un compte à rebours textuel dans un bot Discord.js.[cite:592][cite:596]

### Résultat public

Quand le temps est écoulé, le bot :

- ferme les mises
- tire un numéro
- calcule les gains et pertes de chaque mise
- ajoute les gains via `incrementCredits(...)`
- envoie le résultat final dans le salon avec les gagnants et les perdants

L'envoi dans un salon texte dépend des permissions du bot sur ce salon. Si le bot n'a pas accès au salon ou n'a pas `Send Messages`, Discord renvoie une erreur `Missing Access` ou `Missing Permissions`.[cite:631][cite:630]

## Tâche mensuelle de crédits

Le fichier `services/monthlyCredits.service.js` démarre une tâche planifiée avec `node-cron`. Cette tâche s'exécute le **1er jour de chaque mois à 00:00** grâce à l'expression cron `0 0 1 * *`.[cite:667][cite:698]

À chaque exécution, le service :

1. récupère le serveur Discord avec `GUILD_ID`
2. récupère le rôle minimum autorisé avec `USER_ROLE_ID`
3. charge les membres du serveur avec `guild.members.fetch()`
4. filtre les membres non bots dont le plus haut rôle est égal ou supérieur à `USER_ROLE_ID`
5. ajoute 30 crédits à chacun avec `creditsService.incrementCredits(...)`

Le chargement explicite des membres avec `guild.members.fetch()` est nécessaire pour ne pas dépendre uniquement du cache local du bot.[cite:656][cite:666]

## Événement `interactionCreate`

Le fichier `events/interactionCreate.js` doit récupérer les commandes avec `interaction.client.commands.get(interaction.commandName)`. Avec le système de chargement actuel, l'objet `interaction` est l'argument directement transmis à l'événement, donc il est plus sûr d'utiliser `interaction.client` plutôt que d'attendre un `client` passé manuellement.[cite:703][cite:701]

Ce point est important, car une mauvaise signature du handler peut produire une erreur du type `Cannot read properties of undefined (reading 'commands')`.[cite:702][cite:703]

## Permissions Discord nécessaires

Pour fonctionner correctement, le bot doit avoir au minimum les permissions adaptées dans le serveur et dans les salons où il agit. En pratique, pour la roulette et les messages publics, il faut vérifier au moins :

- `View Channel`
- `Send Messages`
- `Read Message History`

L'absence d'accès à un salon provoque des erreurs de type `403 Missing Access` ou `Missing Permissions` quand le bot tente d'envoyer un message dans ce salon.[cite:631][cite:630]

## Intents nécessaires

Le bot utilise actuellement :

- `GatewayIntentBits.Guilds`
- `GatewayIntentBits.GuildMembers`

`GuildMembers` est particulièrement important pour la distribution mensuelle des crédits, car le service doit pouvoir récupérer et parcourir les membres du serveur via `guild.members.fetch()`. Cette opération dépend de la gestion des membres du serveur côté Discord.js.[cite:656]

## Déploiement des commandes

Le fichier `deploy-commands.js` sert à enregistrer les slash commands dans le serveur avec l'API Discord. Quand une commande change de nom, de description ou d'options, il faut relancer le déploiement avec la commande de script adaptée. Les commandes de type application sont bien enregistrées via le client REST et les routes d'application/guild utilisées par Discord.js.[cite:500]

## Scripts npm

Le projet utilise les scripts suivants :

- `npm start` : démarre le bot
- `npm run dev` : démarre aussi le bot
- `npm run deploy` : déploie les slash commands

## Limites actuelles

Plusieurs limites sont connues dans la version actuelle :

- le stockage des crédits est en mémoire uniquement
- les crédits sont donc perdus si le bot redémarre
- la tâche mensuelle ne s'exécute que si le bot est réellement en ligne au moment prévu
- la logique des rôles dépend de la hiérarchie réelle du serveur Discord

Une tâche cron embarquée dans un process Node.js ne tourne que tant que ce process reste actif.[cite:659][cite:668]

## Étapes prévues

Les prochaines étapes prévues pour le projet sont :

1. écrire une version containerisée du bot
2. initialiser un dépôt Git propre
3. pousser le projet
4. cloner le dépôt depuis le VPS
5. déployer et lancer le bot sur le VPS

Le serveur cible actuel est une VM OVH sous Ubuntu 24.04.4 LTS, ce qui est adapté à ce type de déploiement Node.js autonome.[cite:581]

## Résumé fonctionnel

En l'état, le bot fournit :

- un chargement automatique des commandes et événements
- une commande `/roulette` avec crédits
- un système de tours partagés avec compte à rebours public
- une distribution mensuelle automatique de 30 crédits
- un contrôle d'accès par niveau de rôle minimum

Cette base est cohérente pour être préparée à une prochaine étape de containerisation et de déploiement Git sur VPS.[cite:695][cite:659]
