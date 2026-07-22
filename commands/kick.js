const { SlashCommandBuilder } = require('discord.js');
const { performPaidKick } = require('../utils/paidKick');
const creditsService = require('../services/credits.service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deco')
    .setDescription('Déconnecte un utilisateur du vocal contre 10 crédits')
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

  async execute(interaction) {
    console.log('COMMANDE /kick EXECUTEE');

    const targetUser = interaction.options.getUser('user');
    const reason =
      interaction.options.getString('raison') ||
      `Déconnexion vocale achetée par ${interaction.user.tag}`;

    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    const buyer = await creditsService.findByDiscordId(
      interaction.user.id,
      interaction.user.tag
    );

    const result = await performPaidKick({
      buyer,
      buyerUserId: interaction.user.id,
      target,
      botMember: interaction.guild.members.me,
      guildOwnerId: interaction.guild.ownerId,
      reason,
      decrementCredits: async () => {
        await creditsService.decrementCredits(interaction.user.id, 10);
      },
    });

    return interaction.reply({
      content: result.message,
      ephemeral: true,
    });
  },
};