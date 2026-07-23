const { PermissionFlagsBits } = require('discord.js');
const creditsService = require('../services/credits.service');

const BASE_KICK_COST = 10;
const MAX_TARGET_KICKS_PER_WINDOW = 10;
const TARGET_KICK_WINDOW_MS = 15 * 60 * 1000;

const buyerMonthlyUsage = new Map();
const targetKickHistory = new Map();

function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthlyKickCost(usedThisMonth) {
  const nextUsageIndex = usedThisMonth + 1;

  if (nextUsageIndex <= 5) return 10;

  const tier = Math.ceil((nextUsageIndex - 5) / 5);
  return 25 * Math.pow(2, tier - 1);
}

function getBuyerMonthEntry(buyerId) {
  const monthKey = getCurrentMonthKey();
  const existing = buyerMonthlyUsage.get(buyerId);

  if (!existing || existing.monthKey !== monthKey) {
    const fresh = { monthKey, count: 0 };
    buyerMonthlyUsage.set(buyerId, fresh);
    return fresh;
  }

  return existing;
}

function incrementBuyerMonthlyUsage(buyerId) {
  const entry = getBuyerMonthEntry(buyerId);
  entry.count += 1;
  buyerMonthlyUsage.set(buyerId, entry);
}

function getTargetHistory(targetId) {
  const now = Date.now();
  const existing = targetKickHistory.get(targetId) || [];

  const filtered = existing.filter(
    (timestamp) => now - timestamp <= TARGET_KICK_WINDOW_MS
  );

  targetKickHistory.set(targetId, filtered);
  return filtered;
}

function isTargetRateLimited(targetId) {
  const history = getTargetHistory(targetId);
  return history.length >= MAX_TARGET_KICKS_PER_WINDOW;
}

function registerTargetKick(targetId) {
  const history = getTargetHistory(targetId);
  history.push(Date.now());
  targetKickHistory.set(targetId, history);
}

async function performPaidKick({ interaction, target, reason }) {
  const buyerId = interaction.user.id;
  const buyerTag = interaction.user.tag;
  const buyer = await creditsService.findByDiscordId(buyerId, buyerTag);

  const buyerMonthEntry = getBuyerMonthEntry(buyerId);
  const currentCost = getMonthlyKickCost(buyerMonthEntry.count);

  if (buyer.credits < currentCost) {
    return {
      ok: false,
      message: `Tu n'as pas assez de crédits. Il faut ${currentCost} crédits.`,
    };
  }

  if (isTargetRateLimited(target.id)) {
    return {
      ok: false,
      message:
        "Cette cible a déjà été déconnectée 10 fois sur les 15 dernières minutes. Réessaie plus tard.",
    };
  }

  if (!target.voice || !target.voice.channel) {
    return {
      ok: false,
      message: "Cet utilisateur n'est pas connecté à un salon vocal.",
    };
  }

  const guild = interaction.guild;
  const botMember = guild.members.me;

  if (!botMember) {
    return {
      ok: false,
      message: "Impossible de récupérer le membre du bot.",
    };
  }

  const voiceChannel = target.voice.channel;
  const botChannelPermissions = voiceChannel.permissionsFor(botMember);

  if (
    !botChannelPermissions ||
    !botChannelPermissions.has(PermissionFlagsBits.MoveMembers)
  ) {
    return {
      ok: false,
      message:
        "Je n'ai pas la permission Move Members pour déconnecter quelqu'un de ce salon vocal.",
    };
  }

  if (target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) {
    return {
      ok: false,
      message:
        "Je ne peux pas déconnecter cet utilisateur à cause de la hiérarchie Discord.",
    };
  }

  try {
    await creditsService.decrementCredits(buyerId, currentCost);
    await target.voice.setChannel(null, reason);

    incrementBuyerMonthlyUsage(buyerId);
    registerTargetKick(target.id);

    const updatedBuyer = await creditsService.getBalance(buyerId, buyerTag);

    return {
      ok: true,
      message:
        `${target.user.tag} a été déconnecté du vocal. ` +
        `${currentCost} crédit(s) consommé(s). ` +
        `Solde restant : ${updatedBuyer.credits}.`,
    };
  } catch (error) {
    console.error('Erreur paidKick:', error);

    await creditsService.incrementCredits(buyerId, currentCost, buyerTag);

    return {
      ok: false,
      message: "Impossible de déconnecter cet utilisateur du vocal.",
    };
  }
}

module.exports = { performPaidKick };