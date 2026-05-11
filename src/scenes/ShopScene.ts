import Phaser from 'phaser';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';
import { SCENE_KEYS } from './sceneKeys';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
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
  type ShopOffer,
  type ShopState
} from '../data/dice';

const CARD_W = 316;
const CARD_H = 190;
const CARD_GAP = 12;
const COL_COUNT = 3;

export class ShopScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Shop;
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

    this.buildRefreshLabel(panel);

    const gridStartX = panel.x + 28;
    const gridStartY = panel.y + 98;
    const gridHeight = panel.bottom - gridStartY - 56;
    const colGap = (panel.width - 56 - COL_COUNT * CARD_W) / (COL_COUNT - 1);
    const contentHeight = Math.ceil(state.offers.length / COL_COUNT) * (CARD_H + CARD_GAP) - CARD_GAP;
    const maxScroll = Math.max(0, contentHeight - gridHeight);
    let scrollY = 0;

    const scrollContainer = this.add.container(0, gridStartY);
    const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(panel.x + 18, gridStartY - 8, panel.width - 36, gridHeight + 16);
    scrollContainer.setMask(maskShape.createGeometryMask());

    const scrollThumb = this.add.rectangle(panel.right - 12, gridStartY, 6, Math.max(36, gridHeight * (gridHeight / Math.max(gridHeight, contentHeight))), 0x7ec8e3, 0.65)
      .setOrigin(0.5, 0);
    this.add.text(panel.centerX, gridStartY - 16, 'Scroll for more offers', {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: maxScroll > 0 ? PALETTE.textMuted : '#00000000'
    }).setOrigin(0.5);

    const updateScroll = (delta: number) => {
      scrollY = Phaser.Math.Clamp(scrollY + delta, 0, maxScroll);
      scrollContainer.y = gridStartY - scrollY;
      const travel = Math.max(0, gridHeight - scrollThumb.height);
      scrollThumb.y = gridStartY + (maxScroll > 0 ? travel * (scrollY / maxScroll) : 0);
    };

    const scrollBounds = new Phaser.Geom.Rectangle(panel.x + 18, gridStartY - 8, panel.width - 36, gridHeight + 16);
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _go: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      if (Phaser.Geom.Rectangle.Contains(scrollBounds, pointer.x, pointer.y)) updateScroll(dy);
    });

    const cardObjects: Phaser.GameObjects.GameObject[][] = [];

    state.offers.forEach((offer, index) => {
      const col = index % COL_COUNT;
      const row = Math.floor(index / COL_COUNT);
      const x = gridStartX + col * (CARD_W + colGap);
      const y = row * (CARD_H + CARD_GAP);

      const def = allDefs.find((d) => d.typeId === offer.typeId);
      const accentHex = offer.isDiceTokenOffer ? '#7ec8e3' : (offer.isCasinoChipOffer ? '#f4b860' : (def?.accent ?? '#f4b860'));
      const accent = Phaser.Display.Color.HexStringToColor(accentHex).color;

      const objs = this.buildOfferCard(x, y, offer, accentHex, accent, () => {
        const currentDiamonds = getDiamonds(this);
        const canAfford = offer.isFreebie ? true : currentDiamonds >= offer.diamondCost;
        if (!canAfford) return;

        const shopState = getShopState(this);
        const offerIdx = shopState.offers.findIndex((o) => o.id === offer.id);
        if (offerIdx < 0) return;
        const targetOffer = shopState.offers[offerIdx];
        if (targetOffer.purchased && !this.isInfiniteCurrencyOffer(offer)) return;
        if (offer.isFreebie && shopState.freebieClaimedThisSession) return;

        const firstTokenPurchase = this.isFirstDiceTokenPurchase(shopState, offer);
        if (offer.isCasinoChipOffer) {
          CasinoProgressStore.mutate(this, (progress) => ({ ...progress, chips: progress.chips + offer.coinAmount }));
        } else if (offer.isCoinOffer) {
          setDiceTokens(this, getDiceTokens(this) + offer.coinAmount * (firstTokenPurchase ? 2 : 1));
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
          i === offerIdx ? { ...o, purchased: this.isInfiniteCurrencyOffer(offer) ? false : true } : o
        );
        setShopState(this, {
          ...shopState,
          offers: updatedOffers,
          freebieClaimedThisSession: offer.isFreebie ? true : shopState.freebieClaimedThisSession,
          diceTokenFirstPurchaseIds: firstTokenPurchase
            ? [...shopState.diceTokenFirstPurchaseIds, offer.id]
            : shopState.diceTokenFirstPurchaseIds
        });

        if (this.isInfiniteCurrencyOffer(offer)) {
          this.scene.restart();
          return;
        }

        offer.purchased = true;

        objs.forEach((o) => o.destroy());
        const refreshedOffer = { ...offer, purchased: true };
        const newObjs = this.buildOfferCard(x, y, refreshedOffer, accentHex, accent, () => {});
        newObjs.forEach((obj) => scrollContainer.add(obj));
        cardObjects[index] = newObjs;
      });
      objs.forEach((obj) => scrollContainer.add(obj));
      cardObjects[index] = objs;
    });
    updateScroll(0);

    this.add.text(panel.centerX, panel.bottom - 30, 'Offers refresh daily  •  Gem dice offers can roll 1×-10× copies/cost  •  Currency bundles are infinitely purchasable', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
  }

  private isFirstDiceTokenPurchase(shopState: ShopState, offer: ShopOffer): boolean {
    return Boolean(offer.isDiceTokenOffer && !shopState.diceTokenFirstPurchaseIds.includes(offer.id));
  }

  private isInfiniteCurrencyOffer(offer: ShopOffer): boolean {
    return Boolean(offer.isDiceTokenOffer || offer.isCasinoChipOffer);
  }

  private getOfferHeaderLabel(offer: ShopOffer): string {
    if (offer.isDiceTokenOffer) return 'DICE TOKEN VAULT';
    if (offer.isCasinoChipOffer) return 'CASINO CHIP STACK';
    if (offer.isFreebie) return '★ DAILY FREEBIE';
    return offer.rarity.toUpperCase();
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
    const isInfiniteOffer = this.isInfiniteCurrencyOffer(offer);
    const effectivelyClaimed = !isInfiniteOffer && (isClaimed || isFrebieClaimed);
    const canAfford = offer.isFreebie ? true : getDiamonds(this) >= offer.diamondCost;

    const cardColor = offer.isFreebie ? 0x1a3a20 : (offer.isCasinoChipOffer ? 0x2a2438 : 0x173247);
    const borderColor = offer.isFreebie ? 0x2ecc71 : accentColor;

    const card = this.add.rectangle(x + CARD_W / 2, y + CARD_H / 2, CARD_W, CARD_H, cardColor, 0.97)
      .setStrokeStyle(2, effectivelyClaimed ? 0x335566 : borderColor);
    objs.push(card);

    const headerH = 38;
    const header = this.add.rectangle(x + CARD_W / 2, y + headerH / 2, CARD_W, headerH,
      effectivelyClaimed ? 0x1f2f3d : (offer.isFreebie ? 0x27ae60 : accentColor), effectivelyClaimed ? 0.3 : 0.22);
    objs.push(header);

    const headerLabel = this.getOfferHeaderLabel(offer);
    const rarityColors: Record<string, string> = {
      Common: '#aaaaaa', Uncommon: '#3dc45d', Rare: '#5ba3ff', Epic: '#c06bdb', Legendary: '#f4b860', Diamond: '#7ec8e3', Casino: '#f4b860'
    };
    const headerTag = this.add.text(x + CARD_W / 2, y + 10, headerLabel, {
      fontFamily: 'Orbitron', fontSize: offer.isFreebie ? '13px' : '12px', color: effectivelyClaimed ? PALETTE.textMuted : (rarityColors[offer.rarity] ?? PALETTE.accentSoft)
    }).setOrigin(0.5, 0);
    objs.push(headerTag);

    const nameLine = offer.isCasinoChipOffer
      ? 'Casino Chips'
      : (offer.isCoinOffer
        ? 'Dice Tokens'
        : (offer.typeId ? offer.typeId + ' Dice' : '—'));
    const nameText = this.add.text(x + 8, y + 48, nameLine.toUpperCase(), {
      fontFamily: 'Orbitron', fontSize: '17px', color: effectivelyClaimed ? PALETTE.textMuted : (offer.isFreebie ? '#8ae0a1' : accentHex)
    });
    objs.push(nameText);

    const firstTokenPurchase = this.isFirstDiceTokenPurchase(shopState, offer);
    const tokenAmount = offer.coinAmount * (firstTokenPurchase ? 2 : 1);
    const descLine = offer.isCasinoChipOffer
      ? `+${offer.coinAmount.toLocaleString()} Casino Chips`
      : (offer.isCoinOffer
        ? `+${tokenAmount.toLocaleString()} Dice Tokens${firstTokenPurchase ? ' (2× first buy)' : ''}`
        : `×${offer.copies} ${offer.copies === 1 ? 'copy' : 'copies'}`);
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
