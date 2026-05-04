import Phaser from 'phaser';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';
import {
  getDiamonds,
  setDiamonds,
  getDiceTokens,
  setDiceTokens,
  getDiceProgress,
  setDiceProgress,
  generateOrGetShopOffers,
  setShopState,
  getShopState,
  getAllDiceDefinitions,
  type ShopOffer
} from '../data/dice';

const CARD_W = 316;
const CARD_H = 210;
const COL_COUNT = 3;
const ROW_COUNT = 2;

export class ShopScene extends Phaser.Scene {
  static readonly KEY = 'ShopScene';
  private readonly debug = DebugManager.attachScene(ShopScene.KEY);

  constructor() {
    super(ShopScene.KEY);
  }

  create() {
    this.debug.log('Shop scene rendered.');
    const panel = drawPanel(this, 'SHOP', 'Daily offers  |  Diamonds ◆ currency');

    const state = generateOrGetShopOffers(this);
    const allDefs = getAllDiceDefinitions(this);

    let diamonds = getDiamonds(this);
    const diamondText = this.add.text(panel.right - 28, panel.y + 58, `◆ ${diamonds}`, {
      fontFamily: 'Orbitron',
      fontSize: '18px',
      color: '#7ec8e3'
    }).setOrigin(1, 0);

    this.add.text(panel.x + 28, panel.y + 58, 'DIAMONDS', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    });

    const refreshLabel = this.buildRefreshLabel(panel);

    const gridStartX = panel.x + 28;
    const gridStartY = panel.y + 98;
    const colGap = (panel.width - 56 - COL_COUNT * CARD_W) / (COL_COUNT - 1);

    const cardObjects: Phaser.GameObjects.GameObject[][] = [];

    state.offers.forEach((offer, index) => {
      const col = index % COL_COUNT;
      const row = Math.floor(index / COL_COUNT);
      const x = gridStartX + col * (CARD_W + colGap);
      const y = gridStartY + row * (CARD_H + 12);

      const def = allDefs.find((d) => d.typeId === offer.typeId);
      const accentHex = def?.accent ?? '#f4b860';
      const accent = Phaser.Display.Color.HexStringToColor(accentHex).color;

      const objs = this.buildOfferCard(x, y, offer, accentHex, accent, () => {
        const currentDiamonds = getDiamonds(this);
        const canAfford = offer.isFreebie ? true : currentDiamonds >= offer.diamondCost;
        if (!canAfford) return;

        const shopState = getShopState(this);
        const offerIdx = shopState.offers.findIndex((o) => o.id === offer.id);
        if (offerIdx < 0) return;
        const targetOffer = shopState.offers[offerIdx];
        if (targetOffer.purchased) return;
        if (offer.isFreebie && shopState.freebieClaimedThisSession) return;

        if (offer.isCoinOffer) {
          setDiceTokens(this, getDiceTokens(this) + offer.coinAmount);
        } else {
          const progress = getDiceProgress(this, offer.typeId);
          if (progress.classLevel < 15) {
            setDiceProgress(this, offer.typeId, { classLevel: progress.classLevel, copies: progress.copies + offer.copies });
          }
        }

        if (!offer.isFreebie) {
          setDiamonds(this, currentDiamonds - offer.diamondCost);
          diamonds = getDiamonds(this);
          diamondText.setText(`◆ ${diamonds}`);
        }

        const updatedOffers = shopState.offers.map((o, i) =>
          i === offerIdx ? { ...o, purchased: true } : o
        );
        setShopState(this, {
          ...shopState,
          offers: updatedOffers,
          freebieClaimedThisSession: offer.isFreebie ? true : shopState.freebieClaimedThisSession
        });

        offer.purchased = true;

        objs.forEach((o) => o.destroy());
        const refreshedOffer = { ...offer, purchased: true };
        const newObjs = this.buildOfferCard(x, y, refreshedOffer, accentHex, accent, () => {});
        cardObjects[index] = newObjs;
      });
      cardObjects[index] = objs;
    });

    this.add.text(panel.centerX, panel.bottom - 30, 'Offers refresh daily  •  Higher rarity = higher cost  •  No copies awarded to maxed dice', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
  }

  private buildRefreshLabel(panel: Phaser.Geom.Rectangle): Phaser.GameObjects.Text {
    const msUntilRefresh = (24 * 60 * 60 * 1000) - (Date.now() % (24 * 60 * 60 * 1000));
    const hours = Math.floor(msUntilRefresh / 3600000);
    const minutes = Math.floor((msUntilRefresh % 3600000) / 60000);
    const label = this.add.text(panel.x + 28, panel.y + 76, `Refreshes in: ${hours}h ${minutes}m`, {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted
    });
    return label;
  }

  private buildOfferCard(
    x: number,
    y: number,
    offer: ShopOffer,
    accentHex: string,
    accentColor: number,
    onClaim: () => void
  ): Phaser.GameObjects.GameObject[] {
    const objs: Phaser.GameObjects.GameObject[] = [];
    const isClaimed = offer.purchased;
    const shopState = getShopState(this);
    const isFrebieClaimed = offer.isFreebie && shopState.freebieClaimedThisSession;
    const effectivelyClaimed = isClaimed || isFrebieClaimed;
    const canAfford = offer.isFreebie ? true : getDiamonds(this) >= offer.diamondCost;

    const cardColor = offer.isFreebie ? 0x1a3a20 : 0x173247;
    const borderColor = offer.isFreebie ? 0x2ecc71 : accentColor;

    const card = this.add.rectangle(x + CARD_W / 2, y + CARD_H / 2, CARD_W, CARD_H, cardColor, 0.97)
      .setStrokeStyle(2, effectivelyClaimed ? 0x335566 : borderColor);
    objs.push(card);

    const headerH = 38;
    const header = this.add.rectangle(x + CARD_W / 2, y + headerH / 2, CARD_W, headerH,
      effectivelyClaimed ? 0x1f2f3d : (offer.isFreebie ? 0x27ae60 : accentColor), effectivelyClaimed ? 0.3 : 0.22);
    objs.push(header);

    if (offer.isFreebie) {
      const freeTag = this.add.text(x + 8, y + 10, '★ DAILY FREEBIE', {
        fontFamily: 'Orbitron', fontSize: '13px', color: effectivelyClaimed ? PALETTE.textMuted : '#2ecc71'
      });
      objs.push(freeTag);
    } else {
      const rarityColors: Record<string, string> = {
        Common: '#aaaaaa', Uncommon: '#3dc45d', Rare: '#5ba3ff', Epic: '#c06bdb', Legendary: '#f4b860'
      };
      const rarTag = this.add.text(x + 8, y + 10, offer.rarity.toUpperCase(), {
        fontFamily: 'Orbitron', fontSize: '12px', color: rarityColors[offer.rarity] ?? PALETTE.accentSoft
      });
      objs.push(rarTag);
    }

    const nameLine = offer.isCoinOffer
      ? 'Dice Tokens'
      : (offer.typeId ? offer.typeId + ' Dice' : '—');
    const nameText = this.add.text(x + 8, y + 48, nameLine.toUpperCase(), {
      fontFamily: 'Orbitron', fontSize: '17px', color: effectivelyClaimed ? PALETTE.textMuted : (offer.isFreebie ? '#8ae0a1' : accentHex)
    });
    objs.push(nameText);

    const descLine = offer.isCoinOffer
      ? `+${offer.coinAmount} Dice Tokens`
      : `×${offer.copies} ${offer.copies === 1 ? 'copy' : 'copies'}`;
    const descText = this.add.text(x + 8, y + 80, descLine, {
      fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.text
    });
    objs.push(descText);

    if (!offer.isCoinOffer && offer.typeId) {
      const progress = getDiceProgress(this, offer.typeId);
      const progressLine = `Current: C${progress.classLevel}/15  •  ${progress.copies} copies`;
      const progressText = this.add.text(x + 8, y + 108, progressLine, {
        fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted
      });
      objs.push(progressText);
    }

    const costLine = offer.isFreebie ? 'FREE' : `◆ ${offer.diamondCost}`;
    const costColor = offer.isFreebie ? '#2ecc71' : (canAfford ? '#7ec8e3' : PALETTE.danger);
    const costText = this.add.text(x + CARD_W - 12, y + 48, costLine, {
      fontFamily: 'Orbitron', fontSize: '18px', color: effectivelyClaimed ? PALETTE.textMuted : costColor
    }).setOrigin(1, 0);
    objs.push(costText);

    const btnY = y + CARD_H - 32;
    const btnW = CARD_W - 24;
    let btnColor: number;
    let btnLabel: string;

    if (effectivelyClaimed) {
      btnColor = 0x1f2f3d;
      btnLabel = 'CLAIMED';
    } else if (!canAfford) {
      btnColor = 0x5a3a3a;
      btnLabel = 'NOT ENOUGH ◆';
    } else {
      btnColor = offer.isFreebie ? 0x27ae60 : 0x2271b3;
      btnLabel = offer.isFreebie ? 'CLAIM FREE!' : 'BUY';
    }

    const btn = this.add.rectangle(x + CARD_W / 2, btnY, btnW, 36, btnColor, effectivelyClaimed ? 0.4 : 0.95)
      .setStrokeStyle(1, effectivelyClaimed ? 0x335566 : 0x406987);
    objs.push(btn);

    const btnText = this.add.text(x + CARD_W / 2, btnY, btnLabel, {
      fontFamily: 'Orbitron', fontSize: '13px', color: effectivelyClaimed ? PALETTE.textMuted : '#ffffff'
    }).setOrigin(0.5);
    objs.push(btnText);

    if (!effectivelyClaimed && canAfford) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setFillStyle(offer.isFreebie ? 0x219a52 : 0x1a5a94, 1));
      btn.on('pointerout', () => btn.setFillStyle(btnColor, 0.95));
      btn.on('pointerdown', onClaim);
    }

    return objs;
  }
}
