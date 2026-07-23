const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

/*
|--------------------------------------------------------------------------
| Réglages généraux du blackjack
|--------------------------------------------------------------------------
*/
const JOIN_WINDOW_MS = 8000; // délai d'inscription après la première mise
const PLAYER_ACTION_MS = 15000; // temps max sans action avant stop auto
const DEALER_HIT_UNTIL = 16; // la banque tire jusqu'à 16 inclus
const NORMAL_PAYOUT_MULTIPLIER = 2; // victoire normale : 2:1
const BLACKJACK_PAYOUT_MULTIPLIER = 2.5; // blackjack naturel : 2.5:1

/*
|--------------------------------------------------------------------------
| Tables actives
| Clé = channelId
|--------------------------------------------------------------------------
*/
const activeTables = new Map();

/*
|--------------------------------------------------------------------------
| Création et manipulation du deck
|--------------------------------------------------------------------------
*/

// Crée un paquet de 52 cartes puis le mélange
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }

  // Mélange Fisher-Yates
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

// Pioche la carte du dessus
function drawCard(deck) {
  return deck.pop();
}

// Formate une carte en texte, ex: A♠
function cardLabel(card) {
  return `${card.rank}${card.suit}`;
}

// Affiche une main, avec possibilité de masquer la 2e carte (banque)
function handToText(hand, hideSecondCard = false) {
  return hand
    .map((card, index) => {
      if (hideSecondCard && index === 1) return '*';
      return cardLabel(card);
    })
    .join(' / ');
}

/*
|--------------------------------------------------------------------------
| Calcul de valeur des cartes / mains
|--------------------------------------------------------------------------
*/

// Valeur brute d'une carte
function getCardValue(card) {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return Number(card.rank);
}

// Valeur optimisée d'une main (As à 11 ou 1 selon besoin)
function getHandValue(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    total += getCardValue(card);
    if (card.rank === 'A') aces += 1;
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

// Blackjack naturel = 2 cartes seulement et total 21
function isBlackjack(hand) {
  return hand.length === 2 && getHandValue(hand) === 21;
}

// Split possible uniquement si les 2 cartes ont le même rang
function canSplit(hand) {
  return hand.length === 2 && hand[0].rank === hand[1].rank;
}

/*
|--------------------------------------------------------------------------
| Helpers joueurs / états
|--------------------------------------------------------------------------
*/

// Retourne la main actuellement jouée du joueur
function getActiveHand(player) {
  return player.hands[player.activeHandIndex];
}

// Indique si le joueur a fini toutes ses mains
function isPlayerDone(player) {
  return player.finished || player.activeHandIndex >= player.hands.length;
}

// Résumé d'un joueur pour affichage dans le message
function buildPlayerSummary(player) {
  return player.hands
    .map((hand, index) => {
      const pointer =
        index === player.activeHandIndex && !player.finished ? '👉 ' : '';
      const total = ` (${getHandValue(hand.cards)})`;
      const status = hand.result ? ` — ${hand.result}` : '';

      return `${pointer}Main ${index + 1} • mise ${hand.bet} • ${handToText(
        hand.cards
      )}${total}${status}`;
    })
    .join('\n');
}

/*
|--------------------------------------------------------------------------
| Construction du message de table
|--------------------------------------------------------------------------
*/

// Construit le texte complet affiché dans Discord
function buildTableMessage(table, options = {}) {
  const { revealDealer = false, extra = '' } = options;
  const lines = [];

  lines.push(`🃏 Blackjack de salon — table de ${table.hostUsername}`);
  lines.push(
    `💰 Paiement victoire : ${NORMAL_PAYOUT_MULTIPLIER}:1 | Blackjack : ${BLACKJACK_PAYOUT_MULTIPLIER}:1`
  );
  lines.push('');

  if (table.phase === 'joining') {
    const remaining = Math.max(
      0,
      Math.ceil((table.joinEndsAt - Date.now()) / 1000)
    );

    lines.push(
      `⏳ Inscriptions ouvertes pendant ${remaining} seconde(s). Rejoignez avec /bj <mise>.`
    );
    lines.push('');
  }

  const dealerCards = revealDealer
    ? `${handToText(table.dealerHand)} (${getHandValue(table.dealerHand)})`
    : handToText(table.dealerHand, true);

  lines.push(`🎩 Banque : ${dealerCards}`);
  lines.push('');
  lines.push('👥 Joueurs :');

  for (const player of table.players) {
    lines.push(`${player.username}`);
    lines.push(buildPlayerSummary(player));
    lines.push('');
  }

  if (extra) {
    lines.push(extra);
  }

  return lines.join('\n').trim();
}

/*
|--------------------------------------------------------------------------
| Boutons d'action
|--------------------------------------------------------------------------
*/

// Construit une ligne de boutons par joueur encore actif
// Limite Discord : 5 lignes max par message
function buildActionRows(table) {
  if (table.phase !== 'playing') return [];

  const rows = [];

  for (const player of table.players) {
    if (isPlayerDone(player)) continue;

    const hand = getActiveHand(player);
    if (!hand) continue;

    const splitAllowed = canSplit(hand.cards) && player.hands.length === 1;

    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bj_hit:${table.channelId}:${player.userId}`)
          .setLabel(`Carte ${player.username}`)
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId(`bj_stand:${table.channelId}:${player.userId}`)
          .setLabel(`Stop ${player.username}`)
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(`bj_split:${table.channelId}:${player.userId}`)
          .setLabel(`Split ${player.username}`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(!splitAllowed)
      )
    );
  }

  return rows.slice(0, 5);
}

// Mise à jour sécurisée du message de table
async function safeEditTable(table, content, revealDealer = false) {
  try {
    await table.tableMessage.edit({
      content: buildTableMessage(table, { revealDealer, extra: content }),
      components: buildActionRows(table),
    });
  } catch (error) {
    console.error('Erreur update blackjack:', error);
  }
}

/*
|--------------------------------------------------------------------------
| Gestion des timeouts par joueur
|--------------------------------------------------------------------------
*/

// Supprime le timer du joueur si présent
function clearPlayerTimer(player) {
  if (player.actionTimeout) {
    clearTimeout(player.actionTimeout);
    player.actionTimeout = null;
  }
}

// Programme le timeout d'un joueur : stop auto après 15 sec
function schedulePlayerTimeout(table, player) {
  clearPlayerTimer(player);

  player.actionTimeout = setTimeout(async () => {
    const liveTable = activeTables.get(table.channelId);
    if (!liveTable) return;

    const livePlayer = liveTable.players.find((p) => p.userId === player.userId);
    if (!livePlayer || isPlayerDone(livePlayer)) return;

    const hand = getActiveHand(livePlayer);
    if (!hand) return;

    hand.stood = true;
    hand.result = hand.result || 'Stop auto';
    livePlayer.activeHandIndex += 1;

    if (livePlayer.activeHandIndex >= livePlayer.hands.length) {
      livePlayer.finished = true;
    }

    await checkRoundCompletion(
      liveTable,
      `⏱️ ${livePlayer.username} n'a pas joué à temps.`
    );
  }, PLAYER_ACTION_MS);
}

// Programme les timeouts de tous les joueurs encore actifs
function scheduleAllPlayerTimeouts(table) {
  for (const player of table.players) {
    if (!isPlayerDone(player)) {
      schedulePlayerTimeout(table, player);
    }
  }
}

/*
|--------------------------------------------------------------------------
| Fin de tour / phase banque
|--------------------------------------------------------------------------
*/

// Vérifie si tous les joueurs ont fini ; si oui, la banque joue
async function checkRoundCompletion(table, extra = '') {
  const everyoneDone = table.players.every((player) => isPlayerDone(player));

  if (!everyoneDone) {
    await safeEditTable(
      table,
      extra || '🃏 La manche continue.'
    );
    return;
  }

  await resolveDealer(table);
}

// La banque révèle sa carte, tire jusqu'à 16, puis on paie
async function resolveDealer(table) {
  table.phase = 'dealer';

  // On nettoie tous les timers joueurs
  for (const player of table.players) {
    clearPlayerTimer(player);
  }

  // La banque tire jusqu'à 16 inclus
  while (getHandValue(table.dealerHand) <= DEALER_HIT_UNTIL) {
    table.dealerHand.push(drawCard(table.deck));
  }

  const dealerValue = getHandValue(table.dealerHand);
  const dealerBust = dealerValue > 21;
  const results = [];

  for (const player of table.players) {
    for (const hand of player.hands) {
      const playerValue = getHandValue(hand.cards);

      // Joueur déjà bust
      if (hand.busted) {
        hand.result = 'Perdu';
        results.push(`❌ ${player.username} perd ${hand.bet} crédit(s).`);
        continue;
      }

      // Blackjack naturel du joueur (et pas de blackjack banque)
      if (isBlackjack(hand.cards) && !isBlackjack(table.dealerHand)) {
        const win = Math.round(hand.bet * BLACKJACK_PAYOUT_MULTIPLIER);

        await table.creditsService.incrementCredits(
          player.userId,
          hand.bet + win,
          player.userTag
        );

        hand.result = `Blackjack gagné +${win}`;
        results.push(
          `🖤 ${player.username} fait Blackjack et gagne ${win} crédit(s).`
        );
        continue;
      }

      // Si la banque bust, tous les joueurs encore vivants gagnent
      if (dealerBust) {
        const win = hand.bet * NORMAL_PAYOUT_MULTIPLIER;

        await table.creditsService.incrementCredits(
          player.userId,
          hand.bet + win,
          player.userTag
        );

        hand.result = `Gagné +${win}`;
        results.push(
          `✅ ${player.username} gagne ${win} crédit(s) (banque bust).`
        );
        continue;
      }

      // Si le joueur bat la banque
      if (playerValue > dealerValue) {
        const win = hand.bet * NORMAL_PAYOUT_MULTIPLIER;

        await table.creditsService.incrementCredits(
          player.userId,
          hand.bet + win,
          player.userTag
        );

        hand.result = `Gagné +${win}`;
        results.push(
          `✅ ${player.username} bat la banque (${playerValue} > ${dealerValue}) et gagne ${win} crédit(s).`
        );
        continue;
      }

      // Egalité = push => on rend juste la mise
      if (playerValue === dealerValue) {
        await table.creditsService.incrementCredits(
          player.userId,
          hand.bet,
          player.userTag
        );

        hand.result = 'Push';
        results.push(
          `➖ ${player.username} fait égalité avec la banque (${playerValue}), mise rendue (${hand.bet}).`
        );
        continue;
      }

      // Sinon la banque bat le joueur
      hand.result = 'Perdu';
      results.push(
        `❌ ${player.username} est battu par la banque (${playerValue} < ${dealerValue}) et perd ${hand.bet} crédit(s).`
      );
    }
  }

  table.phase = 'finished';
  activeTables.delete(table.channelId);

  await safeEditTable(
    table,
    `🏁 Fin de manche. Banque à ${dealerValue}${
      dealerBust ? ' (bust)' : ''
    }.\n\n${results.join('\n')}`,
    true
  );
}

/*
|--------------------------------------------------------------------------
| Démarrage de manche
|--------------------------------------------------------------------------
*/

// Distribue 2 cartes à chaque joueur + 2 à la banque
async function startRound(table) {
  table.phase = 'dealing';

  for (let i = 0; i < 2; i += 1) {
    for (const player of table.players) {
      player.hands[0].cards.push(drawCard(table.deck));
    }
    table.dealerHand.push(drawCard(table.deck));
  }

  table.phase = 'playing';

  // Si un joueur a un blackjack naturel, on le marque fini directement
  for (const player of table.players) {
    const hand = getActiveHand(player);
    if (hand && isBlackjack(hand.cards)) {
      hand.result = 'Blackjack';
      player.finished = true;
      player.activeHandIndex = player.hands.length;
    }
  }

  await safeEditTable(
    table,
    '🂡 Les cartes sont distribuées. Chaque joueur peut jouer sa main.'
  );

  scheduleAllPlayerTimeouts(table);
  await checkRoundCompletion(table);
}

/*
|--------------------------------------------------------------------------
| Création / entrée dans une table
|--------------------------------------------------------------------------
*/

// Lance une table ou rejoint une table déjà ouverte
async function createOrJoinTable({ interaction, amount, creditsService }) {
  const channel = interaction.channel;
  const channelId = channel.id;
  let table = activeTables.get(channelId);

  const playerAccount = await creditsService.findByDiscordId(
    interaction.user.id,
    interaction.user.tag
  );

  if (playerAccount.credits < amount) {
    return {
      ok: false,
      message: `Tu n'as pas assez de crédits. Mise demandée : ${amount}.`,
    };
  }

  // Création d'une nouvelle table
  if (!table) {
    await creditsService.decrementCredits(interaction.user.id, amount);

    const starter = {
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      username: interaction.user.username,
      hands: [
        {
          cards: [],
          bet: amount,
          stood: false,
          busted: false,
          result: null,
        },
      ],
      activeHandIndex: 0,
      finished: false,
      actionTimeout: null,
    };

    let tableMessage;

    try {
      tableMessage = await channel.send(
        '🃏 Création de la table de blackjack...'
      );
    } catch (error) {
      await creditsService.incrementCredits(
        interaction.user.id,
        amount,
        interaction.user.tag
      );

      return {
        ok: false,
        message:
          "Je n'ai pas accès à ce salon pour lancer la table de blackjack.",
      };
    }

    table = {
      channelId,
      hostId: interaction.user.id,
      hostUsername: interaction.user.username,
      players: [starter],
      deck: createDeck(),
      dealerHand: [],
      phase: 'joining',
      joinEndsAt: Date.now() + JOIN_WINDOW_MS,
      joinTimeout: null,
      tableMessage,
      creditsService,
    };

    activeTables.set(channelId, table);

    await safeEditTable(
      table,
      `✅ ${interaction.user.username} rejoint la table avec ${amount} crédit(s).`
    );

    table.joinTimeout = setTimeout(async () => {
      const liveTable = activeTables.get(channelId);
      if (!liveTable) return;
      await startRound(liveTable);
    }, JOIN_WINDOW_MS);

    return {
      ok: true,
      message: `Table créée avec une mise de ${amount} crédit(s). Les autres ont 8 secondes pour rejoindre.`,
    };
  }

  // Une table existe déjà mais n'accepte plus de joueurs
  if (table.phase !== 'joining') {
    return {
      ok: false,
      message: 'Une manche est déjà en cours dans ce salon. Attends la fin pour rejouer.',
    };
  }

  // Empêche le double join
  if (table.players.some((entry) => entry.userId === interaction.user.id)) {
    return {
      ok: false,
      message: 'Tu es déjà inscrit à cette table de blackjack.',
    };
  }

  // Débit de la mise pour le nouveau joueur
  await creditsService.decrementCredits(interaction.user.id, amount);

  table.players.push({
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    username: interaction.user.username,
    hands: [
      {
        cards: [],
        bet: amount,
        stood: false,
        busted: false,
        result: null,
      },
    ],
    activeHandIndex: 0,
    finished: false,
    actionTimeout: null,
  });

  await safeEditTable(
    table,
    `➕ ${interaction.user.username} rejoint la table avec ${amount} crédit(s).`
  );

  return {
    ok: true,
    message: `Tu rejoins la table avec ${amount} crédit(s).`,
  };
}

/*
|--------------------------------------------------------------------------
| Gestion des boutons Discord
|--------------------------------------------------------------------------
*/

// Gère Carte / Stop / Split
async function handleBlackjackButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('bj_')) return false;

  // On confirme immédiatement le clic pour éviter "KickBot n'a pas répondu à temps"
  await interaction.deferUpdate();

  const parts = interaction.customId.split(':');
  const action = parts[0]; // bj_hit / bj_stand / bj_split
  const channelId = parts[1];
  const playerId = parts[2];

  const table = activeTables.get(channelId);
  if (!table) return true;

  const player = table.players.find((p) => p.userId === playerId);
  if (!player) return true;

  // Seul le joueur propriétaire des boutons peut jouer sa main
  if (interaction.user.id !== playerId) {
    return true;
  }

  if (isPlayerDone(player)) {
    return true;
  }

  const hand = getActiveHand(player);
  if (!hand) return true;

  clearPlayerTimer(player);

  /*
  |--------------------------------------------------------------------------
  | Action : CARTE
  |--------------------------------------------------------------------------
  */
  if (action === 'bj_hit') {
    hand.cards.push(drawCard(table.deck));
    const value = getHandValue(hand.cards);

    // Si le joueur bust, on termine sa main
    if (value > 21) {
      hand.busted = true;
      hand.result = `Bust (${value})`;
      player.activeHandIndex += 1;

      if (player.activeHandIndex >= player.hands.length) {
        player.finished = true;
      }

      await checkRoundCompletion(table, `💥 ${player.username} bust à ${value}.`);
      return true;
    }

    // Sinon il peut encore jouer, on relance son timer
    schedulePlayerTimeout(table, player);

    await safeEditTable(
      table,
      `🃏 ${player.username} tire une carte.`
    );

    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Action : STOP
  |--------------------------------------------------------------------------
  */
  if (action === 'bj_stand') {
    hand.stood = true;
    hand.result = 'Stop';
    player.activeHandIndex += 1;

    if (player.activeHandIndex >= player.hands.length) {
      player.finished = true;
    }

    await checkRoundCompletion(table, `✋ ${player.username} reste.`);
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Action : SPLIT
  |--------------------------------------------------------------------------
  */
  if (action === 'bj_split') {
    // Split impossible
    if (!canSplit(hand.cards) || player.hands.length > 1) {
      schedulePlayerTimeout(table, player);
      await safeEditTable(
        table,
        `⚠️ Split impossible pour ${player.username}.`
      );
      return true;
    }

    // Vérifie si le joueur a assez de crédits pour doubler sa mise
    const balance = await table.creditsService.getBalance(
      player.userId,
      player.userTag
    );

    if (balance.credits < hand.bet) {
      schedulePlayerTimeout(table, player);
      await safeEditTable(
        table,
        `⚠️ ${player.username} n'a pas assez de crédits pour split.`
      );
      return true;
    }

    // Débite une deuxième mise
    await table.creditsService.decrementCredits(player.userId, hand.bet);

    // Sépare les deux cartes en deux mains
    const movedCard = hand.cards.pop();

    const secondHand = {
      cards: [movedCard],
      bet: hand.bet,
      stood: false,
      busted: false,
      result: null,
    };

    // Donne une nouvelle carte à chaque main
    hand.cards.push(drawCard(table.deck));
    secondHand.cards.push(drawCard(table.deck));

    player.hands.push(secondHand);

    // Le joueur continue de jouer sa main active
    schedulePlayerTimeout(table, player);

    await safeEditTable(
      table,
      `✂️ ${player.username} split sa main.`
    );

    return true;
  }

  return true;
}

module.exports = {
  createOrJoinTable,
  handleBlackjackButton,
};