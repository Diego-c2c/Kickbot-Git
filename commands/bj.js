const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const creditsService = require('../services/credits.service');
const { createOrJoinTable } = require('../utils/blackjackGame');

const USER_ROLE_ID = process.env.USER_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bj')
    .setDescription('Lance ou rejoint une table de blackjack')
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Montant de la mise en crédits')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!USER_ROLE_ID) {
      return interaction.editReply({
        content: 'USER_ROLE_ID est manquant dans le fichier .env.',
      });
    }

    const minimumRole = interaction.guild.roles.cache.get(USER_ROLE_ID);

    if (!minimumRole) {
      return interaction.editReply({
        content: 'Le rôle minimum autorisé est introuvable sur le serveur.',
      });
    }

    const memberHighestRole = interaction.member.roles.highest;
    const hasEnoughRoleLevel =
      memberHighestRole.comparePositionTo(minimumRole) >= 0;

    if (!hasEnoughRoleLevel) {
      return interaction.editReply({
        content:
          "Tu dois avoir au minimum le grade Agents Shlag's pour avoir et utiliser des crédits.",
      });
    }

    const result = await createOrJoinTable({
      interaction,
      amount,
      creditsService,
    });

    return interaction.editReply({
      content: result.message,
    });
  },
};