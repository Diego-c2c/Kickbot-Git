const creditsService = require('../services/credits.service');

/*
|--------------------------------------------------------------------------
| Règles /deco
|--------------------------------------------------------------------------
*/

// Coût de base des 5 premières décos du mois
const BASE_KICK_COST = 10;

// Nombre max de décos sur la même cible dans une fenêtre glissante
const MAX_TARGET_KICKS_PER_WINDOW = 10;

// Fenêtre anti-spam : 15 minutes
const TARGET_KICK_WINDOW_MS = 15 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| Historique en mémoire
|--------------------------------------------------------------------------
|
| buyerMonthlyUsage :
|   suit combien de /deco un utilisateur a acheté dans le mois calendaire
|
| targetKickHistory :
|   suit combien de fois une cible a été déco dans les 15 dernières minutes
|--------------------------------------------------------------------------
*/

const buyerMonthlyUsage = new Map();
const targetKickHistory = new Map();

/*
|--------------------------------------------------------------------------
| Helpers calendrier / coûts
|--------------------------------------------------------------------------
*/

// Retourne la clé du mois calendaire courant, ex: "2026-07"
function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// Calcule le coût selon le nombre de /deco déjà utilisés ce mois-ci
// 1 à 5  => 10
// 6 à 10 => 25
// 11 à 15 => 50
// 16 à 20 => 100
// etc.
function getMonthlyKickCost(usedThisMonth) {
  const nextUsageIndex = usedThisMonth + 1;

  if (nextUsageIndex <= 5) {
    return 10;
  }

  const tier = Math.ceil((nextUsageIndex - 5) / 5);

  return 25 * Math.pow(2, tier - 1);
}

// Récupère ou initialise le suivi mensuel d'un acheteur
function getBuyerMonthEntry(buyerId) {
  const monthKey = getCurrentMonthKey();
  const existing = buyerMonthlyUsage.get(buyerId);

  if (!existing || existing.monthKey !== monthKey) {
    const fresh = {
      monthKey,
      count: 0,
    };
    buyerMonthlyUsage.set(buyerId, fresh);
    return fresh;
  }

  return existing;
}

// Incrémente le compteur mensuel après succès
function incrementBuyerMonthlyUsage(buyerId) {
  const entry = getBuyerMonthEntry(buyerId);
  entry.count += 1;
  buyerMonthlyUsage.set(buyerId, entry);
}

/*
|--------------------------------------------------------------------------
| Helpers anti-spam cible
|--------------------------------------------------------------------------
*/

// Retourne le tableau d'horodatages de déco pour une cible
function getTargetHistory(targetId) {
  const now = Date.now();
  const existing = targetKickHistory.get(targetId) || [];

  // On ne garde que les décos des 15 dernières minutes
  const filtered = existing.filter(
    (timestamp) => now - timestamp <= TARGET_KICK_WINDOW_MS
  );

  targetKickHistory.set(targetId, filtered);
  return filtered;
}

// Vérifie si la cible a atteint la limite
function isTargetRateLimited(targetId) {
  const history = getTargetHistory(targetId);
  return history.length >= MAX_TARGET_KICKS_PER_WINDOW;
}

// Enregistre une déco sur la cible
function registerTargetKick(targetId) {
  const history = getTargetHistory(targetId);
  history.push(Date.now());
  targetKickHistory.set(targetId, history);
}

/*
|--------------------------------------------------------------------------
| Logique principale /deco
|--------------------------------------------------------------------------
*/

async function performPaidKick({
  interaction,
  target,
  reason,
}) {
  const buyerId = interaction.user.id;
  const buyerTag = interaction.user.tag;
  const buyer = await creditsService.findByDiscordId(buyerId, buyerTag);

  // Calcule le coût actuel pour l'acheteur ce mois-ci
  const buyerMonthEntry = getBuyerMonthEntry(buyerId);
  const currentCost = getMonthlyKickCost(buyerMonthEntry.count);

  // Vérifie les crédits
  if (buyer.credits < currentCost) {
    return {
      ok: false,
      message: `Tu n'as pas assez de crédits. Il faut ${currentCost} crédits.`,
    };
  }

  // Vérifie la limite anti-spam sur la cible
  if (isTargetRateLimited(target.id)) {
    return {
      ok: false,
      message:
        "Cette cible a déjà été déconnectée 10 fois sur les 15 dernières minutes. Réessaie plus tard.",
    };
  }

  // La cible doit être connectée dans un salon vocal
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
      message: "Impossible de récupérer les permissions du bot.",
    };
  }

  const voiceChannel = target.voice.channel;
  const botChannelPermissions = voiceChannel.permissionsFor(botMember);

  if (!botChannelPermissions || !botChannelPermissions.has('MoveMembers')) {
    return {
      ok: false,
      message:
        "Je n'ai pas la permission de déconnecter des membres de ce salon vocal.",
    };
  }

  // Vérifie la hiérarchie Discord
  if (target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) {
    return {
      ok: false,
      message:
        "Je ne peux pas déconnecter cet utilisateur à cause de la hiérarchie Discord.",
    };
  }

  try {
    // Débit AVANT action
    await creditsService.decrementCredits(buyerId, currentCost);

    // Déconnexion vocale
    await target.voice.setChannel(null, reason);

    // Enregistre l'achat mensuel et la déco cible
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

    // Remboursement si l'action a échoué après débit
    await creditsService.incrementCredits(buyerId, currentCost, buyerTag);

    return {
      ok: false,
      message: "Impossible de déconnecter cet utilisateur du vocal.",
    };
  }
}

module.exports = { performPaidKick };