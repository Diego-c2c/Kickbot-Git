const { MessageFlags } = require('discord.js');
const { handleBlackjackButton } = require('../utils/blackjackGame');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isButton()) {
      const handled = await handleBlackjackButton(interaction);
      if (handled) return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "Une erreur est survenue pendant l'exécution de la commande.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "Une erreur est survenue pendant l'exécution de la commande.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};