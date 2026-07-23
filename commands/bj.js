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

    if (!USER_ROLE_ID) {
      return interaction.reply({
        content: 'USER_ROLE_ID est manquant dans le fichier .env.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const minimumRole = interaction.guild.roles.cache.get(USER_ROLE_ID);

    if (!minimumRole) {
      return interaction.reply({
        content: 'Le rôle minimum autorisé est introuvable sur le serveur.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const memberHighestRole = interaction.member.roles.highest;
    const hasEnoughRoleLevel =
      memberHighestRole.comparePositionTo(minimumRole) >= 0;

    if (!hasEnoughRoleLevel) {
      return interaction.reply({
        content:
          "Tu dois avoir au minimum le grade Agents Shlag's pour avoir et utiliser des crédits.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = await createOrJoinTable({
      interaction,
      amount,
      creditsService,
    });

    return interaction.reply({
      content: result.message,
      flags: MessageFlags.Ephemeral,
    });
  },
};