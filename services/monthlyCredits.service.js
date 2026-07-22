// Importe node-cron pour lancer une tâche automatique à une date précise
const cron = require('node-cron');

// ID du rôle minimum autorisé à recevoir les crédits mensuels
// Tous les membres ayant ce rôle OU un rôle supérieur recevront les crédits
const USER_ROLE_ID = process.env.USER_ROLE_ID;

// Nombre de crédits donnés chaque début de mois
const MONTHLY_CREDITS = 30;

// Fonction principale qui démarre la tâche mensuelle
// On lui passe :
// - client : ton client Discord.js
// - creditsService : ton service qui gère les crédits
function startMonthlyCreditsJob(client, creditsService) {
  // Vérifie que USER_ROLE_ID existe bien dans le .env
  if (!USER_ROLE_ID) {
    console.error("USER_ROLE_ID manquant dans le fichier .env");
    return;
  }

  // Planifie une tâche cron :
  // '0 0 1 * *' = à 00:00 le 1er jour de chaque mois
  cron.schedule('0 0 1 * *', async () => {
    console.log('[MONTHLY_CREDITS] Début de la distribution mensuelle...');

    try {
      // Récupère le serveur Discord via son ID
      const guild = client.guilds.cache.get(process.env.GUILD_ID);

      // Sécurité : si le serveur n'est pas trouvé, on arrête
      if (!guild) {
        console.error('[MONTHLY_CREDITS] Serveur introuvable.');
        return;
      }

      // Récupère le rôle minimum autorisé
      const minimumRole = guild.roles.cache.get(USER_ROLE_ID);

      // Sécurité : si le rôle n'existe pas, on arrête
      if (!minimumRole) {
        console.error('[MONTHLY_CREDITS] Rôle minimum introuvable sur le serveur.');
        return;
      }

      // Force le chargement des membres du serveur
      // Cela évite de ne travailler que sur les membres déjà en cache
      await guild.members.fetch();

      // Garde uniquement les membres :
      // - qui ne sont pas des bots
      // - dont le plus haut rôle est égal ou supérieur à USER_ROLE_ID
      const eligibleMembers = guild.members.cache.filter((member) => {
        if (member.user.bot) return false;

        const memberHighestRole = member.roles.highest;
        return memberHighestRole.comparePositionTo(minimumRole) >= 0;
      });

      // Compteur pour savoir combien de membres ont été crédités
      let updatedCount = 0;

      // Boucle sur tous les membres autorisés
      for (const [, member] of eligibleMembers) {
        // Ajoute 30 crédits au membre
        await creditsService.incrementCredits(
          member.user.id,
          MONTHLY_CREDITS,
          member.user.tag
        );

        // Incrémente le compteur après mise à jour réussie
        updatedCount++;
      }

      // Affiche dans la console le nombre total de membres crédités
      console.log(
        `[MONTHLY_CREDITS] ${updatedCount} membre(s) ont reçu ${MONTHLY_CREDITS} crédits.`
      );
    } catch (error) {
      // Si une erreur arrive pendant la distribution,
      // elle est affichée dans la console
      console.error('[MONTHLY_CREDITS] Erreur pendant la distribution :', error);
    }
  });

  // Message affiché au démarrage du bot pour confirmer
  // que la tâche mensuelle a bien été enregistrée
  console.log('[MONTHLY_CREDITS] Tâche mensuelle initialisée.');
}

// Exporte la fonction pour pouvoir l'utiliser dans index.js
module.exports = {
  startMonthlyCreditsJob,
};