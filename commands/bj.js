const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const JOIN_WINDOW_MS = 8000;
const PLAYER_ACTION_MS = 15000;
const DEALER_HIT_UNTIL = 16;
const NORMAL_PAYOUT_MULTIPLIER = 2;
const BLACKJACK_PAYOUT_MULTIPLIER = 2.5;

const activeTables = new Map();

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function drawCard(deck) {
  return deck.pop();
}

function cardLabel(card) {
  return `${card.rank}${card.suit}`;
}

function handToText(hand, hideSecondCard = false) {
  return hand
    .map((card, index) => {
      if (hideSecondCard && index === 1) return '*';
      return cardLabel(card);
    })
    .join(' / ');
}

function getCardValue(card) {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return Number(card.rank);
}

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

function isBlackjack(hand) {
  return hand.length === 2 && getHandValue(hand) === 21;
}

function canSplit(hand) {
  return hand.length === 2 && hand[0].rank === hand[1].rank;
}

function getActiveHand(player) {
  return player.hands[player.activeHandIndex];
}

function isPlayerDone(player) {
  return player.finished || player.activeHandIndex >= player.hands.length;
}

function buildPlayerSummary(player) {
  return player.hands
    .map((hand, index) => {
      const current = index === player.activeHandIndex && !player.finished ? '👉 ' : '';
      const total = ` (${getHandValue(hand.cards)})`;
      const state = hand.result ? ` — ${hand.result}` : '';
      return `${current}Main ${index + 1} • mise ${hand.bet} • ${handToText(hand.cards)}${total}${state}`;
    })
    .join('\n');
}

function buildTableMessage(table, options = {}) {
  const { revealDealer = false, extra = '' } = options;
  const lines = [];

  lines.push(`🃏 Blackjack de salon — table de ${table.hostUsername}`);
  lines.push(`💰 Paiement victoire : ${NORMAL_PAYOUT_MULTIPLIER}:1 | Blackjack : ${BLACKJACK_PAYOUT_MULTIPLIER}:1`);
  lines.push('');

  if (table.phase === 'joining') {
    const remaining = Math.max(0, Math.ceil((table.joinEndsAt - Date.now()) / 1000));
    lines.push(`⏳ Inscriptions ouvertes pendant ${remaining} seconde(s). Rejoignez avec /bj <mise>.`);
    lines.push('');
  }

  const dealerText = revealDealer
    ? `${handToText(table.dealerHand)} (${getHandValue(table.dealerHand)})`
    : handToText(table.dealerHand, true);

  lines.push(`🎩 Banque : ${dealerText}`);
  lines.push('');
  lines.push('👥 Joueurs :');

  for (const player of table.players) {
    lines.push(`${player.username}`);
    lines.push(buildPlayerSummary(player));
    lines.push('');
  }

  if (extra) lines.push(extra);

  return lines.join('\n').trim();
}

function buildActionRows(table) {
  if (table.phase !== 'playing') return [];

  const rows = [];

  for (const player of table.players) {
    if (isPlayerDone(player)) continue;

    const hand = getActiveHand(player);
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

function clearPlayerTimer(player) {
  if (player.actionTimeout) {
    clearTimeout(player.actionTimeout);
    player.actionTimeout = null;
  }
}

function schedulePlayerTimeout(table, player) {
  clearPlayerTimer(player);

  player.actionTimeout = setTimeout(async () => {
    const liveTable = activeTables.get(table.channelId);
    if (!liveTable) return;

    const livePlayer = liveTable.players.find((p) => p.userId === player.userId);
    if (!livePlayer || isPlayerDone(livePlayer)) return;

    const hand = getActiveHand(livePlayer);
    hand.stood = true;
    hand.result = hand.result || 'Stop auto';
    livePlayer.activeHandIndex += 1;

    if (livePlayer.activeHandIndex >= livePlayer.hands.length) {
      livePlayer.finished = true;
    }

    await checkRoundCompletion(liveTable, `⏱️ ${livePlayer.username} n'a pas joué à temps.`);
  }, PLAYER_ACTION_MS);
}

function scheduleAllPlayerTimeouts(table) {
  for (const player of table.players) {
    if (!isPlayerDone(player)) {
      schedulePlayerTimeout(table, player);
    }
  }
}

async function checkRoundCompletion(table, extra = '') {
  const everyoneDone = table.players.every((player) => isPlayerDone(player));

  if (!everyoneDone) {
    await safeEditTable(
      table,
      extra || '🃏 Chaque joueur peut maintenant jouer librement : Carte / Stop / Split.'
    );
    return;
  }

  await resolveDealer(table);
}

async function resolveDealer(table) {
  table.phase = 'dealer';

  for (const player of table.players) {
    clearPlayerTimer(player);
  }

  while (getHandValue(table.dealerHand) <= DEALER_HIT_UNTIL) {
    table.dealerHand.push(drawCard(table.deck));
  }

  const dealerValue = getHandValue(table.dealerHand);
  const dealerBust = dealerValue > 21;
  const results = [];

  for (const player of table.players) {
    for (const hand of player.hands) {
      const playerValue = getHandValue(hand.cards);

      if (hand.busted) {
        hand.result = 'Perdu';
        results.push(`❌ ${player.username} perd ${hand.bet} crédit(s).`);
        continue;
      }

      if (isBlackjack(hand.cards) && !isBlackjack(table.dealerHand)) {
        const win = Math.round(hand.bet * BLACKJACK_PAYOUT_MULTIPLIER);
        await table.creditsService.incrementCredits(
          player.userId,
          hand.bet + win,
          player.userTag
        );
        hand.result = `Blackjack gagné +${win}`;
        results.push(`🖤 ${player.username} fait Blackjack et gagne ${win} crédit(s).`);
        continue;
      }

      if (dealerBust || playerValue > dealerValue) {
        const win = hand.bet * NORMAL_PAYOUT_MULTIPLIER;
        await table.creditsService.incrementCredits(
          player.userId,
          hand.bet + win,
          player.userTag
        );
        hand.result = `Gagné +${win}`;
        results.push(`✅ ${player.username} gagne ${win} crédit(s).`);
        continue;
      }

      if (playerValue === dealerValue) {
        await table.creditsService.incrementCredits(
          player.userId,
          hand.bet,
          player.userTag
        );
        hand.result = 'Push';
        results.push(`➖ ${player.username} récupère sa mise (${hand.bet}).`);
        continue;
      }

      hand.result = 'Perdu';
      results.push(`❌ ${player.username} perd ${hand.bet} crédit(s).`);
    }
  }

  table.phase = 'finished';
  activeTables.delete(table.channelId);

  await safeEditTable(
    table,
    `🏁 Fin de manche. Banque à ${dealerValue}${dealerBust ? ' (bust)' : ''}.\n\n${results.join('\n')}`,
    true
  );
}

async function startRound(table) {
  table.phase = 'dealing';

  for (let i = 0; i < 2; i += 1) {
    for (const player of table.players) {
      player.hands[0].cards.push(drawCard(table.deck));
    }
    table.dealerHand.push(drawCard(table.deck));
  }

  table.phase = 'playing';

  for (const player of table.players) {
    const hand = getActiveHand(player);
    if (isBlackjack(hand.cards)) {
      hand.result = 'Blackjack';
      player.finished = true;
      player.activeHandIndex = player.hands.length;
    }
  }

  await safeEditTable(
    table,
    '🂡 Les cartes sont distribuées. Chaque joueur peut jouer sa main librement pendant 15 secondes.'
  );

  scheduleAllPlayerTimeouts(table);
  await checkRoundCompletion(table);
}

async function createOrJoinTable({ interaction, amount, creditsService }) {
  const channel = interaction.channel;
  const channelId = channel.id;
  let table = activeTables.get(channelId);

  const player = await creditsService.findByDiscordId(
    interaction.user.id,
    interaction.user.tag
  );

  if (player.credits < amount) {
    return {
      ok: false,
      message: `Tu n'as pas assez de crédits. Mise demandée : ${amount}.`,
    };
  }

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
      tableMessage = await channel.send('🃏 Création de la table de blackjack...');
    } catch (error) {
      await creditsService.incrementCredits(
        interaction.user.id,
        amount,
        interaction.user.tag
      );
      return {
        ok: false,
        message: "Je n'ai pas accès à ce salon pour lancer la table de blackjack.",
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

  if (table.phase !== 'joining') {
    return {
      ok: false,
      message: 'Une manche est déjà en cours dans ce salon. Attends la fin pour rejouer.',
    };
  }

  if (table.players.some((entry) => entry.userId === interaction.user.id)) {
    return {
      ok: false,
      message: 'Tu es déjà inscrit à cette table de blackjack.',
    };
  }

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

async function handleBlackjackButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('bj_')) return false;

  await interaction.deferUpdate();

  const [, action, channelId, playerId] = interaction.customId.match(/bj_(hit|stand|split):(.*?):(.*)/) || [];

  const table = activeTables.get(channelId);

  if (!table) {
    return true;
  }

  const player = table.players.find((p) => p.userId === playerId);
  if (!player || isPlayerDone(player)) {
    await safeEditTable(table, 'ℹ️ Cette action n’est plus disponible.');
    return true;
  }

  if (interaction.user.id !== playerId) {
    return true;
  }

  const hand = getActiveHand(player);
  if (!hand) return true;

  clearPlayerTimer(player);

  if (action === 'hit') {
    hand.cards.push(drawCard(table.deck));
    const value = getHandValue(hand.cards);

    if (value > 21) {
      hand.busted = true;
      hand.result = 'Bust';
      player.activeHandIndex += 1;
      if (player.activeHandIndex >= player.hands.length) {
        player.finished = true;
      }
    }

    if (!player.finished) {
      schedulePlayerTimeout(table, player);
    }

    await checkRoundCompletion(table, `🃏 ${player.username} tire une carte.`);
    return true;
  }

  if (action === 'stand') {
    hand.stood = true;
    hand.result = 'Stop';
    player.activeHandIndex += 1;

    if (player.activeHandIndex >= player.hands.length) {
      player.finished = true;
    }

    await checkRoundCompletion(table, `✋ ${player.username} reste.`);
    return true;
  }

  if (action === 'split') {
    if (!canSplit(hand.cards) || player.hands.length > 1) {
      await safeEditTable(table, `⚠️ Split impossible pour ${player.username}.`);
      return true;
    }

    const balance = await table.creditsService.getBalance(
      player.userId,
      player.userTag
    );

    if (balance.credits < hand.bet) {
      await safeEditTable(table, `⚠️ ${player.username} n'a pas assez de crédits pour split.`);
      schedulePlayerTimeout(table, player);
      return true;
    }

    await table.creditsService.decrementCredits(player.userId, hand.bet);

    const movedCard = hand.cards.pop();
    const secondHand = {
      cards: [movedCard],
      bet: hand.bet,
      stood: false,
      busted: false,
      result: null,
    };

    hand.cards.push(drawCard(table.deck));
    secondHand.cards.push(drawCard(table.deck));
    player.hands.push(secondHand);

    schedulePlayerTimeout(table, player);

    await checkRoundCompletion(table, `✂️ ${player.username} split sa main.`);
    return true;
  }

  return true;
}

module.exports = {
  createOrJoinTable,
  handleBlackjackButton,
};