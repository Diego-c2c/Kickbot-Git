const { spinWheel, resolveBet, getColor, getParity } = require('./roulette');

const ROUND_DURATION_MS = 40000;
const CHECKPOINTS = [30, 20, 10, 5];
const activeRounds = new Map();

function formatBetLabel(bet, number) {
  if (bet === 'number') return `number ${number}`;
  return bet;
}

function buildCountdownText(secondsLeft, betsCount) {
  return [
    '🎰 Roulette ouverte !',
    `⏳ Fin des mises dans ${secondsLeft} secondes.`,
    `🧾 Mises enregistrées : ${betsCount}`,
    'Utilisez /roulette pour rejoindre ce tour.',
  ].join('\n');
}

function getSecondsLeft(round) {
  const elapsed = Date.now() - round.startedAt;
  const remaining = Math.ceil((ROUND_DURATION_MS - elapsed) / 1000);
  return Math.max(0, remaining);
}

async function safeEditCountdown(round, content) {
  try {
    await round.countdownMessage.edit(content);
  } catch (error) {
    console.error('Erreur edit message roulette:', error);
  }
}

function scheduleCountdownUpdates(round) {
  for (const secondsLeft of CHECKPOINTS) {
    const delay = ROUND_DURATION_MS - secondsLeft * 1000;

    const timeout = setTimeout(async () => {
      const currentRound = activeRounds.get(round.channelId);
      if (!currentRound) return;

      const liveSecondsLeft = getSecondsLeft(currentRound);
      if (liveSecondsLeft <= 0) return;

      await safeEditCountdown(
        currentRound,
        buildCountdownText(liveSecondsLeft, currentRound.bets.length)
      );
    }, delay);

    round.timeouts.push(timeout);
  }
}

async function finalizeRound(channel, channelId, creditsService) {
  const round = activeRounds.get(channelId);
  if (!round) return;

  const rolled = spinWheel();
  const color = getColor(rolled);
  const parity = getParity(rolled);

  const winners = [];
  const losers = [];

  for (const betEntry of round.bets) {
    const outcome = resolveBet({
      bet: betEntry.bet,
      amount: betEntry.amount,
      number: betEntry.number,
      rolled,
    });

    if (outcome.won) {
      await creditsService.incrementCredits(betEntry.userId, outcome.winAmount);
      winners.push(
        `✅ ${betEntry.username} gagne ${outcome.winAmount} crédits sur ${outcome.label} (mise ${betEntry.amount})`
      );
    } else {
      losers.push(
        `❌ ${betEntry.username} perd ${betEntry.amount} crédits sur ${formatBetLabel(
          betEntry.bet,
          betEntry.number
        )}`
      );
    }
  }

  const resultLine =
    rolled === 0
      ? '🎲 Résultat : 0 (green)'
      : `🎲 Résultat : ${rolled} (${color}, ${parity})`;

  const winnersText =
    winners.length > 0 ? winners.join('\n') : 'Personne ne gagne sur ce tour.';

  const losersText =
    losers.length > 0 ? losers.join('\n') : 'Personne ne perd sur ce tour.';

  await safeEditCountdown(round, '⏰ Les mises sont fermées !');

  try {
    await channel.send(
      `${resultLine}\n\n🏆 Gagnants :\n${winnersText}\n\n💀 Perdants :\n${losersText}`
    );
  } catch (error) {
    console.error('Erreur envoi résultat roulette:', error);
  }

  for (const timeout of round.timeouts) {
    clearTimeout(timeout);
  }

  activeRounds.delete(channelId);
}

async function addBetToRound({
  interaction,
  player,
  bet,
  amount,
  number,
  creditsService,
}) {
  const channel = interaction.channel;
  const channelId = channel.id;

  let round = activeRounds.get(channelId);

  // Si aucun round n'existe encore, on tente d'abord de créer
  // le message public de countdown AVANT de retirer les crédits
  if (!round) {
    let countdownMessage;

    try {
      countdownMessage = await channel.send(buildCountdownText(40, 0));
    } catch (error) {
      console.error('Impossible de créer le message public de roulette:', error);

      return {
        message: "Je n'ai pas accès à ce salon pour lancer la roulette. Vérifie mes permissions sur ce channel.",
      };
    }

    round = {
      channelId,
      startedAt: Date.now(),
      bets: [],
      countdownMessage,
      timeouts: [],
    };

    activeRounds.set(channelId, round);

    scheduleCountdownUpdates(round);

    const finalTimeout = setTimeout(async () => {
      await finalizeRound(channel, channelId, creditsService);
    }, ROUND_DURATION_MS);

    round.timeouts.push(finalTimeout);
  }

  // Une fois qu'on sait que le round existe bien, on retire les crédits
  await creditsService.decrementCredits(interaction.user.id, amount);

  // On ajoute la mise au round
  round.bets.push({
    userId: interaction.user.id,
    username: interaction.user.username,
    bet,
    amount,
    number,
  });

  // On met à jour le message public avec le nombre réel de mises
  const secondsLeft = getSecondsLeft(round);

  await safeEditCountdown(
    round,
    buildCountdownText(secondsLeft, round.bets.length)
  );

  return {
    message: `Mise enregistrée : ${amount} crédits sur ${formatBetLabel(
      bet,
      number
    )}.`,
  };
}

module.exports = {
  addBetToRound,
};