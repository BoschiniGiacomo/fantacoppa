import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

function formatTrophyYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return '—';
  return `'${String(y).slice(-2)}`;
}

function YearPlaque({ year }) {
  return (
    <View style={styles.plaque}>
      <View style={styles.plaqueInner}>
        <Text style={styles.plaqueYear}>{formatTrophyYear(year)}</Text>
      </View>
    </View>
  );
}

function ChampionshipTrophyVisual() {
  return (
    <View style={styles.champVisual}>
      <View style={styles.champAura} />
      <View style={styles.champCupWrap}>
        <View style={styles.champHandleLeft} />
        <View style={styles.champHandleRight} />
        <View style={styles.champCupOuter}>
          <View style={styles.champCupLid} />
          <View style={styles.champCupRim} />
          <View style={styles.champCupInner}>
            <View style={styles.champCupGoldFill}>
              <View style={styles.champCupGoldBand} />
              <View style={styles.champCupGoldDepth} />
            </View>
            <View style={styles.champStarMedallion}>
              <View style={styles.champStarHalo} />
              <Ionicons name="star" size={16} color="#fff6cc" />
            </View>
            <View style={styles.champCupShineLeft} />
            <View style={styles.champCupShineRight} />
          </View>
        </View>
      </View>
      <View style={styles.champStem}>
        <View style={styles.champStemRing} />
      </View>
      <View style={styles.champPlinth}>
        <View style={styles.champPlinthCap} />
        <View style={styles.champPlinthBody}>
          <View style={styles.champPlinthInset} />
        </View>
      </View>
    </View>
  );
}

function WineTrophyVisual() {
  return (
    <View style={styles.wineVisual}>
      <View style={styles.wineAura} />
      <View style={styles.wineCupWrap}>
        <View style={styles.wineHandleLeft} />
        <View style={styles.wineHandleRight} />
        <View style={styles.wineCupOuter}>
          <View style={styles.wineCupRim} />
          <View style={styles.wineCupInner}>
            <View style={styles.wineLiquidBody}>
              <View style={styles.wineLiquidSurface} />
              <View style={styles.wineLiquidGlow} />
            </View>
            <View style={styles.wineGrapeMedallion}>
              <View style={styles.wineGrapeHalo} />
              <MaterialCommunityIcons name="fruit-grapes" size={17} color="#f0d4e4" />
            </View>
            <View style={styles.wineCupShineLeft} />
            <View style={styles.wineCupShineRight} />
          </View>
        </View>
      </View>
      <View style={styles.wineStem}>
        <View style={styles.wineStemRing} />
      </View>
      <View style={styles.winePlinth}>
        <View style={styles.winePlinthCap} />
        <View style={styles.winePlinthBody}>
          <View style={styles.winePlinthInset} />
        </View>
      </View>
    </View>
  );
}

const TROPHIES_PER_ROW = 3;

function TrophySlot({ type, year }) {
  const isWine = type === 'wine';
  return (
    <View style={styles.slot}>
      <View style={[styles.slotAlcove, isWine ? styles.slotAlcoveWine : styles.slotAlcoveChamp]}>
        <View style={[styles.slotSpotlight, isWine ? styles.slotSpotlightWine : styles.slotSpotlightChamp]} />
        <View style={[styles.slotPedestal, isWine ? styles.slotPedestalWine : styles.slotPedestalChamp]}>
          {isWine ? <WineTrophyVisual /> : <ChampionshipTrophyVisual />}
        </View>
      </View>
      <View style={styles.plaqueRow}>
        <View style={styles.plaquePin} />
        <YearPlaque year={year} />
        <View style={styles.plaquePin} />
      </View>
    </View>
  );
}

function TrophyShelf({ title, trophies, type, emptyHint }) {
  const isWine = type === 'wine';
  const rows = [];
  for (let i = 0; i < trophies.length; i += TROPHIES_PER_ROW) {
    rows.push(trophies.slice(i, i + TROPHIES_PER_ROW));
  }
  return (
    <View style={styles.shelfBlock}>
      <View style={[styles.shelfNameplate, isWine ? styles.shelfNameplateWine : styles.shelfNameplateChamp]}>
        <Text style={styles.shelfNameplateText}>{title}</Text>
        {trophies.length > 0 ? (
          <View style={styles.shelfNameplateCount}>
            <Text style={styles.shelfNameplateCountText}>{trophies.length}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.shelfRecess}>
        <View style={[styles.shelfBackdrop, isWine ? styles.shelfBackdropWine : styles.shelfBackdropChamp]} />
        <View style={[styles.shelfPlank, isWine ? styles.shelfPlankWine : styles.shelfPlankChamp]}>
          <View style={styles.shelfPlankLip} />
          {trophies.length > 0 ? (
            <View style={styles.shelfGrid}>
              {rows.map((row, rowIndex) => (
                <View key={`${type}-row-${rowIndex}`} style={styles.shelfRow}>
                  {row.map((t) => (
                    <TrophySlot key={`${type}-${t.year}`} type={type} year={t.year} />
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.shelfEmpty}>{emptyHint}</Text>
          )}
        </View>
        <View style={styles.shelfUndershadow} />
      </View>
    </View>
  );
}

export default function OfficialTeamTrophyBoard({ championships = [], wineTrophies = [] }) {
  const champList = Array.isArray(championships) ? championships : [];
  const wineList = Array.isArray(wineTrophies) ? wineTrophies : [];
  const total = champList.length + wineList.length;

  if (total === 0) {
    return (
      <View style={styles.boardWall}>
        <View style={styles.boardFrame}>
          <View style={styles.boardFrameInner}>
            <View style={styles.boardTitlePlate}>
              <Text style={styles.boardTitle}>Bacheca trofei</Text>
            </View>
            <View style={styles.emptyCabinet}>
              <View style={styles.emptyGlow} />
              <MaterialCommunityIcons name="trophy-outline" size={48} color="#5c4a3a" />
              <Text style={styles.emptyTitle}>Bacheca vuota</Text>
              <Text style={styles.emptyText}>
                I trofei conquistati verranno esposti qui,{'\n'}sulla mensola con la targhetta dell&apos;anno.
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.boardWall}>
      <View style={styles.boardFrame}>
        <View style={styles.boardFrameBevelTop} />
        <View style={styles.boardFrameInner}>
          <View style={styles.boardTitlePlate}>
            <View style={styles.boardTitlePlateInset} />
            <Text style={styles.boardTitle}>Bacheca trofei</Text>
          </View>
          <View style={styles.boardVelvet} />
          <View style={styles.boardGlass} pointerEvents="none" />
          <View style={styles.cabinetInner}>
            <TrophyShelf
              title="Campionato"
              trophies={champList}
              type="championship"
              emptyHint="Nessun titolo esposto"
            />
            <View style={styles.shelfDivider} />
            <TrophyShelf
              title="Trofeo del Vino"
              trophies={wineList}
              type="wine"
              emptyHint="Nessun trofeo del Vino"
            />
          </View>
        </View>
        <View style={styles.boardFrameBevelBottom} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  boardWall: {
    width: '100%',
  },
  boardFrame: {
    borderRadius: 14,
    borderWidth: 3,
    borderColor: '#5c4028',
    backgroundColor: '#3d2818',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  boardFrameBevelTop: {
    height: 5,
    backgroundColor: '#7a5535',
    borderBottomWidth: 1,
    borderBottomColor: '#2a1c10',
  },
  boardFrameBevelBottom: {
    height: 6,
    backgroundColor: '#2a1c10',
    borderTopWidth: 1,
    borderTopColor: '#6b4a2e',
  },
  boardFrameInner: {
    backgroundColor: '#1f1610',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
    position: 'relative',
    overflow: 'hidden',
  },
  boardTitlePlate: {
    alignSelf: 'center',
    marginBottom: 14,
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#8b6914',
    borderWidth: 1.5,
    borderColor: '#c9a227',
    position: 'relative',
    zIndex: 3,
  },
  boardTitlePlateInset: {
    ...StyleSheet.absoluteFillObject,
    margin: 2,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,230,160,0.25)',
  },
  boardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff3d4',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  boardVelvet: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#241a14',
    opacity: 0.92,
  },
  boardGlass: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    zIndex: 0,
  },
  cabinetInner: {
    gap: 16,
    zIndex: 2,
    position: 'relative',
  },
  shelfDivider: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3d2818',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#5c4028',
    marginVertical: 2,
  },
  shelfBlock: {
    gap: 0,
  },
  shelfNameplate: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderBottomWidth: 0,
    marginLeft: 8,
  },
  shelfNameplateChamp: {
    backgroundColor: '#4a3818',
    borderColor: '#7a5a20',
  },
  shelfNameplateWine: {
    backgroundColor: '#3a1828',
    borderColor: '#6b3050',
  },
  shelfNameplateText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#e8d4b0',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  shelfNameplateCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  shelfNameplateCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#f5e6c8',
    fontVariant: ['tabular-nums'],
  },
  shelfRecess: {
    position: 'relative',
    paddingBottom: 8,
  },
  shelfBackdrop: {
    ...StyleSheet.absoluteFillObject,
    top: 0,
    bottom: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  shelfBackdropChamp: {
    backgroundColor: '#1a140e',
    borderColor: '#3d3018',
  },
  shelfBackdropWine: {
    backgroundColor: '#160e12',
    borderColor: '#3d2030',
  },
  shelfPlank: {
    marginTop: 2,
    borderRadius: 6,
    borderWidth: 1,
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 6,
    position: 'relative',
    overflow: 'visible',
  },
  shelfPlankChamp: {
    backgroundColor: '#4a3820',
    borderColor: '#6b5428',
  },
  shelfPlankWine: {
    backgroundColor: '#3d2030',
    borderColor: '#5c3048',
  },
  shelfPlankLip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -5,
    height: 6,
    backgroundColor: '#2a2014',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#1a120c',
  },
  shelfUndershadow: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 0,
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 4,
  },
  shelfGrid: {
    gap: 6,
  },
  shelfRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 8,
    width: '100%',
  },
  shelfEmpty: {
    textAlign: 'center',
    color: '#6b5a48',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 28,
  },
  slot: {
    alignItems: 'center',
    width: 82,
    gap: 6,
  },
  slotAlcove: {
    width: 76,
    height: 96,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  slotAlcoveChamp: {
    backgroundColor: '#120e08',
    borderColor: '#3d3018',
  },
  slotAlcoveWine: {
    backgroundColor: '#10080c',
    borderColor: '#3d2030',
  },
  slotSpotlight: {
    position: 'absolute',
    top: -6,
    width: 50,
    height: 50,
    borderRadius: 25,
    opacity: 0.9,
  },
  slotSpotlightChamp: {
    backgroundColor: 'rgba(245, 215, 110, 0.12)',
  },
  slotSpotlightWine: {
    backgroundColor: 'rgba(200, 90, 120, 0.12)',
  },
  slotPedestal: {
    width: 68,
    height: 84,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
    borderWidth: 1,
    marginTop: 8,
  },
  slotPedestalChamp: {
    backgroundColor: '#18140c',
    borderColor: '#4a3a18',
  },
  slotPedestalWine: {
    backgroundColor: '#140c10',
    borderColor: '#4a2840',
  },
  plaque: {
    paddingHorizontal: 2,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#6b5420',
    borderWidth: 1,
    borderColor: '#a8842a',
    minWidth: 44,
    alignItems: 'center',
  },
  plaqueInner: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#c9a227',
    borderWidth: 1,
    borderColor: '#8b6914',
  },
  plaqueYear: {
    fontSize: 12,
    fontWeight: '900',
    color: '#2a1a05',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  plaqueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  plaquePin: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#5c4a38',
    borderWidth: 0.5,
    borderColor: '#8b7358',
  },
  champVisual: {
    width: 56,
    height: 76,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  champAura: {
    position: 'absolute',
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    shadowColor: '#f5d76e',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  champCupWrap: {
    width: 50,
    height: 40,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  champHandleLeft: {
    position: 'absolute',
    left: 0,
    top: 10,
    width: 11,
    height: 24,
    borderWidth: 2.5,
    borderColor: '#e8c547',
    borderRightWidth: 0,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    opacity: 0.9,
  },
  champHandleRight: {
    position: 'absolute',
    right: 0,
    top: 10,
    width: 11,
    height: 24,
    borderWidth: 2.5,
    borderColor: '#e8c547',
    borderLeftWidth: 0,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    opacity: 0.9,
  },
  champCupOuter: {
    width: 34,
    height: 36,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    borderWidth: 1.5,
    borderColor: '#f0d060',
    backgroundColor: '#a88420',
    overflow: 'hidden',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  champCupLid: {
    position: 'absolute',
    top: -3,
    width: 14,
    height: 6,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    backgroundColor: '#f5d76e',
    borderWidth: 1,
    borderColor: '#d4af37',
    zIndex: 3,
  },
  champCupRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: 'rgba(255,245,200,0.25)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  champCupInner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 5,
    paddingBottom: 3,
  },
  champCupGoldFill: {
    ...StyleSheet.absoluteFillObject,
    top: 6,
    backgroundColor: '#c9a227',
  },
  champCupGoldBand: {
    position: 'absolute',
    top: 8,
    left: 4,
    right: 4,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,230,150,0.35)',
  },
  champCupGoldDepth: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: 'rgba(90, 60, 10, 0.25)',
  },
  champStarMedallion: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120, 85, 15, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 230, 160, 0.45)',
    zIndex: 4,
  },
  champStarHalo: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 240, 180, 0.15)',
  },
  champCupShineLeft: {
    position: 'absolute',
    top: 8,
    left: 5,
    width: 4,
    height: 16,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    zIndex: 5,
  },
  champCupShineRight: {
    position: 'absolute',
    top: 12,
    right: 6,
    width: 2,
    height: 9,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    zIndex: 5,
  },
  champStem: {
    width: 5,
    height: 11,
    marginTop: 1,
    backgroundColor: '#c9a227',
    borderRadius: 2,
    alignItems: 'center',
    zIndex: 1,
  },
  champStemRing: {
    position: 'absolute',
    top: 3,
    width: 9,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#f0d060',
  },
  champPlinth: {
    alignItems: 'center',
    marginTop: 1,
  },
  champPlinthCap: {
    width: 18,
    height: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: '#d4af37',
  },
  champPlinthBody: {
    width: 34,
    height: 9,
    borderRadius: 3,
    backgroundColor: '#3d3010',
    borderWidth: 1,
    borderColor: '#6b5420',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  champPlinthInset: {
    width: 22,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  wineVisual: {
    width: 56,
    height: 76,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  wineAura: {
    position: 'absolute',
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(140, 40, 70, 0.22)',
    shadowColor: '#c45c7a',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  wineCupWrap: {
    width: 50,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  wineHandleLeft: {
    position: 'absolute',
    left: 0,
    top: 8,
    width: 10,
    height: 22,
    borderWidth: 2,
    borderColor: '#9a4a62',
    borderRightWidth: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    opacity: 0.85,
  },
  wineHandleRight: {
    position: 'absolute',
    right: 0,
    top: 8,
    width: 10,
    height: 22,
    borderWidth: 2,
    borderColor: '#9a4a62',
    borderLeftWidth: 0,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    opacity: 0.85,
  },
  wineCupOuter: {
    width: 36,
    height: 34,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#b86a84',
    backgroundColor: '#5a2038',
    overflow: 'hidden',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  wineCupRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: 'rgba(255,220,230,0.18)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  wineCupInner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 3,
  },
  wineLiquidBody: {
    ...StyleSheet.absoluteFillObject,
    top: 14,
    backgroundColor: '#4a1028',
  },
  wineLiquidSurface: {
    position: 'absolute',
    top: 0,
    left: -4,
    right: -4,
    height: 7,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: '#7a1f42',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,180,200,0.35)',
  },
  wineLiquidGlow: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    width: 14,
    height: 8,
    borderRadius: 7,
    backgroundColor: 'rgba(255,120,160,0.12)',
  },
  wineGrapeMedallion: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(90, 30, 50, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(230, 170, 190, 0.35)',
    zIndex: 4,
  },
  wineGrapeHalo: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 200, 220, 0.1)',
  },
  wineCupShineLeft: {
    position: 'absolute',
    top: 8,
    left: 5,
    width: 4,
    height: 14,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    zIndex: 5,
  },
  wineCupShineRight: {
    position: 'absolute',
    top: 12,
    right: 6,
    width: 2,
    height: 8,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    zIndex: 5,
  },
  wineStem: {
    width: 5,
    height: 12,
    marginTop: 1,
    backgroundColor: '#8a4560',
    borderRadius: 2,
    alignItems: 'center',
    zIndex: 1,
  },
  wineStemRing: {
    position: 'absolute',
    top: 3,
    width: 9,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#c47a94',
  },
  winePlinth: {
    alignItems: 'center',
    marginTop: 1,
  },
  winePlinthCap: {
    width: 18,
    height: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: '#9a5a72',
  },
  winePlinthBody: {
    width: 34,
    height: 9,
    borderRadius: 3,
    backgroundColor: '#2a1420',
    borderWidth: 1,
    borderColor: '#5c3048',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  winePlinthInset: {
    width: 22,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  emptyCabinet: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#1a120c',
    borderWidth: 1,
    borderColor: '#3d3018',
    overflow: 'hidden',
    minHeight: 200,
  },
  emptyGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(139, 105, 20, 0.08)',
    top: 20,
  },
  emptyTitle: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '800',
    color: '#c9a87c',
  },
  emptyText: {
    marginTop: 8,
    fontSize: 13,
    color: '#6b5a48',
    textAlign: 'center',
    lineHeight: 19,
  },
});
