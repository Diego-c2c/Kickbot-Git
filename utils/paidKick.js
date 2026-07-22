const { PermissionFlagsBits } = require('discord.js');

const KICK_COST = 10;

async function performPaidKick({
  buyer,
  buyerUserId,
  target,
  botMember,
  guildOwnerId,
  reason,
  decrementCredits,
}) {
  if (!buyer) {
    return {
      success: false,
      message: "Impossible de trouver ton compte crédits.",
    };
  }

  if (buyer.credits < KICK_COST) {
    return {
      success: false,
      message: `Tu n'as pas assez de crédits. Il faut ${KICK_COST} crédits.`,
    };
  }

  if (!target) {
    return {
      success: false,
      message: "Utilisateur introuvable sur ce serveur.",
    };
  }

  if (target.id === buyerUserId) {
    return {
      success: false,
      message: "Tu ne peux pas te cibler toi-même.",
    };
  }

  if (target.id === guildOwnerId) {
    return {
      success: false,
      message: "Impossible de cibler le propriétaire du serveur.",
    };
  }

  if (!target.voice || !target.voice.channel) {
    return {
      success: false,
      message: "Cet utilisateur n'est pas dans un salon vocal.",
    };
  }

  if (!botMember.permissions.has(PermissionFlagsBits.MoveMembers)) {
    return {
      success: false,
      message: "Le bot n'a pas la permission globale Move Members.",
    };
  }

  const voiceChannel = target.voice.channel;
  const botChannelPermissions = voiceChannel.permissionsFor(botMember);

  if (
    !botChannelPermissions ||
    !botChannelPermissions.has(PermissionFlagsBits.ViewChannel) ||
    !botChannelPermissions.has(PermissionFlagsBits.Connect) ||
    !botChannelPermissions.has(PermissionFlagsBits.MoveMembers)
  ) {
    return {
      success: false,
      message: "Le bot n'a pas les permissions suffisantes dans ce salon vocal.",
    };
  }

  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return {
      success: false,
      message: "Je ne peux pas déconnecter cet utilisateur à cause de la hiérarchie Discord.",
    };
  }

  try {
    console.log('ACTION = DECONNEXION VOCALE UNIQUEMENT');
    console.log('TARGET =', target.user.tag);

    await target.voice.setChannel(null, reason);

    await decrementCredits();

    return {
      success: true,
      message: `${target.user.tag} a été déconnecté du vocal. ${KICK_COST} crédits consommés.`,
    };
  } catch (error) {
    console.error('Erreur paidKick:', error);

    return {
      success: false,
      message: "Impossible de déconnecter cet utilisateur du vocal.",
    };
  }
}

module.exports = { performPaidKick };