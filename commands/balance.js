const { SlashCommandBuilder } = require('discord.js');
const creditsService = require('../services/credits.service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Affiche ton nombre de crédits restants'),

  async execute(interaction) {
    const buyer = await creditsService.getBalance(interaction.user.id, interaction.user.tag);

    return interaction.reply({
      content: `Tu as ${buyer.credits} crédit(s).`,
      ephemeral: true,
    });
  },
};
