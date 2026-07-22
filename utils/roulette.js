// Numéros rouges de la roulette européenne
// Tous les autres numéros non nuls sont noirs
const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

// Retourne la couleur d'un numéro
function getColor(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

// Retourne la parité d'un numéro
// Le 0 n'est ni pair ni impair
function getParity(n) {
  if (n === 0) return 'none';
  return n % 2 === 0 ? 'even' : 'odd';
}

// Tire un numéro aléatoire entre 0 et 36
function spinWheel() {
  return Math.floor(Math.random() * 37);
}

// Résout UNE mise après le tirage final
function resolveBet({ bet, amount, number, rolled }) {
  const color = getColor(rolled);
  const parity = getParity(rolled);

  let won = false;
  let winAmount = 0;
  let label = bet;

  // Pari sur une couleur
  // Paiement 1:1 => gain total = amount * 2 dans ton système
  if (bet === 'red' || bet === 'black') {
    won = color === bet;

    if (won) {
      winAmount = amount * 2;
    }
  }

  // Pari sur pair / impair
  // Paiement 1:1 => gain total = amount * 2
  else if (bet === 'even' || bet === 'odd') {
    won = parity === bet;

    if (won) {
      winAmount = amount * 2;
    }
  }

  // Pari sur numéro exact
  // Paiement 35:1 => retour total dans ton système = amount * 36
  else if (bet === 'number') {
    won = rolled === number;
    label = `number ${number}`;

    if (won) {
      winAmount = amount * 36;
    }
  }

  // Cas de sécurité si un pari invalide est transmis
  else {
    return {
      won: false,
      winAmount: 0,
      label: 'invalid',
      color,
      parity,
    };
  }

  return {
    won,
    winAmount,
    label,
    color,
    parity,
  };
}

module.exports = {
  spinWheel,
  resolveBet,
  getColor,
  getParity,
};