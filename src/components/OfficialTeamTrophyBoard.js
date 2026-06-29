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
      <View style={styles.champHalo} />
      <Ionicons name="star" size={11} color="#fff8dc" style={styles.champStar} />
      <View style={styles.champHandleLeft} />
      <View style={styles.champHandleRight} />
      <View style={styles.champBowl}>
        <View style={styles.champBowlShine} />
      </View>
      <View style={styles.champNeck} />
      <View style={styles.champPedestal}>
        <View style={styles.champPedestalTop} />
        <View style={styles.champPedestalBase} />
      </View>
    </View>
  );
}

function WineTrophyVisual() {
  return (
    <View style={styles.wineVisual}>
      <View style={styles.wineHalo} />
      <MaterialCommunityIcons name="fruit-grapes" size={12} color="#e8c4d8" style={styles.wineGrapes} />
      <View style={styles.wineGoblet}>
        <View style={styles.wineLiquid} />
        <View style={styles.wineGobletRim} />
      </View>
      <View style={styles.wineStem} />
      <View style={styles.wineFoot}>
        <View style={styles.wineFootTop} />
        <View style={styles.wineFootBase} />
      </View>
    </View>
  );
}

function TrophySlot({ type, year }) {
  const isWine = type === 'wine';
  return (
    <View style={styles.slot}>
      <View style={[styles.slotPedestal, isWine ? styles.slotPedestalWine : styles.slotPedestalChamp]}>
        {isWine ? <WineTrophyVisual /> : <ChampionshipTrophyVisual />}
      </View>
      <YearPlaque year={year} />
    </View>
  );
}

function TrophyShelf({ title, subtitle, icon, iconColor, trophies, type, emptyHint, useMciIcon = false }) {
  return (
    <View style={styles.shelfBlock}>
      <View style={styles.shelfHeader}>
        <View style={[styles.shelfIconWrap, type === 'wine' ? styles.shelfIconWrapWine : styles.shelfIconWrapChamp]}>
          {useMciIcon ? (
            <MaterialCommunityIcons name={icon} size={16} color={iconColor} />
          ) : (
            <Ionicons name={icon} size={16} color={iconColor} />
          )}
        </View>
        <View style={styles.shelfHeaderText}>
          <Text style={styles.shelfTitle}>{title}</Text>
          <Text style={styles.shelfSubtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.shelfCount}>{trophies.length}</Text>
      </View>
      <View style={[styles.shelfSurface, type === 'wine' ? styles.shelfSurfaceWine : styles.shelfSurfaceChamp]}>
        <View style={styles.shelfLip} />
        {trophies.length > 0 ? (
          <View style={styles.shelfGrid}>
            {trophies.map((t) => (
              <TrophySlot key={`${type}-${t.year}`} type={type} year={t.year} />
            ))}
          </View>
        ) : (
          <Text style={styles.shelfEmpty}>{emptyHint}</Text>
        )}
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
      <View style={styles.emptyCabinet}>
        <View style={styles.emptyGlow} />
        <MaterialCommunityIcons name="trophy-outline" size={48} color="#5c4a3a" />
        <Text style={styles.emptyTitle}>Bacheca vuota</Text>
        <Text style={styles.emptyText}>I trofei conquistati appariranno qui,{'\n'}sopra la targhetta dell&apos;anno.</Text>
      </View>
    );
  }

  return (
    <View style={styles.cabinet}>
      <View style={styles.cabinetTopTrim} />
      <View style={styles.cabinetInner}>
        <TrophyShelf
          title="Campionato"
          subtitle="Vittoria in finale"
          icon="trophy"
          iconColor="#f5d76e"
          trophies={champList}
          type="championship"
          emptyHint="Nessun titolo in bacheca"
        />
        <TrophyShelf
          title="Trofeo del vino"
          subtitle="Coppa enologica"
          icon="glass-wine"
          iconColor="#e8b4bc"
          trophies={wineList}
          type="wine"
          emptyHint="Nessun trofeo del vino"
          useMciIcon
        />
      </View>
      <View style={styles.cabinetBottomTrim} />
    </View>
  );
}

const styles = StyleSheet.create({
  cabinet: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a120c',
    borderWidth: 1,
    borderColor: '#3d2e1f',
  },
  cabinetTopTrim: {
    height: 4,
    backgroundColor: '#8b6914',
  },
  cabinetBottomTrim: {
    height: 3,
    backgroundColor: '#2a1f14',
  },
  cabinetInner: {
    padding: 14,
    gap: 18,
    backgroundColor: '#221810',
  },
  shelfBlock: {
    gap: 8,
  },
  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shelfIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  shelfIconWrapChamp: {
    backgroundColor: '#3d3018',
    borderColor: '#6b5420',
  },
  shelfIconWrapWine: {
    backgroundColor: '#3a1824',
    borderColor: '#6b2a40',
  },
  shelfHeaderText: {
    flex: 1,
  },
  shelfTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#f5e6c8',
    letterSpacing: 0.3,
  },
  shelfSubtitle: {
    fontSize: 11,
    color: '#8a7358',
    marginTop: 1,
  },
  shelfCount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#5c4a38',
    fontVariant: ['tabular-nums'],
  },
  shelfSurface: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 10,
    minHeight: 130,
    borderWidth: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  shelfSurfaceChamp: {
    backgroundColor: '#2e2418',
    borderColor: '#4a3a24',
  },
  shelfSurfaceWine: {
    backgroundColor: '#261418',
    borderColor: '#4a2030',
  },
  shelfLip: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
  },
  shelfGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
  },
  shelfEmpty: {
    textAlign: 'center',
    color: '#6b5a48',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 24,
  },
  slot: {
    alignItems: 'center',
    width: 78,
    gap: 8,
  },
  slotPedestal: {
    width: 72,
    height: 88,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    borderWidth: 1,
  },
  slotPedestalChamp: {
    backgroundColor: '#1f1810',
    borderColor: '#3d3018',
  },
  slotPedestalWine: {
    backgroundColor: '#180f12',
    borderColor: '#3d2030',
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
  champVisual: {
    width: 52,
    height: 72,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  champHalo: {
    position: 'absolute',
    top: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 215, 110, 0.15)',
  },
  champStar: {
    position: 'absolute',
    top: 8,
    zIndex: 3,
  },
  champHandleLeft: {
    position: 'absolute',
    top: 22,
    left: 4,
    width: 8,
    height: 18,
    borderWidth: 2,
    borderColor: '#d4af37',
    borderRightWidth: 0,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  champHandleRight: {
    position: 'absolute',
    top: 22,
    right: 4,
    width: 8,
    height: 18,
    borderWidth: 2,
    borderColor: '#d4af37',
    borderLeftWidth: 0,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  champBowl: {
    width: 38,
    height: 22,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: '#e8c547',
    borderWidth: 1,
    borderColor: '#b8860b',
    overflow: 'hidden',
    zIndex: 2,
  },
  champBowlShine: {
    position: 'absolute',
    top: 3,
    left: 6,
    width: 10,
    height: 8,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  champNeck: {
    width: 10,
    height: 6,
    backgroundColor: '#c9a227',
    marginTop: -1,
    zIndex: 1,
  },
  champPedestal: {
    alignItems: 'center',
    marginTop: 2,
  },
  champPedestalTop: {
    width: 22,
    height: 5,
    backgroundColor: '#d4af37',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  champPedestalBase: {
    width: 32,
    height: 8,
    backgroundColor: '#8b6914',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderWidth: 1,
    borderColor: '#6b5420',
    borderTopWidth: 0,
  },
  wineVisual: {
    width: 48,
    height: 72,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  wineHalo: {
    position: 'absolute',
    top: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(180, 60, 90, 0.18)',
  },
  wineGrapes: {
    position: 'absolute',
    top: 6,
    zIndex: 3,
    opacity: 0.9,
  },
  wineGoblet: {
    width: 34,
    height: 26,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: '#4a1528',
    borderWidth: 1.5,
    borderColor: '#8b3050',
    overflow: 'hidden',
    zIndex: 2,
    alignItems: 'center',
  },
  wineLiquid: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 16,
    backgroundColor: '#6b1d3a',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,180,200,0.2)',
  },
  wineGobletRim: {
    position: 'absolute',
    top: 0,
    left: 4,
    right: 4,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 2,
  },
  wineStem: {
    width: 4,
    height: 14,
    backgroundColor: '#6b3050',
    marginTop: -1,
  },
  wineFoot: {
    alignItems: 'center',
    marginTop: 1,
  },
  wineFootTop: {
    width: 14,
    height: 3,
    backgroundColor: '#5c2840',
    borderRadius: 1,
  },
  wineFootBase: {
    width: 28,
    height: 7,
    backgroundColor: '#3d1828',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#5c2840',
  },
  emptyCabinet: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: '#221810',
    borderWidth: 1,
    borderColor: '#3d2e1f',
    overflow: 'hidden',
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
