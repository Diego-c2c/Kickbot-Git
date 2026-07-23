const { SlashCommandBuilder } = require('discord.js');
const { performPaidKick } = require('../utils/paidKick');

/*
|--------------------------------------------------------------------------
| Commande /deco
|--------------------------------------------------------------------------
|
| Cette commande permet de déconnecter un utilisateur d'un salon vocal
| contre des crédits.
|
| Le coût réel n'est pas fixé ici :
| il est calculé dans utils/paidKick.js selon :
| - le nombre de /deco utilisés dans le mois
| - la limite anti-spam sur une même cible
|--------------------------------------------------------------------------
*/

module.exports = {
  /*
  |--------------------------------------------------------------------------
  | Définition de la slash command
  |--------------------------------------------------------------------------
  */
  data: new SlashCommandBuilder()
    .setName('deco')
    .setDescription('Déconnecte un utilisateur du vocal contre des crédits')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Utilisateur à déconnecter du vocal')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('raison')
        .setDescription('Raison de la déconnexion')
        .setRequired(false)
    ),

  /*
  |--------------------------------------------------------------------------
  | Exécution de la commande
  |--------------------------------------------------------------------------
  */
  async execute(interaction) {
    console.log('COMMANDE /deco EXECUTEE');

    // Récupère l'utilisateur ciblé dans la slash command
    const targetUser = interaction.options.getUser('user');

    // Raison facultative ; sinon on génère une raison par défaut
    const reason =
      interaction.options.getString('raison') ||
      `Déconnexion vocale achetée par ${interaction.user.tag}`;

    // On tente de récupérer le membre dans le serveur
    const target = await interaction.guild.members
      .fetch(targetUser.id)
      .catch(() => null);

    // Si l'utilisateur n'est pas trouvable sur le serveur
    if (!target) {
      return interaction.reply({
        content: "Impossible de trouver cet utilisateur sur le serveur.",
        ephemeral: true,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Appel de la logique métier
    |--------------------------------------------------------------------------
    |
    | Toute la logique est dans utils/paidKick.js :
    | - coût progressif mensuel
    | - anti-spam de cible
    | - vérification salon vocal
    | - vérification permissions
    | - vérification hiérarchie
    | - débit/remboursement crédits
    | - déconnexion du vocal
    |--------------------------------------------------------------------------
    */
    const result = await performPaidKick({
      interaction,
      target,
      reason,
    });

    // Réponse privée au joueur qui a lancé /deco
    return interaction.reply({
      content: result.message,
      ephemeral: true,
    });
  },
};