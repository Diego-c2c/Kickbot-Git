const { MessageFlags } = require('discord.js');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // On ne traite que les slash commands
    if (!interaction.isChatInputCommand()) return;

    // Récupère la commande depuis la collection stockée sur le client
    const command = interaction.client.commands.get(interaction.commandName);

    // Si la commande n'existe pas, on arrête
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);

      // Si une erreur survient après que l'interaction ait déjà eu une réponse
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