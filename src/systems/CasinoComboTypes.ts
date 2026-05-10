export type ChestType = 'Bronze' | 'Silver' | 'Gold' | 'Diamond' | 'Master';
export type FivesComboType = 'No combo' | 'Pair' | 'Two Pair' | 'Three-of-a-kind' | 'Full House' | 'Small Straight' | 'Large Straight' | 'Four-of-a-kind' | 'Five-of-a-kind';

export interface ComboPayout {
  combo: FivesComboType;
  chestType: ChestType;
  chestCount: number;
  pipSum: number;
  layout: string;
}

interface ComboRule {
  combo: FivesComboType;
  chestType: ChestType;
  matches: (analysis: FivesComboAnalysis) => string | null;
}

interface FivesComboAnalysis {
  values: number[];
  pipSum: number;
  groups: number[];
  unique: number[];
  countEntries: Array<[number, number]>;
}

const STRAIGHT_RUNS = [
  [1, 2, 3, 4],
  [2, 3, 4, 5],
  [3, 4, 5, 6]
];

const sorted = (dice: number[]) => [...dice].sort((a, b) => a - b);
const formatDice = (dice: number[]) => dice.join('-');

function analyzeFivesDice(dice: number[]): FivesComboAnalysis {
  const values = sorted(dice).slice(0, 5);
  const pipSum = values.reduce((a, b) => a + b, 0);
  const counts = new Map<number, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));

  return {
    values,
    pipSum,
    groups: [...counts.values()].sort((a, b) => b - a),
    unique: [...counts.keys()].sort((a, b) => a - b),
    countEntries: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  };
}

function findSmallStraight(unique: number[]): number[] | null {
  return STRAIGHT_RUNS.find((seq) => seq.every((n) => unique.includes(n))) ?? null;
}

const FIVES_COMBO_RULES: ComboRule[] = [
  {
    combo: 'Five-of-a-kind',
    chestType: 'Master',
    matches: ({ groups, countEntries }) => groups[0] === 5 ? `${countEntries[0]?.[0]}-${countEntries[0]?.[0]}-${countEntries[0]?.[0]}-${countEntries[0]?.[0]}-${countEntries[0]?.[0]} (all five dice match)` : null
  },
  {
    combo: 'Four-of-a-kind',
    chestType: 'Diamond',
    matches: ({ groups, countEntries }) => groups[0] === 4 ? `${countEntries[0]?.[0]}-${countEntries[0]?.[0]}-${countEntries[0]?.[0]}-${countEntries[0]?.[0]} + kicker (four dice match)` : null
  },
  {
    combo: 'Full House',
    chestType: 'Diamond',
    matches: ({ groups, countEntries }) => groups[0] === 3 && groups[1] === 2 ? `${countEntries[0]?.[0]}-${countEntries[0]?.[0]}-${countEntries[0]?.[0]} + ${countEntries[1]?.[0]}-${countEntries[1]?.[0]} (3 + 2)` : null
  },
  {
    combo: 'Large Straight',
    chestType: 'Gold',
    matches: ({ unique }) => unique.length === 5 && (formatDice(unique) === '1-2-3-4-5' || formatDice(unique) === '2-3-4-5-6') ? `${formatDice(unique)} (five in a row)` : null
  },
  {
    combo: 'Small Straight',
    chestType: 'Silver',
    matches: ({ unique }) => {
      const straight = findSmallStraight(unique);
      return straight ? `${formatDice(straight)} + any 5th die (four in a row)` : null;
    }
  },
  {
    combo: 'Three-of-a-kind',
    chestType: 'Gold',
    matches: ({ groups, countEntries }) => groups[0] === 3 ? `${countEntries[0]?.[0]}-${countEntries[0]?.[0]}-${countEntries[0]?.[0]} + two kickers (three dice match)` : null
  },
  {
    combo: 'Two Pair',
    chestType: 'Silver',
    matches: ({ groups, countEntries }) => groups[0] === 2 && groups[1] === 2 ? `${countEntries[0]?.[0]}-${countEntries[0]?.[0]} + ${countEntries[1]?.[0]}-${countEntries[1]?.[0]} + kicker` : null
  },
  {
    combo: 'Pair',
    chestType: 'Bronze',
    matches: ({ groups, countEntries }) => groups[0] === 2 ? `${countEntries[0]?.[0]}-${countEntries[0]?.[0]} + three kickers` : null
  }
];

export function evaluateFivesCombo(dice: number[]): ComboPayout {
  const analysis = analyzeFivesDice(dice);
  for (const rule of FIVES_COMBO_RULES) {
    const layout = rule.matches(analysis);
    if (layout) {
      return { combo: rule.combo, chestType: rule.chestType, chestCount: analysis.pipSum, pipSum: analysis.pipSum, layout };
    }
  }

  return { combo: 'No combo', chestType: 'Bronze', chestCount: 5, pipSum: analysis.pipSum, layout: `${formatDice(analysis.values)} (no pair or straight)` };
}
