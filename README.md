# Discord Paid Kick Bot

Bot Discord.js v14 avec système simple de crédits pour kicker uniquement les membres ayant le rôle `Agents Shlag's`.

## Hiérarchie attendue

- Legendary
- Epic
- Modo Agents Shlag's
- Bot shlag's
- Agents Shlag's

## Installation

```bash
npm install
cp .env.example .env
```

Puis remplis ton `.env` avec :
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- les IDs des rôles

## Déployer les commandes

```bash
npm run deploy
```

## Lancer le bot

```bash
npm run start
```

## Commandes

- `/balance` : affiche les crédits
- `/kick user:@membre raison:texte` : kick un membre si autorisé et retire 1 crédit après succès

## Important

Le fichier `services/credits.service.js` utilise ici un stockage mémoire de démonstration. Remplace-le par PostgreSQL ou ton backend existant pour la production.
