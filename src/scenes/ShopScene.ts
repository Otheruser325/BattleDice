import Phaser from 'phaser';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';
import { SCENE_KEYS } from './sceneKeys';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { AlertManager } from '../utils/AlertManager';
import {
  getDiamonds,
  setDiamonds,
  getDiceTokens,
  setDiceTokens,
  getDiceProgress,
  grantDiceCopies,
  canReceiveUsefulCopies,
  generateOrGetShopOffers,
  refreshShopOffers,
  getShopRefreshInfo,
  SHOP_REFRESH_COSTS,
  setShopState,
  getShopState,
  getAllDiceDefinitions,
  RARITY_TEXT_COLORS,
  type ShopOffer,
  type ShopState
} from '../data/dice';
import { formatCompact } from '../utils/FormatManager';
import { getTalentClassNeeded, getTalentByIndex, getUnobtainableTalentReason, grantTalent } from '../systems/DiceTalents';

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
    let diceTokens = getDiceTokens(this);
    const tokenText = this.add.text(panel.x + 28, panel.y + 58, `DICE TOKENS: ${formatCompact(diceTokens)}`, {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.accentSoft
    });
    const diamondText = this.add.text(panel.right - 18, panel.y + 58, `◆ ${formatCompact(diamonds)}`, {
      fontFamily: 'Orbitron',
      fontSize: '18px',
      color: '#7ec8e3'
    }).setOrigin(1, 0);

    this.buildRefreshLabel(panel);

    const gridStartX = panel.x + 28;
    const gridStartY = panel.y + 98;
    const gridHeight = panel.bottom - gridStartY - 56;
    const colGap = (panel.width - 56 - COL_COUNT * CARD_W) / (COL_COUNT - 1);
    const diceOfferCount = state.offers.filter((offer) => !offer.isRefreshOffer && !offer.isDiceTokenOffer && !offer.isCasinoChipOffer).length;
    const currencyOfferCount = state.offers.filter((offer) => offer.isDiceTokenOffer || offer.isCasinoChipOffer).length;
    const refreshRow = Math.ceil(diceOfferCount / COL_COUNT);
    const contentRows = refreshRow + (state.offers.some((offer) => offer.isRefreshOffer) ? 1 : 0) + Math.ceil(currencyOfferCount / COL_COUNT);
    const contentHeight = Math.max(0, contentRows * (CARD_H + CARD_GAP) - CARD_GAP);
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
    const renderOfferCards = () => {
      state.offers.forEach((offer, index) => {
        cardObjects[index]?.forEach((o) => o.destroy());
        const isRefreshOffer = offer.isRefreshOffer === true;
        const isCurrencyOffer = offer.isDiceTokenOffer === true || offer.isCasinoChipOffer === true;
        const precedingOffers = state.offers.slice(0, index);
        const diceIndex = precedingOffers.filter((candidate) => !candidate.isRefreshOffer && !candidate.isDiceTokenOffer && !candidate.isCasinoChipOffer).length;
        const currencyIndex = precedingOffers.filter((candidate) => candidate.isDiceTokenOffer || candidate.isCasinoChipOffer).length;
        const col = isRefreshOffer ? 0 : (isCurrencyOffer ? currencyIndex % COL_COUNT : diceIndex % COL_COUNT);
        const row = isRefreshOffer ? refreshRow : (isCurrencyOffer ? refreshRow + 1 + Math.floor(currencyIndex / COL_COUNT) : Math.floor(diceIndex / COL_COUNT));
        const x = isRefreshOffer ? gridStartX : gridStartX + col * (CARD_W + colGap);
        const y = row * (CARD_H + CARD_GAP);
        const def = allDefs.find((d) => d.typeId === offer.typeId);
        const accentHex = offer.isRefreshOffer ? '#d98cff' : (offer.isDiceTokenOffer ? '#7ec8e3' : (offer.isCasinoChipOffer ? '#f4b860' : (def?.accent ?? '#f4b860')));
        const accent = Phaser.Display.Color.HexStringToColor(accentHex).color;
        const handlePurchase = () => {
          if (offer.isRefreshOffer) {
            const refreshed = refreshShopOffers(this);
            if (!refreshed) {
              AlertManager.toast(this, { type: 'warning', message: 'You need more Dice Tokens to refresh offers.' });
              return;
            }
            diceTokens = getDiceTokens(this);
            tokenText.setText(`DICE TOKENS: ${formatCompact(diceTokens)}`);
            state.offers = refreshed.offers;
            state.generatedDay = refreshed.generatedDay;
            state.offerRefreshDay = refreshed.offerRefreshDay;
            state.offerRefreshCount = refreshed.offerRefreshCount;
            state.offerRefreshNonce = refreshed.offerRefreshNonce;
            renderOfferCards();
            return;
          }
          const currentDiamonds = getDiamonds(this);
          const currentDiceTokens = getDiceTokens(this);
          const canAfford = offer.isFreebie ? true : (offer.diceTokenCost !== undefined ? currentDiceTokens >= offer.diceTokenCost : currentDiamonds >= offer.diamondCost);
          if (!canAfford) return;

          const shopState = getShopState(this);
          
          if (offer.isFreebie && shopState.claimedFreebieIds.includes(offer.id)) {
            AlertManager.toast(this, { type: 'warning', message: 'This freebie has already been claimed.' });
            return;
          }
          
          const offerIdx = shopState.offers.findIndex((o) => o.id === offer.id);
          if (offerIdx < 0) return;
          const targetOffer = shopState.offers[offerIdx];
          if (targetOffer.purchased && !this.isInfiniteCurrencyOffer(offer)) return;
          if (offer.isFreebie && shopState.claimedFreebieIds.includes(offer.id)) return;
          if (offer.isFreebie && !offer.isCoinOffer && (!offer.typeId || !canReceiveUsefulCopies(this, offer.typeId))) return;

          const firstTokenPurchase = this.isFirstDiceTokenPurchase(shopState, offer);
          const firstChipPurchase = this.isFirstCasinoChipPurchase(shopState, offer);
          if (offer.isTalentOffer) {
            const def = allDefs.find((candidate) => candidate.typeId === offer.typeId);
            if (!def || offer.talentIndex === undefined) {
              AlertManager.toast(this, { type: 'warning', message: 'This talent offer is no longer available.' });
              return;
            }
            const talent = getTalentByIndex(def, offer.talentIndex);
            const reason = getUnobtainableTalentReason(this, def, offer.talentIndex);
            if (!talent || reason === 'invalid' || reason === 'coming-soon') {
              AlertManager.toast(this, { type: 'warning', message: 'This talent offer is no longer available.' });
              return;
            }
            if (reason === 'owned') {
              AlertManager.toast(this, { type: 'warning', message: 'You already own this talent.' });
              return;
            }
            if (reason === 'locked') {
              AlertManager.toast(this, { type: 'warning', message: `Obtain ${def.title} before unlocking ${talent.title}.` });
              return;
            }
            if (reason === 'class') {
              AlertManager.toast(this, { type: 'warning', message: `Reach class ${getTalentClassNeeded(talent)} to unlock ${talent.title}.` });
              return;
            }
            if (!grantTalent(this, def, offer.talentIndex)) {
              AlertManager.toast(this, { type: 'warning', message: 'This talent offer is no longer available.' });
              return;
            }
          } else if (offer.isCasinoChipOffer) CasinoProgressStore.mutate(this, (progress) => ({ ...progress, chips: progress.chips + offer.coinAmount * (firstChipPurchase ? 2 : 1) }));
          else if (offer.isDiamondFreebie) setDiamonds(this, getDiamonds(this) + offer.coinAmount);
          else if (offer.isCoinOffer) setDiceTokens(this, getDiceTokens(this) + offer.coinAmount * (firstTokenPurchase ? 2 : 1));
          else {
            const progress = getDiceProgress(this, offer.typeId);
            if (progress.classLevel < 15) grantDiceCopies(this, offer.typeId, offer.copies);
          }
          if (!offer.isFreebie) {
            if (offer.diceTokenCost !== undefined) setDiceTokens(this, currentDiceTokens - offer.diceTokenCost);
            else setDiamonds(this, currentDiamonds - offer.diamondCost);
          }
          diamonds = getDiamonds(this);
          diceTokens = getDiceTokens(this);
          diamondText.setText(`◆ ${formatCompact(diamonds)}`);
          tokenText.setText(`DICE TOKENS: ${formatCompact(diceTokens)}`);
          const updatedOffers = shopState.offers.map((o, i) => i === offerIdx ? { ...o, purchased: this.isInfiniteCurrencyOffer(offer) ? false : true } : o);
          const updatedState: ShopState = {
            ...shopState,
            offers: updatedOffers,
            freebieClaimedThisSession: offer.isFreebie ? true : shopState.freebieClaimedThisSession,
            freebieClaimedAt: offer.isFreebie ? Date.now() : shopState.freebieClaimedAt,
            claimedFreebieIds: offer.isFreebie ? [...shopState.claimedFreebieIds, offer.id] : shopState.claimedFreebieIds,
            diceTokenFirstPurchaseIds: firstTokenPurchase ? [...shopState.diceTokenFirstPurchaseIds, offer.id] : shopState.diceTokenFirstPurchaseIds,
            casinoChipFirstPurchaseIds: firstChipPurchase ? [...shopState.casinoChipFirstPurchaseIds, offer.id] : shopState.casinoChipFirstPurchaseIds
          };
          setShopState(this, updatedState);
          offer.purchased = !this.isInfiniteCurrencyOffer(offer);

          const nextState = !offer.isTalentOffer && offer.typeId && !canReceiveUsefulCopies(this, offer.typeId)
            ? generateOrGetShopOffers(this)
            : updatedState;
          state.offers = nextState.offers;
          state.generatedDay = nextState.generatedDay;
          state.offerRefreshDay = nextState.offerRefreshDay;
          state.offerRefreshCount = nextState.offerRefreshCount;
          state.offerRefreshNonce = nextState.offerRefreshNonce;
          renderOfferCards();
        };
        const objs = offer.isRefreshOffer
          ? this.buildRefreshOfferCard(x, y, panel.width - 56, handlePurchase)
          : this.buildOfferCard(x, y, offer, accentHex, accent, handlePurchase);
        objs.forEach((obj) => scrollContainer.add(obj));
        cardObjects[index] = objs;
      });
    };

    renderOfferCards();
    updateScroll(0);

    this.add.text(panel.centerX, panel.bottom - 30, 'Offers refresh daily  •  Three token refreshes/day: 1,000 → 5,000 → 25,000 DT  •  Currency bundles are infinitely purchasable', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
  }

  private buildRefreshOfferCard(x: number, y: number, width: number, onRefresh: () => void): Phaser.GameObjects.GameObject[] {
    const info = getShopRefreshInfo(this);
    const used = info.used;
    const remaining = info.remaining;
    const cost = info.cost;
    const canAfford = cost !== null && getDiceTokens(this) >= cost;
    const card = this.add.rectangle(x + width / 2, y + CARD_H / 2, width, CARD_H, 0x2b1f3a, 0.98)
      .setStrokeStyle(2, canAfford ? 0xd98cff : 0x5b476b);
    const header = this.add.rectangle(x + width / 2, y + 30, width, 60, 0x8c4fb3, 0.22);
    const title = this.add.text(x + 22, y + 16, 'REFRESH DICE OFFERS', {
      fontFamily: 'Orbitron', fontSize: '19px', color: canAfford ? '#f1c8ff' : PALETTE.textMuted
    });
    const detail = this.add.text(x + 22, y + 55, remaining > 0
      ? `${remaining} refresh${remaining === 1 ? '' : 'es'} remaining today  •  Cost: ${formatCompact(cost)} Dice Tokens`
      : 'All three refreshes used today', {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text
    });
    const progress = this.add.text(x + 22, y + 92, `${used}/3 used  •  Refreshing replaces all dice offers`, {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted
    });
    const miniCards = SHOP_REFRESH_COSTS.map((stageCost, index) => {
      const miniX = x + 22 + index * 92;
      const mini = this.add.rectangle(miniX + 38, y + 138, 78, 38, index < used ? 0x3d3348 : 0x55316f, 0.96)
        .setStrokeStyle(1, index < used ? 0x5b476b : 0xd98cff);
      const label = this.add.text(miniX + 38, y + 138, index < used ? 'USED' : `${formatCompact(stageCost)} DT`, {
        fontFamily: 'Orbitron', fontSize: '10px', color: index < used ? PALETTE.textMuted : '#ffffff'
      }).setOrigin(0.5);
      return [mini, label];
    }).flat();
    const button = this.add.rectangle(x + width - 150, y + 135, 250, 42, canAfford ? 0x7d4bb0 : 0x3d3348, 0.96)
      .setStrokeStyle(1, canAfford ? 0xe2aaff : 0x5b476b);
    const buttonText = this.add.text(x + width - 150, y + 135, remaining > 0 ? `REFRESH — ${formatCompact(cost)} DT` : 'SOLD OUT', {
      fontFamily: 'Orbitron', fontSize: '13px', color: canAfford ? '#ffffff' : PALETTE.textMuted
    }).setOrigin(0.5);
    if (canAfford) {
      button.setInteractive({ useHandCursor: true });
      button.on('pointerover', () => button.setFillStyle(0x9b5fc9, 1));
      button.on('pointerout', () => button.setFillStyle(0x7d4bb0, 0.96));
      button.on('pointerdown', onRefresh);
    }
    return [card, header, title, detail, progress, ...miniCards, button, buttonText];
  }

  private isFirstDiceTokenPurchase(shopState: ShopState, offer: ShopOffer): boolean {
    return Boolean(offer.isDiceTokenOffer && !shopState.diceTokenFirstPurchaseIds.includes(offer.id));
  }

  private isFirstCasinoChipPurchase(shopState: ShopState, offer: ShopOffer): boolean {
    return Boolean(offer.isCasinoChipOffer && !shopState.casinoChipFirstPurchaseIds.includes(offer.id));
  }

  private isInfiniteCurrencyOffer(offer: ShopOffer): boolean {
    return Boolean(offer.isDiceTokenOffer || offer.isCasinoChipOffer);
  }

  private isClaimableDiceCopyFreebie(offer: ShopOffer): boolean {
    return Boolean(
      !offer.isCoinOffer &&
      !offer.isDiceTokenOffer &&
      !offer.isCasinoChipOffer &&
      offer.typeId &&
      offer.copies > 0 &&
      canReceiveUsefulCopies(this, offer.typeId)
    );
  }

  private getOfferHeaderLabel(offer: ShopOffer): string {
    if (offer.isTalentOffer) return 'DICE TALENT';
    if (offer.isDiceTokenOffer) return 'DICE TOKEN VAULT';
    if (offer.isCasinoChipOffer) return offer.isFreebie ? '★ DAILY FREEBIE — CASINO CHIPS' : 'CASINO CHIP STACK';
    if (offer.isFreebie) {
      if (offer.isDiamondFreebie) return '★ DAILY FREEBIE — DIAMONDS';
      return offer.typeId ? `★ DAILY FREEBIE — ${offer.rarity.toUpperCase()}` : '★ DAILY FREEBIE';
    }
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
    const isFrebieClaimed = offer.isFreebie && shopState.claimedFreebieIds.includes(offer.id);
    const isInfiniteOffer = this.isInfiniteCurrencyOffer(offer);
    const effectivelyClaimed = !isInfiniteOffer && (isClaimed || isFrebieClaimed);
    const canAfford = offer.isFreebie ? true : (offer.diceTokenCost !== undefined ? getDiceTokens(this) >= offer.diceTokenCost : getDiamonds(this) >= offer.diamondCost);

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
      ...RARITY_TEXT_COLORS, Diamond: '#7ec8e3', Casino: '#f4b860'
    };
    const headerColor = effectivelyClaimed ? PALETTE.textMuted : (rarityColors[offer.rarity] ?? PALETTE.accentSoft);
    if (offer.isFreebie && offer.typeId) {
      const prefixTag = this.add.text(x + CARD_W / 2 - 12, y + 10, '★ DAILY FREEBIE —', {
        fontFamily: 'Orbitron', fontSize: '13px', color: effectivelyClaimed ? PALETTE.textMuted : PALETTE.text
      }).setOrigin(1, 0);
      const rarityTag = this.add.text(x + CARD_W / 2 - 6, y + 10, offer.rarity.toUpperCase(), {
        fontFamily: 'Orbitron', fontSize: '13px', color: headerColor
      }).setOrigin(0, 0);
      objs.push(prefixTag, rarityTag);
    } else {
      const headerTag = this.add.text(x + CARD_W / 2, y + 10, headerLabel, {
        fontFamily: 'Orbitron', fontSize: offer.isFreebie ? '13px' : '12px', color: headerColor
      }).setOrigin(0.5, 0);
      objs.push(headerTag);
    }

    const offerDefinition = offer.typeId
      ? getAllDiceDefinitions(this).find((def) => def.typeId === offer.typeId)
      : undefined;
    const offerTalent = offerDefinition && offer.talentIndex !== undefined
      ? getTalentByIndex(offerDefinition, offer.talentIndex)
      : undefined;
    const nameLine = offer.isCasinoChipOffer
      ? 'Casino Chips'
      : (offer.isCoinOffer
        ? (offer.isDiamondFreebie ? 'Diamonds' : (offer.isCasinoChipOffer ? 'Casino Chips' : 'Dice Tokens'))
        : (offer.isTalentOffer
          ? (offerTalent?.title ?? 'Talent')
          : (offer.typeId ? (offerDefinition?.title ?? offer.typeId) : '—')));
    const nameText = this.add.text(x + 8, y + 48, nameLine.toUpperCase(), {
      fontFamily: 'Orbitron', fontSize: '17px', color: effectivelyClaimed ? PALETTE.textMuted : (offer.isFreebie ? '#8ae0a1' : accentHex)
    });
    objs.push(nameText);

    const firstTokenPurchase = this.isFirstDiceTokenPurchase(shopState, offer);
    const firstChipPurchase = this.isFirstCasinoChipPurchase(shopState, offer);
    const tokenAmount = offer.coinAmount * (firstTokenPurchase ? 2 : 1);
    const chipAmount = offer.coinAmount * (firstChipPurchase ? 2 : 1);
    const descLine = offer.isTalentOffer
      ? `${offerDefinition?.title ?? offer.typeId} — talent unlock`
      : (offer.isCasinoChipOffer
      ? `+${formatCompact(chipAmount)} Casino Chips${firstChipPurchase ? ' (2× first buy)' : ''}`
      : (offer.isCoinOffer
        ? `+${formatCompact(offer.isCasinoChipOffer ? chipAmount : tokenAmount)} ${offer.isDiamondFreebie ? 'Diamonds' : (offer.isCasinoChipOffer ? 'Casino Chips' : 'Dice Tokens')}${firstTokenPurchase && !offer.isDiamondFreebie && !offer.isCasinoChipOffer ? ' (2× first buy)' : ''}`
        : `×${formatCompact(offer.copies)} ${offer.copies === 1 ? 'copy' : 'copies'}`));
    const descText = this.add.text(x + 8, y + 80, descLine, {
      fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.text
    });
    objs.push(descText);

    if (!offer.isCoinOffer && offer.typeId) {
      const progress = getDiceProgress(this, offer.typeId);
      const progressLine = offer.isTalentOffer
        ? `Unlocks for ${offerDefinition?.title ?? offer.typeId}  •  C${progress.classLevel}/15`
        : canReceiveUsefulCopies(this, offer.typeId)
          ? `Current: C${progress.classLevel}/15  •  ${formatCompact(progress.copies)} copies`
          : 'MAXED OUT';
      const progressText = this.add.text(x + 8, y + 108, progressLine, {
        fontFamily: 'Orbitron', fontSize: '11px', color: progressLine === 'MAXED OUT' ? PALETTE.success : PALETTE.textMuted
      });
      objs.push(progressText);
    }

    const costLine = offer.isFreebie ? 'FREE' : (offer.diceTokenCost !== undefined ? `${formatCompact(offer.diceTokenCost)} DT` : `◆ ${formatCompact(offer.diamondCost)}`);
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
      btnLabel = offer.diceTokenCost !== undefined ? 'NOT ENOUGH DT' : 'NOT ENOUGH ◆';
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
