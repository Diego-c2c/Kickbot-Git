// Charge les variables d'environnement depuis le fichier .env
require('dotenv').config();

// Modules Node.js pour lire les dossiers/fichiers et construire des chemins
const fs = require('node:fs');
const path = require('node:path');

// Importe les outils principaux de discord.js
const { Client, Collection, GatewayIntentBits } = require('discord.js');

// Importe le service de crédits
const creditsService = require('./services/credits.service');

// Importe le service qui ajoute 30 crédits chaque début de mois
const { startMonthlyCreditsJob } = require('./services/monthlyCredits.service');

// Création du client Discord
// On active ici les intents nécessaires :
// - Guilds : indispensable pour les slash commands et le serveur
// - GuildMembers : nécessaire pour récupérer les membres du serveur
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Collection qui stockera toutes les commandes du bot
// Exemple : /roulette, /kick, etc.
client.commands = new Collection();

// Chemin vers le dossier commands
const commandsPath = path.join(__dirname, 'commands');

// Liste tous les fichiers .js du dossier commands
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js'));

// Charge chaque commande automatiquement
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  // Vérifie que le fichier exporte bien :
  // - data : la définition de la commande
  // - execute : la fonction exécutée quand on lance la commande
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  }
}

// Chemin vers le dossier events
const eventsPath = path.join(__dirname, 'events');

// Liste tous les fichiers .js du dossier events
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith('.js'));

// Charge chaque événement automatiquement
for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);

  // Si l'événement doit se déclencher une seule fois
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    // Sinon il se déclenche à chaque fois que l'événement arrive
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// Quand le client Discord est totalement prêt
client.once('clientReady', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  // Démarre la tâche mensuelle qui ajoutera 30 crédits
  // aux membres ayant le rôle USER_ROLE_ID
  startMonthlyCreditsJob(client, creditsService);
});

// Connexion du bot à Discord avec le token du fichier .env
client.login(process.env.DISCORD_TOKEN);