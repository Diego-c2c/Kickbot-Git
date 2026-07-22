// Petit stockage temporaire en mémoire
// Attention : tout est perdu quand le bot redémarre
const fakeStore = new Map();

// Crée un utilisateur en mémoire s'il n'existe pas encore
function seedUser(discordId, credits = 50, discordTag = null) {
  if (!fakeStore.has(discordId)) {
    fakeStore.set(discordId, {
      discordId,
      discordTag,
      credits,
    });
  }

  return fakeStore.get(discordId);
}

// Récupère un utilisateur par son ID Discord
// S'il n'existe pas encore, on le crée avec 50 crédits par défaut
async function findByDiscordId(discordId, discordTag = null) {
  return seedUser(discordId, 50, discordTag);
}

// Retire des crédits à un utilisateur
async function decrementCredits(discordId, amount = 1) {
  const user = fakeStore.get(discordId);
  if (!user) return null;

  user.credits = Math.max(0, user.credits - amount);
  fakeStore.set(discordId, user);

  return user;
}

// Ajoute des crédits à un utilisateur
// S'il n'existe pas encore, on le crée avec 50 crédits par défaut
async function incrementCredits(discordId, amount = 1, discordTag = null) {
  const user = seedUser(discordId, 50, discordTag);

  user.credits += amount;
  fakeStore.set(discordId, user);

  return user;
}

// Renvoie le solde actuel d'un utilisateur
async function getBalance(discordId, discordTag = null) {
  return seedUser(discordId, 50, discordTag);
}

module.exports = {
  findByDiscordId,
  decrementCredits,
  incrementCredits,
  getBalance,
};