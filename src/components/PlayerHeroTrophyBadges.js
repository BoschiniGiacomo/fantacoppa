import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

function MiniChampionshipTrophy() {
  return (
    <View style={styles.champVisual}>
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
      <View style={[styles.trophyAnchor, isWine ? styles.trophyAnchorWine : null]}>
        <View style={styles.trophyVisualScale}>
          {isWine ? <MiniWineTrophy /> : <MiniChampionshipTrophy />}
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{displayCount}</Text>
        </View>
      </View>
    </View>
  );
}

export default function PlayerHeroTrophyBadges({ championships = 0, wineTrophies = 0 }) {
  const champCount = Number(championships) || 0;
  const wineCount = Number(wineTrophies) || 0;
  const items = [];

  if (champCount > 0) {
    items.push({ key: 'championship', count: champCount, type: 'championship' });
  }
  if (wineCount > 0) {
    items.push({ key: 'wine', count: wineCount, type: 'wine' });
  }

  if (!items.length) return null;

  return (
    <View style={styles.row} pointerEvents="none">
      {items.map((item) => (
        <HeroTrophyBadge key={item.key} count={item.count} type={item.type} />
      ))}
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
    minWidth: 40,
  },
  trophyAnchor: {
    position: 'relative',
    width: 38,
    height: 46,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  trophyAnchorWine: {
    height: 44,
  },
  trophyVisualScale: {
    transform: [{ scale: 1.12 }],
    marginBottom: 6,
  },
  countBadge: {
    position: 'absolute',
    right: -3,
    bottom: 0,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  countText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
  champVisual: {
    width: 34,
    height: 38,
    alignItems: 'center',
    justifyContent: 'flex-end',
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
    height: 38,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  wineCupWrap: {
    width: 30,
    height: 17,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 2,
    marginTop: -3,
  },
  wineHandleLeft: {
    position: 'absolute',
    left: 0,
    top: 2,
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
    top: 2,
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
    marginTop: 0,
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
