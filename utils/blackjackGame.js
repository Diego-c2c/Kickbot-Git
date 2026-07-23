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

  if (extra) lines.push(extra);

  return lines.join('\n').trim();
}

function buildActionRow(table) {
  if (table.phase !== 'playing') return [];

  const player = table.players[table.currentPlayerIndex];
  if (!player || player.finished) return [];

  const hand = getActiveHand(player);
  const splitAllowed = canSplit(hand.cards) && player.hands.length === 1;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_hit:${table.channelId}:${player.userId}`)
        .setLabel('Carte')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`bj_stand:${table.channelId}:${player.userId}`)
        .setLabel('Stop')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`bj_split:${table.channelId}:${player.userId}`)
        .setLabel('Split')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!splitAllowed)
    ),
  ];
}

async function safeEditTable(table, content, revealDealer = false) {
  try {
    await table.tableMessage.edit({
      content: buildTableMessage(table, { revealDealer, extra: content }),
      components: buildActionRow(table),
    });
  } catch (error) {
    console.error('Erreur update blackjack:', error);
  }
}

function clearPlayerTimer(table) {
  if (table.playerActionTimeout) {
    clearTimeout(table.playerActionTimeout);
    table.playerActionTimeout = null;
  }
}

async function advanceTurn(table) {
  clearPlayerTimer(table);

  while (table.currentPlayerIndex < table.players.length) {
    const player = table.players[table.currentPlayerIndex];

    while (player.activeHandIndex < player.hands.length) {
      const hand = getActiveHand(player);
      const value = getHandValue(hand.cards);

      if (hand.stood || hand.busted) {
        player.activeHandIndex += 1;
        continue;
      }

      if (value > 21) {
        hand.busted = true;
        hand.result = 'Bust';
        player.activeHandIndex += 1;
        continue;
      }

      table.phase = 'playing';
      table.currentPlayerId = player.userId;

      await safeEditTable(
        table,
        `🎯 Tour de ${player.username} — main ${
          player.activeHandIndex + 1
        }. Action dans ${PLAYER_ACTION_MS / 1000} s.`
      );

      table.playerActionTimeout = setTimeout(async () => {
        const liveTable = activeTables.get(table.channelId);
        if (!liveTable) return;

        const livePlayer = liveTable.players[liveTable.currentPlayerIndex];
        if (!livePlayer) return;

        const liveHand = getActiveHand(livePlayer);
        liveHand.stood = true;
        liveHand.result = liveHand.result || 'Stop auto';
        livePlayer.activeHandIndex += 1;

        await advanceTurn(liveTable);
      }, PLAYER_ACTION_MS);

      return;
    }

    player.finished = true;
    table.currentPlayerIndex += 1;
  }

  await resolveDealer(table);
}

async function resolveDealer(table) {
  table.phase = 'dealer';
  clearPlayerTimer(table);

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
        results.push(
          `🖤 ${player.username} fait Blackjack et gagne ${win} crédit(s).`
        );
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
        results.push(
          `➖ ${player.username} récupère sa mise (${hand.bet}).`
        );
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
    `🏁 Fin de manche. Banque à ${dealerValue}${
      dealerBust ? ' (bust)' : ''
    }.\n\n${results.join('\n')}`,
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
  await safeEditTable(table, '🂡 Les cartes sont distribuées.');
  await advanceTurn(table);
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
    await creditsService.decrementCredits(
      interaction.user.id,
      amount
    );

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
      playerActionTimeout: null,
      currentPlayerIndex: 0,
      currentPlayerId: null,
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

  // Acquitte le clic immédiatement pour éviter "n'a pas répondu à temps"
  await interaction.deferUpdate();

  const [action, channelId, playerId] = interaction.customId.split(':');
  const table = activeTables.get(channelId);

  if (!table) {
    // La table n'existe plus, mais l'interaction est déjà deferUpdate, donc rien à faire
    return true;
  }

  const player = table.players.find((p) => p.userId === playerId);
  if (!player) return true;

  if (interaction.user.id !== playerId) {
    // Ce n'est pas le bon joueur, mais on a déjà deferUpdate, donc on ignore
    return true;
  }

  const hand = getActiveHand(player);
  if (!hand) return true;

  if (action === 'bj_hit') {
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

    await safeEditTable(
      table,
      `🃏 ${player.username} tire une carte.`
    );

    return true;
  }

  if (action === 'bj_stand') {
    hand.stood = true;
    hand.result = 'Stop';
    player.activeHandIndex += 1;

    if (player.activeHandIndex >= player.hands.length) {
      player.finished = true;
    }

    await safeEditTable(
      table,
      `✋ ${player.username} reste.`
    );

    // Ici tu peux ensuite vérifier si tous les joueurs ont fini et lancer la banque
    return true;
  }

  if (action === 'bj_split') {
    // Tu gardes ta logique de split ici, mais toujours avec deferUpdate au début
    // ...
    return true;
  }

  return true;
}

module.exports = {
  createOrJoinTable,
  handleBlackjackButton,
};