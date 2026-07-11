import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

function MiniChampionshipTrophy() {
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
            </View>
            <View style={styles.champStarMedallion}>
              <Ionicons name="star" size={9} color="#fff6cc" />
            </View>
          </View>
        </View>
      </View>
      <View style={styles.champStem} />
      <View style={styles.champPlinth}>
        <View style={styles.champPlinthCap} />
        <View style={styles.champPlinthBody} />
      </View>
    </View>
  );
}

function MiniWineTrophy() {
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
            </View>
            <View style={styles.wineGrapeMedallion}>
              <MaterialCommunityIcons name="fruit-grapes" size={10} color="#f0d4e4" />
            </View>
          </View>
        </View>
      </View>
      <View style={styles.wineStem} />
      <View style={styles.winePlinth}>
        <View style={styles.winePlinthCap} />
        <View style={styles.winePlinthBody} />
      </View>
    </View>
  );
}

function HeroTrophyBadge({ count, type }) {
  const isWine = type === 'wine';
  const displayCount = Number(count) || 0;

  return (
    <View style={styles.badge}>
      <View style={styles.countPill}>
        <Text style={styles.countText}>{displayCount}</Text>
      </View>
      <View style={[styles.trophyFrame, isWine ? styles.trophyFrameWine : styles.trophyFrameChamp]}>
        {isWine ? <MiniWineTrophy /> : <MiniChampionshipTrophy />}
      </View>
    </View>
  );
}

export default function PlayerHeroTrophyBadges({ championships = 0, wineTrophies = 0 }) {
  return (
    <View style={styles.row} pointerEvents="none">
      <HeroTrophyBadge count={championships} type="championship" />
      <HeroTrophyBadge count={wineTrophies} type="wine" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  badge: {
    alignItems: 'center',
    minWidth: 42,
  },
  countPill: {
    minWidth: 22,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    zIndex: 2,
  },
  countText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13,
  },
  trophyFrame: {
    width: 42,
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 2,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  trophyFrameChamp: {
    backgroundColor: '#fff9e8',
    borderColor: '#e8c96a',
  },
  trophyFrameWine: {
    backgroundColor: '#fff5f8',
    borderColor: '#d8a8bc',
  },
  champVisual: {
    width: 34,
    height: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  champAura: {
    position: 'absolute',
    top: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(212, 175, 55, 0.18)',
  },
  champCupWrap: {
    width: 30,
    height: 24,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  champHandleLeft: {
    position: 'absolute',
    left: 0,
    top: 8,
    width: 6,
    height: 10,
    borderWidth: 1.5,
    borderColor: '#c9a227',
    borderRightWidth: 0,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  champHandleRight: {
    position: 'absolute',
    right: 0,
    top: 8,
    width: 6,
    height: 10,
    borderWidth: 1.5,
    borderColor: '#c9a227',
    borderLeftWidth: 0,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  champCupOuter: {
    width: 22,
    height: 18,
    alignItems: 'center',
  },
  champCupLid: {
    width: 16,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#e6c35c',
    marginBottom: 1,
  },
  champCupRim: {
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#f0d878',
  },
  champCupInner: {
    width: 20,
    height: 12,
    marginTop: -1,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  champCupGoldFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#d4af37',
  },
  champCupGoldBand: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#f5e6a8',
  },
  champStarMedallion: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#b8860b',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#f5e6a8',
  },
  champStem: {
    width: 8,
    height: 4,
    backgroundColor: '#c9a227',
    marginTop: 1,
  },
  champPlinth: {
    alignItems: 'center',
  },
  champPlinthCap: {
    width: 16,
    height: 2,
    backgroundColor: '#8b6914',
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
  },
  champPlinthBody: {
    width: 24,
    height: 5,
    backgroundColor: '#5c4a38',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  wineVisual: {
    width: 34,
    height: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  wineAura: {
    position: 'absolute',
    top: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(180, 90, 120, 0.14)',
  },
  wineCupWrap: {
    width: 30,
    height: 24,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  wineHandleLeft: {
    position: 'absolute',
    left: 0,
    top: 8,
    width: 6,
    height: 10,
    borderWidth: 1.5,
    borderColor: '#9b4d6a',
    borderRightWidth: 0,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  wineHandleRight: {
    position: 'absolute',
    right: 0,
    top: 8,
    width: 6,
    height: 10,
    borderWidth: 1.5,
    borderColor: '#9b4d6a',
    borderLeftWidth: 0,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  wineCupOuter: {
    width: 22,
    height: 18,
    alignItems: 'center',
  },
  wineCupRim: {
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#c97898',
  },
  wineCupInner: {
    width: 20,
    height: 14,
    marginTop: -1,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wineLiquidBody: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#7a2040',
  },
  wineLiquidSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#a83258',
  },
  wineGrapeMedallion: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#6b2844',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#d8a8bc',
  },
  wineStem: {
    width: 8,
    height: 4,
    backgroundColor: '#9b4d6a',
    marginTop: 1,
  },
  winePlinth: {
    alignItems: 'center',
  },
  winePlinthCap: {
    width: 16,
    height: 2,
    backgroundColor: '#6b2844',
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
  },
  winePlinthBody: {
    width: 24,
    height: 5,
    backgroundColor: '#4a2030',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
});
