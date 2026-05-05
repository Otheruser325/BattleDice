import Phaser from 'phaser';
import { PALETTE, drawPanel } from '../ui/theme';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { evaluateFivesCombo, type ChestType } from '../systems/CasinoComboTypes';
import { AlertManager } from '../utils/AlertManager';
import { getAllDiceDefinitions, getDiceProgress, setDiceProgress } from '../data/dice';

export class CasinoScene extends Phaser.Scene {
  static readonly KEY = 'CasinoScene';
  private dice: number[] = [1, 1, 1, 1, 1];
  private locks: boolean[] = [false, false, false, false, false];
  private rollsLeft = 3;
  private diceTexts: Phaser.GameObjects.Text[] = [];
  private chestTexts = new Map<ChestType, Phaser.GameObjects.Text>();
  private statusText!: Phaser.GameObjects.Text;
  private tableActive = false;

  constructor() { super(CasinoScene.KEY); }

  create() {
    const panel = drawPanel(this, 'CASINO', 'TABLES + CHESTS');
    this.add.rectangle(panel.centerX, panel.centerY - 10, 780, 360, 0x173247, 0.92).setStrokeStyle(1, 0x4f7ea1);
    this.statusText = this.add.text(panel.centerX, panel.y + 88, 'Fives Roller: pay 10 chips to start a 3-roll hand.', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted }).setOrigin(0.5);
    this.drawDiceRow(panel.centerX, panel.centerY - 72);
    this.drawButtons(panel.centerX, panel.centerY + 4);
    this.drawChestSidebar(panel.right - 145, panel.y + 112);
    this.render();
  }

  private drawDiceRow(cx: number, y: number) { for (let i=0;i<5;i++){ const x=cx-160+i*80; this.add.rectangle(x,y,62,62,0x183447,1).setStrokeStyle(1,0x3a6688); const d=this.add.text(x,y-8,'1',{fontFamily:'Orbitron',fontSize:'28px',color:PALETTE.text}).setOrigin(0.5); const l=this.add.text(x,y+22,'UNLOCK',{fontFamily:'Orbitron',fontSize:'9px',color:PALETTE.textMuted,backgroundColor:'#173247',padding:{left:4,right:4,top:2,bottom:2}}).setOrigin(0.5).setInteractive({useHandCursor:true}); l.on('pointerdown',()=>{ if(this.rollsLeft>=3||this.rollsLeft<=0)return; this.locks[i]=!this.locks[i]; l.setText(this.locks[i]?'LOCKED':'UNLOCK');}); this.diceTexts.push(d);} }

  private drawButtons(cx:number,y:number){ const mk=(x:number,label:string,fn:()=>void)=>{const t=this.add.text(x,y,label,{fontFamily:'Orbitron',fontSize:'12px',color:'#000',backgroundColor:'#f4b860',padding:{left:10,right:10,top:6,bottom:6}}).setOrigin(0.5).setInteractive({useHandCursor:true}); t.on('pointerdown',fn);}; mk(cx-180,'START FIVES (10)',()=>this.startFives()); mk(cx-40,'ROLL',()=>this.rollDice()); mk(cx+70,'CASH OUT',()=>this.cashOut()); mk(cx+190,'CRAPS (2)',()=>this.playCraps()); }

  private drawChestSidebar(x:number,y:number){
    this.add.text(x, y - 26, 'CHESTS', { fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.accent }).setOrigin(0.5);
    (['Bronze', 'Silver', 'Gold', 'Diamond', 'Master'] as ChestType[]).forEach((type, idx) => {
      const rowY = y + idx * 48;
      const lbl = this.add.text(x - 30, rowY, `${type}: 0`, { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.text }).setOrigin(0, 0.5);
      const openBtn = this.add.text(x + 70, rowY - 10, 'Open', { fontFamily: 'Orbitron', fontSize: '10px', color: '#dff4ff', backgroundColor: '#2878b8', padding: { left: 6, right: 6, top: 3, bottom: 3 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const allBtn = this.add.text(x + 70, rowY + 10, 'Open All!', { fontFamily: 'Orbitron', fontSize: '10px', color: '#eaffea', backgroundColor: '#2c9b52', padding: { left: 6, right: 6, top: 3, bottom: 3 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      openBtn.on('pointerdown', () => this.openChestModal(type));
      allBtn.on('pointerdown', () => this.openChestModal(type));
      this.chestTexts.set(type, lbl);
    });
  }

  private startFives(){const p=CasinoProgressStore.get(this); if(this.tableActive)return AlertManager.toast(this,{type:'warning',message:'Finish current table first.'}); if(p.chips<10)return AlertManager.toast(this,{type:'warning',message:'Need 10 chips for Fives.'}); CasinoProgressStore.mutate(this,c=>({...c,chips:c.chips-10})); this.rollsLeft=3; this.tableActive=true; this.locks=[false,false,false,false,false]; this.rollDice(); this.render();}
  private rollDice(){ if(!this.tableActive||this.rollsLeft<=0)return; this.dice=this.dice.map((v,i)=>this.locks[i]?v:Phaser.Math.Between(1,6)); this.rollsLeft-=1; this.render(); }
  private cashOut(){ if(!this.tableActive||this.rollsLeft===3)return; const p=evaluateFivesCombo(this.dice); CasinoProgressStore.mutate(this,c=>({...c,chests:{...c.chests,[p.chestType]:c.chests[p.chestType]+p.chestCount}})); this.tableActive=false; this.rollsLeft=3; this.locks=[false,false,false,false,false]; this.render(); }
  private playCraps(){const p=CasinoProgressStore.get(this); if(this.tableActive)return AlertManager.toast(this,{type:'warning',message:'Finish current table first.'}); if(p.chips<2)return AlertManager.toast(this,{type:'warning',message:'Need 2 chips for Craps.'}); CasinoProgressStore.mutate(this,c=>({...c,chips:c.chips-2,chests:{...c.chests,Bronze:c.chests.Bronze+Phaser.Math.Between(1,6)}})); this.render(); }

  private openChestModal(type: ChestType) {
    const progress = CasinoProgressStore.get(this);
    const amount = progress.chests[type];
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width/2,height/2,width,height,0x000000,0.55).setInteractive();
    const panel = this.add.rectangle(width/2,height/2,560,320,0x153449,0.97).setStrokeStyle(2,0x4f7ea1);
    const title = this.add.text(width/2,height/2-120,`${type} Chest`,{fontFamily:'Orbitron',fontSize:'24px',color:PALETTE.accent}).setOrigin(0.5);
    const chest = this.add.rectangle(width/2,height/2-20,120,90,0x2f5f80,0.95).setStrokeStyle(2,0x8fd5ff);
    const count = this.add.text(width/2,height/2+42,`Available: ${amount}`,{fontFamily:'Orbitron',fontSize:'12px',color:PALETTE.textMuted}).setOrigin(0.5);

    const close = () => [overlay,panel,title,chest,count,open,openAll,closeBtn].forEach((o)=>o.destroy());
    const doOpen = (all:boolean) => {
      const latest = CasinoProgressStore.get(this).chests[type];
      const openCount = all ? latest : Math.min(1, latest);
      if (openCount <= 0) return AlertManager.toast(this, { type: 'warning', message: `No ${type} chests available.` });
      this.openChests(type, openCount, all);
      close();
    };

    const open = this.add.text(width/2-90,height/2+92,'Open',{fontFamily:'Orbitron',fontSize:'13px',color:'#dff4ff',backgroundColor:amount>0?'#2878b8':'#5d6770',padding:{left:12,right:12,top:6,bottom:6}}).setOrigin(0.5).setInteractive({useHandCursor:true});
    const openAll = this.add.text(width/2+90,height/2+92,'Open All!',{fontFamily:'Orbitron',fontSize:'13px',color:'#eaffea',backgroundColor:amount>0?'#2c9b52':'#5d6770',padding:{left:12,right:12,top:6,bottom:6}}).setOrigin(0.5).setInteractive({useHandCursor:true});
    const closeBtn = this.add.text(width/2,height/2+130,'Close',{fontFamily:'Orbitron',fontSize:'11px',color:PALETTE.textMuted,backgroundColor:'#173247',padding:{left:8,right:8,top:4,bottom:4}}).setOrigin(0.5).setInteractive({useHandCursor:true});
    open.on('pointerdown',()=>doOpen(false)); openAll.on('pointerdown',()=>doOpen(true)); closeBtn.on('pointerdown',close); overlay.on('pointerdown',close);
  }

  private openChests(type: ChestType, openCount: number, isAll: boolean) {
    CasinoProgressStore.mutate(this, (p) => ({ ...p, chests: { ...p.chests, [type]: Math.max(0, p.chests[type] - openCount) } }));
    const defs = getAllDiceDefinitions(this);
    const lines: string[] = [];
    for (let i = 0; i < openCount; i++) {
      const pick = defs[Math.floor(Math.random() * defs.length)]; if (!pick) continue;
      const prog = getDiceProgress(this, pick.typeId); const wasLocked = prog.copies <= 0; const copies = Phaser.Math.Between(1, 5);
      setDiceProgress(this, pick.typeId, { classLevel: prog.classLevel, copies: prog.copies + copies });
      lines.push(`${pick.title}: +${copies}${wasLocked ? ' [NEW]' : ''}`);
    }
    const burst = this.add.rectangle(this.scale.width/2,this.scale.height/2,120,90,0x8fd5ff,0.25).setStrokeStyle(2,0xffffff).setDepth(9999);
    this.tweens.add({targets:burst,scale:isAll?4:2,alpha:0,duration:isAll?520:320,onComplete:()=>burst.destroy()});
    AlertManager.show(this, { type: 'success', title: `${type} Rewards`, message: lines.slice(0, 16).join('\n') || 'No rewards generated.' });
    this.render();
  }

  private render(){ if(!this.scene.isActive())return; this.diceTexts.forEach((t,i)=>{if(t?.scene)t.setText(String(this.dice[i]??1));}); const p=CasinoProgressStore.get(this); this.statusText.setText(this.tableActive?`Rolls left: ${this.rollsLeft}`:'Fives Roller: pay 10 chips to start a 3-roll hand.'); this.chestTexts.forEach((t,type)=>t.setText(`${type}: ${p.chests[type]}`)); }
}
