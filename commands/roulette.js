const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const creditsService = require('../services/credits.service');
const { addBetToRound } = require('../utils/rouletteRounds');

const USER_ROLE_ID = process.env.USER_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Mise tes crédits à la roulette')
    .addStringOption((option) =>
      option
        .setName('bet')
        .setDescription('Type de pari')
        .setRequired(true)
        .addChoices(
          { name: 'red', value: 'red' },
          { name: 'black', value: 'black' },
          { name: 'even', value: 'even' },
          { name: 'odd', value: 'odd' },
          { name: 'number', value: 'number' }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Montant de la mise')
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption((option) =>
      option
        .setName('number')
        .setDescription('Numéro entre 0 et 36 si bet = number')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(36)
    ),

  async execute(interaction) {
    const bet = interaction.options.getString('bet');
    const amount = interaction.options.getInteger('amount');
    const number = interaction.options.getInteger('number');

    // Vérifie que USER_ROLE_ID existe bien dans le .env
    if (!USER_ROLE_ID) {
      return interaction.reply({
        content: "USER_ROLE_ID est manquant dans le fichier .env.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Récupère le rôle USER_ROLE_ID dans le serveur
    const minimumRole = interaction.guild.roles.cache.get(USER_ROLE_ID);

    if (!minimumRole) {
      return interaction.reply({
        content: "Le rôle minimum autorisé est introuvable sur le serveur.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Récupère le plus haut rôle du membre
    const memberHighestRole = interaction.member.roles.highest;

    // Autorise si le plus haut rôle du membre est égal ou supérieur
    const hasEnoughRoleLevel =
      memberHighestRole.comparePositionTo(minimumRole) >= 0;

    if (!hasEnoughRoleLevel) {
      return interaction.reply({
        content: "Tu dois avoir au minimum le grade Agents Shlag's pour avoir et utiliser des crédits.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (bet === 'number' && number === null) {
      return interaction.reply({
        content: "Tu dois préciser un numéro entre 0 et 36 pour le pari number.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (bet !== 'number' && number !== null) {
      return interaction.reply({
        content: "L'option number doit être utilisée seulement avec bet = number.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const player = await creditsService.findByDiscordId(
      interaction.user.id,
      interaction.user.tag
    );

    if (!player) {
      return interaction.reply({
        content: "Impossible de trouver ton compte crédits.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (player.credits < amount) {
      return interaction.reply({
        content: `Tu n'as pas assez de crédits. Mise demandée : ${amount}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = await addBetToRound({
      interaction,
      player,
      bet,
      amount,
      number,
      creditsService,
    });

    return interaction.reply({
      content: result.message,
      flags: MessageFlags.Ephemeral,
    });
  },
};