const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const creditsService = require('../services/credits.service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addcredits')
    .setDescription('Ajoute des crédits à un utilisateur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Utilisateur à créditer')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Nombre de crédits à ajouter')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    // Récupère l'utilisateur ciblé
    const user = interaction.options.getUser('user');

    // Récupère le nombre de crédits à ajouter
    const amount = interaction.options.getInteger('amount');

    // Sécurités simples
    if (amount <= 0) {
      return interaction.reply({
        content: "Le nombre de crédits doit être supérieur à 0.",
        ephemeral: true,
      });
    }

    // Crée l'utilisateur s'il n'existe pas, puis ajoute les crédits
    await creditsService.findByDiscordId(user.id, user.tag);
    const updatedUser = await creditsService.incrementCredits(user.id, amount, user.tag);

    return interaction.reply({
      content: `${amount} crédit(s) ont été ajoutés à ${user.tag}. Nouveau solde : ${updatedUser.credits}.`,
      ephemeral: true,
    });
  },
};