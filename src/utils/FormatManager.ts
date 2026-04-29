export class FormatManager {
  static readonly UNITS = [
    { threshold: 1e63, short: 'Vg', name: 'Vigintillion' },
    { threshold: 1e60, short: 'NoD', name: 'Novemdecillion' },
    { threshold: 1e57, short: 'OcD', name: 'Octodecillion' },
    { threshold: 1e54, short: 'SpD', name: 'Septendecillion' },
    { threshold: 1e51, short: 'SxD', name: 'Sexdecillion' },
    { threshold: 1e48, short: 'QiD', name: 'Quindecillion' },
    { threshold: 1e45, short: 'QaD', name: 'Quattuordecillion' },
    { threshold: 1e42, short: 'TD', name: 'Tredecillion' },
    { threshold: 1e39, short: 'DD', name: 'Duodecillion' },
    { threshold: 1e36, short: 'UD', name: 'Undecillion' },
    { threshold: 1e33, short: 'Dc', name: 'Decillion' },
    { threshold: 1e30, short: 'No', name: 'Nonillion' },
    { threshold: 1e27, short: 'Oc', name: 'Octillion' },
    { threshold: 1e24, short: 'Sp', name: 'Septillion' },
    { threshold: 1e21, short: 'Sx', name: 'Sextillion' },
    { threshold: 1e18, short: 'Qi', name: 'Quintillion' },
    { threshold: 1e15, short: 'Qa', name: 'Quadrillion' },
    { threshold: 1e12, short: 'T', name: 'Trillion' },
    { threshold: 1e9, short: 'B', name: 'Billion' },
    { threshold: 1e6, short: 'M', name: 'Million' },
    { threshold: 1e3, short: 'K', name: 'Thousand' }
  ] as const;

  static formatEngineering(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '0';
    }

    if (value === 0) {
      return '0';
    }

    const sign = value < 0 ? '-' : '';
    const absolute = Math.abs(value);
    const exponent = Math.floor(Math.log10(absolute));
    const engineeringExponent = Math.floor(exponent / 3) * 3;
    const mantissa = absolute / (10 ** engineeringExponent);

    return `${sign}${mantissa.toFixed(3)}e${engineeringExponent}`;
  }

  static formatWithCommas(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '0';
    }

    const sign = value < 0 ? '-' : '';
    const absolute = Math.abs(value);
    const [integerPart, decimalPart] = absolute.toString().split('.');
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `${sign}${formattedInteger}${decimalPart ? `.${decimalPart}` : ''}`;
  }

  static formatCompact(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }

    const absolute = Math.abs(value);

    if (absolute < 1000) {
      return value.toString();
    }

    const maxUnit = this.UNITS[0];
    if (absolute >= maxUnit.threshold * 1000) {
      return this.formatEngineering(value);
    }

    const unit = this.UNITS.find((entry) => absolute >= entry.threshold);
    if (!unit) {
      return value.toString();
    }

    return `${(value / unit.threshold).toFixed(3)}${unit.short}`;
  }

  static formatCompactFull(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }

    const absolute = Math.abs(value);
    if (absolute < 1e6) {
      return this.formatWithCommas(value);
    }

    const maxUnit = this.UNITS[0];
    if (absolute >= maxUnit.threshold * 1000) {
      return value < 0 ? '-A LOT!' : 'A LOT!';
    }

    const unit = this.UNITS.find((entry) => absolute >= entry.threshold);
    if (!unit) {
      return value.toString();
    }

    return `${(value / unit.threshold).toFixed(3)} ${unit.name}`;
  }
}

export function formatCompact(value: number | null | undefined): string {
  return FormatManager.formatCompact(value);
}

export function formatCompactFull(value: number | null | undefined): string {
  return FormatManager.formatCompactFull(value);
}
