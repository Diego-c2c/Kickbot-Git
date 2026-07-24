const { PermissionFlagsBits } = require('discord.js');
const creditsService = require('../services/credits.service');

/*
|--------------------------------------------------------------------------
| Règles générales de la commande /deco
|--------------------------------------------------------------------------
|
| - 1 à 5 /deco dans le mois calendaire  : 10 crédits
| - 6 à 10 /deco dans le mois            : 25 crédits
| - 11 à 15 /deco dans le mois           : 50 crédits
| - puis tous les 5 /deco, le prix double
|
| Anti-spam :
| - impossible de déconnecter plus de 10 fois la même cible
|   sur une fenêtre glissante de 15 minutes
|--------------------------------------------------------------------------
*/

// Coût de base des 5 premières utilisations mensuelles
const BASE_KICK_COST = 10;

// Nombre maximum de décos sur la même cible dans la fenêtre
const MAX_TARGET_KICKS_PER_WINDOW = 12;

// Fenêtre de limitation anti-spam : 15 minutes
const TARGET_KICK_WINDOW_MS = 15 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| Stockage temporaire en mémoire
|--------------------------------------------------------------------------
|
| buyerMonthlyUsage :
|   Suit le nombre de /deco achetés par chaque utilisateur
|   pendant le mois calendaire courant.
|
|   Structure :
|   Map<buyerId, { monthKey: "YYYY-MM", count: number }>
|
| targetKickHistory :
|   Suit l'historique récent des décos subies par une cible.
|
|   Structure :
|   Map<targetId, number[]>
|   où number[] = timestamps Date.now()
|
| IMPORTANT :
|   Comme c'est un stockage en mémoire, tout sera remis à zéro
|   si le bot redémarre. Pour rendre cela persistant, il faudrait
|   stocker ces données en base ou dans un fichier. [web:1084]
|--------------------------------------------------------------------------
*/
const buyerMonthlyUsage = new Map();
const targetKickHistory = new Map();

/*
|--------------------------------------------------------------------------
| Helpers calendrier / coût progressif
|--------------------------------------------------------------------------
*/

// Retourne la clé du mois calendaire courant, ex: "2026-07"
function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/*
|--------------------------------------------------------------------------
| Calcule le prix du prochain /deco
|--------------------------------------------------------------------------
|
| Règle demandée :
| - utilisations 1 à 5   => 10 crédits
| - utilisations 6 à 10  => 25 crédits
| - utilisations 11 à 15 => 50 crédits
| - utilisations 16 à 20 => 100 crédits
| - etc.
|
| Paramètre :
| - usedThisMonth = nombre de /deco déjà consommés ce mois-ci
|
| Exemple :
| - usedThisMonth = 0  => prochain coût = 10
| - usedThisMonth = 5  => prochain coût = 25
| - usedThisMonth = 10 => prochain coût = 50
|--------------------------------------------------------------------------
*/
function getMonthlyKickCost(usedThisMonth) {
  const nextUsageIndex = usedThisMonth + 1;

  // Les 5 premières utilisations coûtent le tarif de base
  if (nextUsageIndex <= 5) {
    return BASE_KICK_COST;
  }

  // A partir de la 6e utilisation :
  // 6-10 => tier 1 => 25
  // 11-15 => tier 2 => 50
  // 16-20 => tier 3 => 100
  const tier = Math.ceil((nextUsageIndex - 5) / 5);

  return 25 * Math.pow(2, tier - 1);
}

/*
|--------------------------------------------------------------------------
| Retourne l'entrée mensuelle d'un acheteur
|--------------------------------------------------------------------------
|
| Si l'utilisateur n'a pas encore d'entrée ce mois-ci, on la crée.
| Si le mois a changé, on remet son compteur à zéro pour le nouveau mois.
|--------------------------------------------------------------------------
*/
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

/*
|--------------------------------------------------------------------------
| Incrémente le compteur mensuel d'un acheteur après succès
|--------------------------------------------------------------------------
*/
function incrementBuyerMonthlyUsage(buyerId) {
  const entry = getBuyerMonthEntry(buyerId);
  entry.count += 1;
  buyerMonthlyUsage.set(buyerId, entry);
}

/*
|--------------------------------------------------------------------------
| Helpers anti-spam sur la cible
|--------------------------------------------------------------------------
*/

// Récupère l'historique récent d'une cible
// et supprime automatiquement les timestamps trop anciens
function getTargetHistory(targetId) {
  const now = Date.now();
  const existing = targetKickHistory.get(targetId) || [];

  // On ne conserve que les décos des 15 dernières minutes
  const filtered = existing.filter(
    (timestamp) => now - timestamp <= TARGET_KICK_WINDOW_MS
  );

  targetKickHistory.set(targetId, filtered);
  return filtered;
}

// Retourne true si la cible a déjà atteint la limite autorisée
function isTargetRateLimited(targetId) {
  const history = getTargetHistory(targetId);
  return history.length >= MAX_TARGET_KICKS_PER_WINDOW;
}

// Enregistre une nouvelle déco réussie sur la cible
function registerTargetKick(targetId) {
  const history = getTargetHistory(targetId);
  history.push(Date.now());
  targetKickHistory.set(targetId, history);
}

/*
|--------------------------------------------------------------------------
| Logique principale : /deco payant
|--------------------------------------------------------------------------
|
| Cette fonction :
| 1. récupère l'acheteur
| 2. calcule le coût mensuel actuel
| 3. vérifie les crédits
| 4. vérifie la limite anti-spam sur la cible
| 5. vérifie que la cible est en vocal
| 6. vérifie les permissions du bot
| 7. vérifie la hiérarchie Discord
| 8. débite les crédits
| 9. déconnecte la cible du vocal
| 10. enregistre l'usage mensuel + l'historique cible
| 11. rembourse si l'action échoue
|--------------------------------------------------------------------------
*/
async function performPaidKick({ interaction, target, reason }) {
  const buyerId = interaction.user.id;
  const buyerTag = interaction.user.tag;

  // Récupère ou crée le compte crédits de l'acheteur
  const buyer = await creditsService.findByDiscordId(buyerId, buyerTag);

  // Calcule le coût actuel en fonction du nombre de /deco déjà faits ce mois-ci
  const buyerMonthEntry = getBuyerMonthEntry(buyerId);
  const currentCost = getMonthlyKickCost(buyerMonthEntry.count);

  // Vérifie si l'utilisateur a assez de crédits
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

  // La cible doit être dans un salon vocal
  if (!target.voice || !target.voice.channel) {
    return {
      ok: false,
      message: "Cet utilisateur n'est pas connecté à un salon vocal.",
    };
  }

  const guild = interaction.guild;
  const botMember = guild.members.me;

  // Vérifie que le bot est bien récupérable comme membre du serveur
  if (!botMember) {
    return {
      ok: false,
      message: "Impossible de récupérer le membre du bot.",
    };
  }

  const voiceChannel = target.voice.channel;
  const botChannelPermissions = voiceChannel.permissionsFor(botMember);

  /*
  |--------------------------------------------------------------------------
  | Vérification permission Move Members
  |--------------------------------------------------------------------------
  |
  | Pour pouvoir déconnecter / déplacer quelqu'un d'un vocal,
  | le bot doit disposer de la permission adéquate dans le salon.
  | Discord associe généralement cette capacité à Move Members. [web:1070]
  |--------------------------------------------------------------------------
  */
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

  /*
  |--------------------------------------------------------------------------
  | Vérification hiérarchie Discord
  |--------------------------------------------------------------------------
  |
  | Même avec la permission, le bot ne peut pas agir sur un membre
  | ayant un rôle supérieur ou égal au sien.
  |--------------------------------------------------------------------------
  */
  if (target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) {
    return {
      ok: false,
      message:
        "Je ne peux pas déconnecter cet utilisateur à cause de la hiérarchie Discord.",
    };
  }

  try {
    /*
    |--------------------------------------------------------------------------
    | Débit avant action
    |--------------------------------------------------------------------------
    |
    | On retire les crédits avant la déconnexion.
    | Si l'action échoue ensuite, on rembourse dans le catch.
    |--------------------------------------------------------------------------
    */
    await creditsService.decrementCredits(buyerId, currentCost);

    /*
    |--------------------------------------------------------------------------
    | Déconnexion vocale
    |--------------------------------------------------------------------------
    |
    | setChannel(null) déconnecte le membre de son salon vocal. [web:1066]
    |--------------------------------------------------------------------------
    */
    await target.voice.setChannel(null, reason);

    // Enregistre l'utilisation mensuelle réussie
    incrementBuyerMonthlyUsage(buyerId);

    // Enregistre la déco réussie sur la cible pour l'anti-spam
    registerTargetKick(target.id);

    // Recharge le solde après débit
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

    /*
    |--------------------------------------------------------------------------
    | Remboursement si échec
    |--------------------------------------------------------------------------
    |
    | Si la déconnexion a échoué après le débit,
    | on rend les crédits à l'acheteur.
    |--------------------------------------------------------------------------
    */
    await creditsService.incrementCredits(buyerId, currentCost, buyerTag);

    return {
      ok: false,
      message: "Impossible de déconnecter cet utilisateur du vocal.",
    };
  }
}

module.exports = { performPaidKick };